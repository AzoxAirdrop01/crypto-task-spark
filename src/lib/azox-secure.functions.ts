import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BOXES_PER_DAY,
  BOX_REWARD,
  CLICKER_COOLDOWN_MS,
  CLICKER_MAX_TAPS,
  CLICKER_POINTS_PER_TAP,
  DAILY_GIFT_POINTS,
  GLOBAL_BUTTON_ACTIVE_MS,
  GLOBAL_BUTTON_MAX_WINNERS,
  GLOBAL_BUTTON_REWARD,
  GLOBAL_BUTTON_SLOT_MS,
  MAX_GAME_SCORE,
  QUESTIONS_PER_DAY,
  SCORE_GAMES,
  TASK_UNITS,
  WORDS_PER_DAY,
} from "./rewards";
import { GAME_SCORE_MAX_PER_CLAIM } from "./rate-limits";
import { TAP_BATCH_MAX_UNITS } from "./tap-batch";
import { SOCIAL_TASKS } from "./social-tasks";
import { AZOX_AIRDROP_ABI, AZOX_AIRDROP_ADDRESS, REGISTRATION_FEE } from "./contracts";

/**
 * Every write here identifies the user ONLY from Telegram initData verified
 * server-side with the bot token. A browser-supplied telegram id or point
 * amount is never accepted.
 */

const initData = z.string().min(1).max(8192);
const taskId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_:.-]+$/);

export type SecureError =
  | "not_configured"
  | "missing"
  | "invalid"
  | "stale"
  | "unknown_task"
  | "window_closed"
  | "already_claimed"
  | "full"
  | "not_verified"
  | "conflict"
  | "cooldown"
  | "capped"
  | "busy"
  | "game_disabled"
  | "server_error";

type Fail = { ok: false; error: SecureError; message?: string };

async function auth(raw: string) {
  const { verifyTelegramInitData } = await import("./telegram-auth.server");
  return verifyTelegramInitData(raw);
}

async function helpers() {
  return import("./azox-secure.server");
}

/** Admin game switch gate; fail-open when the switch cannot be read. */
async function gameOff(game: string): Promise<boolean> {
  const { toSwitchId } = await import("./game-switches");
  const id = toSwitchId(game);
  if (!id) return false;
  const { isGameEnabled } = await import("./game-switches.server");
  return !(await isGameEnabled(id));
}

function fail(error: SecureError, e?: unknown): Fail {
  if (e) console.error(`[azox-secure] ${error}`, e instanceof Error ? e.message : e);
  return { ok: false, error };
}

/* --------------------------------- syncUser -------------------------------- */

export const syncUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData }).parse(d))
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    try {
      const h = await helpers();
      const { runReferralSync } = await import("./referral");
      const u = a.user;
      let upsertErr: string | null = null;

      // Referral code comes ONLY from the verified start_param; it is passed
      // to upsert_user only for a brand-new user with a valid, non-self code.
      await runReferralSync(u.id, a.startParam, {
        userExists: async (id) => {
          const { data: r } = await h
            .db()
            .from("users")
            .select("telegram_id")
            .eq("telegram_id", id)
            .maybeSingle();
          return Boolean(r);
        },
        findReferrerByCode: async (code) => {
          const { data: r } = await h
            .db()
            .from("users")
            .select("telegram_id")
            .eq("referral_code", code)
            .maybeSingle();
          return r ? Number(r.telegram_id) : null;
        },
        upsertUser: async (code) => {
          const base = {
            p_telegram_id: u.id,
            p_username: u.username ?? null,
            p_first_name: u.first_name ?? null,
            p_last_name: u.last_name ?? null,
            p_referral_code: code,
          };
          let { error } = await h.db().rpc("upsert_user", {
            ...base,
            p_photo_url: u.photo_url ?? null,
          });
          if (error) ({ error } = await h.db().rpc("upsert_user", base));
          if (error) upsertErr = error.message;
        },
        readReferredBy: async (id) => {
          const { data: r } = await h
            .db()
            .from("users")
            .select("referred_by")
            .eq("telegram_id", id)
            .maybeSingle();
          return r?.referred_by ? Number(r.referred_by) : null;
        },
        recomputeRank: async (id) => {
          await h.grantPoints(id, 0);
        },
      });
      if (upsertErr) return fail("server_error", upsertErr);

      const { data: row, error: readErr } = await h
        .db()
        .from("users")
        .select("*")
        .eq("telegram_id", u.id)
        .maybeSingle();
      if (readErr || !row) return fail("server_error", readErr?.message ?? "no row");
      return { ok: true as const, user: row as Record<string, string | number | boolean | null> };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* ------------------------------- claimReward ------------------------------- */

const claimSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tap_batch"),
    batchId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    tapUnits: z.number().int().min(1).max(TAP_BATCH_MAX_UNITS),
  }),
  z.object({ type: z.literal("social_task"), taskId }),
  z.object({ type: z.literal("daily_gift") }),
  z.object({
    type: z.literal("box_open"),
    session: z
      .number()
      .int()
      .min(0)
      .max(BOXES_PER_DAY - 1),
  }),
  z.object({
    type: z.literal("clicker_round"),
    taps: z.number().int().min(1).max(CLICKER_MAX_TAPS),
  }),
  z.object({
    type: z.literal("game_score"),
    gameId: z.enum(SCORE_GAMES),
    score: z.number().int().min(1).max(GAME_SCORE_MAX_PER_CLAIM),
  }),
]);

export const claimReward = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData, claim: claimSchema }).parse(d))
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const id = a.user.id;
    const c = data.claim;
    const gameForClaim =
      c.type === "box_open"
        ? "box"
        : c.type === "clicker_round"
          ? "clicker"
          : c.type === "game_score"
            ? c.gameId
            : c.type === "tap_batch"
              ? "main-tap"
              : null;
    if (gameForClaim && (await gameOff(gameForClaim))) return fail("game_disabled");
    try {
      const h = await helpers();
      const day = h.utcDay();
      const once = async (key: string, pts: number) => {
        const r = await h.claimOnce(id, key, pts);
        return { ok: true as const, granted: r.granted, points: r.points, rank: r.rank };
      };
      switch (c.type) {
        case "tap_batch": {
          // Atomic: cooldown, idempotency and amount decided under a row lock.
          const { mapClaimStatus } = await import("./claim-status");
          const m = mapClaimStatus(await h.claimTapBatch(id, c.batchId, c.tapUnits));
          return m.ok ? m : fail(m.error, m.error === "server_error" ? "tap status" : undefined);
        }
        case "game_score": {
          const { mapClaimStatus } = await import("./claim-status");
          const m = mapClaimStatus(await h.claimGameScore(id, c.gameId, c.score));
          if (m.ok && !m.granted) return fail("server_error", "game_score duplicate");
          return m.ok ? m : fail(m.error, m.error === "server_error" ? "game status" : undefined);
        }
        case "social_task": {
          const v = await verifySocialTask(id, c.taskId);
          if (!v.ok) return fail(v.error);
          return once(`task-${c.taskId}`, v.points);
        }
        case "daily_gift":
          return once(`daily-gift-${day}`, DAILY_GIFT_POINTS);
        case "box_open":
          return once(`box-${day}-${c.session}`, BOX_REWARD);
        case "clicker_round": {
          // True 4h cooldown from the previous paid round. The key is derived
          // from that previous round, so concurrent claims collide on the
          // reward_events unique key and only one can be paid.
          const last = await h.lastEvent(id, "clicker-");
          if (last && Date.now() - Date.parse(last.created_at) < CLICKER_COOLDOWN_MS) {
            return fail("cooldown");
          }
          return once(`clicker-after-${last?.id ?? "first"}`, c.taps * CLICKER_POINTS_PER_TAP);
        }
      }
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* --------------------------- daily game batches --------------------------- */

/**
 * ONE call at the end of an AZOX Word / Question Day session. The browser
 * sends only which of today's indices it answered correctly (it still decides
 * correctness — not provable server-side). The server fixes the amounts,
 * pays each day/index once via claim_reward, and grants the completion task
 * units only when all of today's rewards are recorded.
 */
export const completeDailyGame = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        initData,
        game: z.enum(["word", "question"]),
        indices: z
          .array(
            z
              .number()
              .int()
              .min(0)
              .max(WORDS_PER_DAY - 1),
          )
          .max(WORDS_PER_DAY),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const { normalizeIndices, runDailyBatch } = await import("./daily-batch");
    const indices = normalizeIndices(data.game, data.indices);
    if (!indices) return fail("invalid");
    if (await gameOff(data.game)) return fail("game_disabled");
    const id = a.user.id;
    try {
      const h = await helpers();
      const r = await runDailyBatch(data.game, h.utcDay(), indices, {
        claimOnce: (key, pts) => h.claimOnce(id, key, pts),
        countEvents: (keys) => h.countEvents(id, keys),
        insertTaskIds: (ids) => h.insertTaskIds(id, ids),
        unitIds: h.unitIds,
        currentPoints: () => h.currentPoints(id),
      });
      if (r.unitsAdded > 0) await h.recomputeTasksDone(id);
      return { ok: true as const, ...r };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* ------------------------------ tasks / units ------------------------------ */

/** Records a social task completion (+ its DB-defined bonus task units). */
export const recordTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData, taskId }).parse(d))
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    try {
      const h = await helpers();
      // Only after the reward itself passed server verification.
      if (!(await h.hasEvent(a.user.id, `task-${data.taskId}`))) return fail("not_verified");
      const t = await h.findTask(data.taskId);
      await h.insertTaskIds(a.user.id, [data.taskId]);
      if (t && t.taskReward > 0) {
        await h.insertTaskIds(a.user.id, h.unitIds(`${data.taskId}-reward`, t.taskReward));
      }
      return { ok: true as const, tasksDone: await h.recomputeTasksDone(a.user.id) };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/** Game achievement task units — units and ids decided by the server. */
export const recordTaskUnits = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        initData,
        kind: z.enum(["word_complete", "box_open", "question_complete", "daily_streak"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const unitGame = { word_complete: "word", box_open: "box", question_complete: "question" }[
      data.kind as string
    ];
    if (unitGame && (await gameOff(unitGame))) return fail("game_disabled");
    try {
      const h = await helpers();
      const id = a.user.id;
      const day = h.utcDay();
      // Require the server-recorded rewards for the underlying game events.
      let earned = false;
      if (data.kind === "word_complete") {
        const keys = Array.from({ length: WORDS_PER_DAY }, (_, i) => `word-${day}-${i}`);
        earned = (await h.countEvents(id, keys)) === keys.length;
      } else if (data.kind === "question_complete") {
        const keys = Array.from({ length: QUESTIONS_PER_DAY }, (_, i) => `question-${day}-${i}`);
        earned = (await h.countEvents(id, keys)) === keys.length;
      } else if (data.kind === "box_open") {
        earned = (await h.lastEvent(id, `box-${day}-`)) !== null;
      } else {
        const days = Array.from({ length: 5 }, (_, i) => h.utcDay(Date.now() - i * 86_400_000));
        const gifts = await h.countEvents(
          id,
          days.map((d) => `daily-gift-${d}`),
        );
        const { data: recent } = await h
          .db()
          .from("user_tasks")
          .select("task_id")
          .eq("telegram_id", id)
          .in(
            "task_id",
            days.slice(1).map((d) => `game-streak-${d}`),
          );
        earned = gifts === 5 && (recent ?? []).length === 0;
      }
      if (!earned) return fail("not_verified");
      const base = {
        word_complete: `game-word-complete-${day}`,
        box_open: `game-box-open-${day}`,
        question_complete: `game-question-complete-${day}`,
        daily_streak: `game-streak-${day}`,
      }[data.kind];
      const added = await h.insertTaskIds(a.user.id, h.unitIds(base, TASK_UNITS[data.kind]));
      return { ok: true as const, added, tasksDone: await h.recomputeTasksDone(a.user.id) };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/** Re-syncs users.tasks_done for the verified user. */
export const syncTasksDone = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData }).parse(d))
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    try {
      const h = await helpers();
      return { ok: true as const, tasksDone: await h.recomputeTasksDone(a.user.id) };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* ------------------------------ submitGameScore ---------------------------- */

export const submitGameScore = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        initData,
        gameId: z.enum(SCORE_GAMES),
        score: z.number().int().min(1).max(MAX_GAME_SCORE),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const id = a.user.id;
    if (await gameOff(data.gameId)) return fail("game_disabled");
    try {
      const h = await helpers();
      const { data: isRecord, error } = await h.db().rpc("submit_global_best", {
        p_game_id: data.gameId,
        p_score: data.score,
        p_telegram_id: id,
        p_name: a.user.first_name ?? null,
      });
      if (error) return fail("server_error", error.message);
      if (isRecord !== true) return { ok: true as const, newRecord: false, earnedTasks: 0 };

      // Personal score (same upsert as before, only on a new world record).
      const { error: psErr } = await h
        .db()
        .from("game_scores")
        .upsert(
          { telegram_id: id, game_id: data.gameId, score: data.score, is_best: true },
          { onConflict: "telegram_id,game_id" },
        );
      if (psErr) console.error("[azox-secure] game_scores upsert failed", psErr.message);

      await h.insertTaskIds(
        id,
        h.unitIds(`game-world-record-${data.gameId}-${data.score}`, TASK_UNITS.world_record),
      );
      await h.recomputeTasksDone(id);
      return { ok: true as const, newRecord: true, earnedTasks: TASK_UNITS.world_record };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* ----------------------------- globalButtonPress --------------------------- */

export const globalButtonPress = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData }).parse(d))
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const id = a.user.id;
    if (await gameOff("global-button")) return fail("game_disabled");
    const now = Date.now();
    const slot = Math.floor(now / GLOBAL_BUTTON_SLOT_MS) * GLOBAL_BUTTON_SLOT_MS;
    if (now - slot >= GLOBAL_BUTTON_ACTIVE_MS) return fail("window_closed");
    const rowId = `game-global-button-${slot}`;
    const eventKey = `global-button-${slot}`;
    try {
      const h = await helpers();
      if (await h.hasEvent(id, eventKey)) {
        await h.insertTaskIds(id, [rowId]); // heal a half-finished earlier press
        await h.recomputeTasksDone(id);
        return fail("already_claimed");
      }

      // Atomic winner seat: submit_global_best is an atomic strictly-higher
      // upsert, so exactly one request can move the slot counter from n-1
      // to n. Seats above the cap are never taken.
      const seatGame = `global-button-seat-${slot}`;
      let seat = 0;
      for (let attempt = 0; attempt < 40 && seat === 0; attempt++) {
        const { data: cur } = await h
          .db()
          .from("global_best_scores")
          .select("best_score")
          .eq("game_id", seatGame)
          .maybeSingle();
        const next = Number(cur?.best_score ?? 0) + 1;
        if (next > GLOBAL_BUTTON_MAX_WINNERS) return fail("full");
        const { data: won, error } = await h.db().rpc("submit_global_best", {
          p_game_id: seatGame,
          p_score: next,
          p_telegram_id: id,
          p_name: null,
        });
        if (error) return fail("server_error", error.message);
        if (won === true) seat = next;
        else await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
      }
      if (seat === 0) return fail("busy");

      // One win per user per slot: reward_events unique (telegram_id, key).
      const r = await h.claimOnce(id, eventKey, GLOBAL_BUTTON_REWARD);
      if (!r.granted) return fail("already_claimed");
      await h.insertTaskIds(id, [rowId]);
      await h.recomputeTasksDone(id);
      return { ok: true as const, granted: true, points: r.points, rank: r.rank, slot };
    } catch (e) {
      return fail("server_error", e);
    }
  });

/* ----------------------------- social verification ------------------------- */

type SocialCheck = { ok: true; points: number } | { ok: false; error: SecureError };

/** Server-side proof for a social task, using the project's real checks. */
async function verifySocialTask(telegramId: number, id: string): Promise<SocialCheck> {
  const h = await helpers();
  const row = await h.findTask(id);
  const fallback = SOCIAL_TASKS.flatMap((g) => g.tasks).find((t) => t.id === id);
  const points = row?.points ?? fallback?.points ?? 0;
  if (points <= 0) return { ok: false, error: "unknown_task" };
  const platform = row?.platform ?? fallback?.platform.toLowerCase() ?? "";
  if (platform === "telegram") {
    const chat = row?.url.match(/t\.me\/([A-Za-z0-9_]+)/)?.[1] ?? fallback?.verifyChat;
    if (!chat || !(await h.isTelegramMember(chat, telegramId))) {
      return { ok: false, error: "not_verified" };
    }
  } else if (platform === "instagram") {
    if (!(await h.isInstagramVerified(telegramId, id))) return { ok: false, error: "not_verified" };
  }
  // X, TikTok, Threads, YouTube, Discord: no verification integration exists.
  return { ok: true, points };
}

/* --------------------------- registerAirdropWallet ------------------------- */

const CHAIN_ID = 4663;
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export const registerAirdropWallet = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        initData,
        walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const a = await auth(data.initData);
    if (!a.ok) return fail(a.error);
    const telegramId = a.user.id;
    const wallet = data.walletAddress.toLowerCase();
    const hash = data.txHash.toLowerCase() as `0x${string}`;
    try {
      const h = await helpers();

      // First registration per telegram_id on this chain wins.
      const { data: existing } = await h
        .db()
        .from("wallet_registrations")
        .select("wallet_address, registered_at")
        .eq("telegram_id", telegramId)
        .eq("chain_id", CHAIN_ID)
        .order("registered_at", { ascending: true })
        .limit(1);
      if (existing?.[0]) return { ok: true as const, registration: existing[0] };

      const { createPublicClient, http } = await import("viem");
      const client = createPublicClient({ transport: http(RPC_URL) });
      if ((await client.getChainId()) !== CHAIN_ID) return fail("not_verified");
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
      const ok =
        receipt.status === "success" &&
        tx.to?.toLowerCase() === AZOX_AIRDROP_ADDRESS.toLowerCase() &&
        tx.from.toLowerCase() === wallet &&
        tx.value === REGISTRATION_FEE &&
        (tx.chainId === undefined || tx.chainId === CHAIN_ID);
      if (!ok) return fail("not_verified");
      const eligible = await client.readContract({
        address: AZOX_AIRDROP_ADDRESS,
        abi: AZOX_AIRDROP_ABI,
        functionName: "isEligible",
        args: [wallet as `0x${string}`],
      });
      if (eligible !== true) return fail("not_verified");

      // Reject if this tx or wallet already belongs to a different user.
      const [{ data: byTx }, { data: byWallet }] = await Promise.all([
        h
          .db()
          .from("wallet_registrations")
          .select("telegram_id")
          .eq("chain_id", CHAIN_ID)
          .ilike("payment_tx_hash", hash),
        h
          .db()
          .from("wallet_registrations")
          .select("telegram_id")
          .eq("chain_id", CHAIN_ID)
          .ilike("wallet_address", wallet),
      ]);
      const others = [...(byTx ?? []), ...(byWallet ?? [])].some(
        (r: { telegram_id: number }) => Number(r.telegram_id) !== telegramId,
      );
      if (others) return fail("conflict");

      const { error } = await h.db().from("wallet_registrations").insert({
        telegram_id: telegramId,
        wallet_address: wallet,
        chain_id: CHAIN_ID,
        registration_fee: "0.0006",
        payment_tx_hash: hash,
        payment_status: "confirmed",
        is_current: true,
      });
      if (error) return fail("server_error", error.message);

      const { error: uErr } = await h
        .db()
        .from("users")
        .update({ airdrop_registered: true })
        .eq("telegram_id", telegramId);
      if (uErr) console.error("[azox-secure] airdrop_registered update failed", uErr.message);

      const { data: saved } = await h
        .db()
        .from("wallet_registrations")
        .select("wallet_address, registered_at")
        .eq("telegram_id", telegramId)
        .eq("chain_id", CHAIN_ID)
        .order("registered_at", { ascending: true })
        .limit(1);
      return { ok: true as const, registration: saved?.[0] ?? null };
    } catch (e) {
      return fail("server_error", e);
    }
  });
