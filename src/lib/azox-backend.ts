import { externalSupabase as supabase } from "@/integrations/external-supabase/client";
import { getTelegramUser, getWebApp } from "@/lib/telegram";
import type { RewardClaim, ScoreGame, TaskUnitKind } from "@/lib/rewards";
import {
  claimReward as claimRewardFn,
  completeDailyGame as completeDailyGameFn,
  globalButtonPress as globalButtonPressFn,
  recordTask as recordTaskFn,
  recordTaskUnits as recordTaskUnitsFn,
  registerAirdropWallet as registerAirdropWalletFn,
  submitGameScore as submitGameScoreFn,
  syncTasksDone as syncTasksDoneFn,
  syncUser as syncUserFn,
} from "@/lib/azox-secure.functions";
import {
  getMyTaskCount,
  getMyUser,
  getMyWalletRegistration,
  getReferredUsers,
} from "@/lib/profile.functions";
import { PUBLIC_USER_COLUMNS, publicRowToDbUser, type PublicUserRow } from "@/lib/public-user";
import { getDailyQuestions, type DailyQuestion } from "@/lib/question-day.functions";
import { getGameSwitches } from "@/lib/game-switches.functions";
import { GAME_DISABLED, allGamesOn, type GameSwitches } from "@/lib/game-switches";

/** Browser event fired when the server refuses a game call because it is paused. */
export const GAME_DISABLED_EVENT = "azox:game-disabled";

function noteGameDisabled(error: unknown): void {
  if (error === GAME_DISABLED && typeof window !== "undefined") {
    window.dispatchEvent(new Event(GAME_DISABLED_EVENT));
  }
}

/** Admin game switches; all ON on any failure. */
export async function fetchGameSwitches(): Promise<GameSwitches> {
  const initData = rawInitData();
  if (!initData) return allGamesOn();
  try {
    const res = await getGameSwitches({ data: { initData } });
    return res.ok ? res.switches : allGamesOn();
  } catch {
    return allGamesOn();
  }
}

/** Raw signed Telegram initData — the only identity sent for writes. */
export function rawInitData(): string | null {
  return getWebApp()?.initData || null;
}

export type DailyQuestionsFetch =
  | { status: "ok"; questions: DailyQuestion[] }
  | { status: "already_played"; nextResetAt: number }
  | { status: "unavailable" };

/**
 * Starting Question Day burns the user's one play for the UTC day, so a
 * successful result is kept per UTC day and concurrent calls share one request
 * (remounts / StrictMode double effects never burn the attempt).
 */
let dailyQuestionsCache: { day: string; result: DailyQuestionsFetch } | null = null;
let dailyQuestionsInFlight: { day: string; promise: Promise<DailyQuestionsFetch> } | null = null;

export function fetchDailyQuestions(): Promise<DailyQuestionsFetch> {
  const day = new Date().toISOString().slice(0, 10);
  if (dailyQuestionsCache?.day === day) return Promise.resolve(dailyQuestionsCache.result);
  if (dailyQuestionsInFlight?.day === day) return dailyQuestionsInFlight.promise;
  const promise = (async (): Promise<DailyQuestionsFetch> => {
    const initData = rawInitData();
    if (!initData) return { status: "unavailable" };
    try {
      const result = await getDailyQuestions({ data: { initData } });
      if (result.ok) {
        const ok: DailyQuestionsFetch = { status: "ok", questions: result.questions };
        dailyQuestionsCache = { day, result: ok };
        return ok;
      }
      if (result.error === "already_played") {
        return { status: "already_played", nextResetAt: result.nextResetAt };
      }
      return { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    } finally {
      dailyQuestionsInFlight = null;
    }
  })();
  dailyQuestionsInFlight = { day, promise };
  return promise;
}

/** The external project's user tables are not in the generated types. */
const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
};

export type DbUser = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  points: number;
  tasks_done: number;
  referral_code: string | null;
  referred_by: number | null;
  referral_count: number;
  photo_url: string | null;
  rank: string | null;
  joined_at: string | null;
  last_seen: string | null;
};

export const BOT_USERNAME = "AZOX_Airdrop_bot";

export { referralLinkFor } from "@/lib/referral-link";

export function currentTelegramId(): number | null {
  const tg = getTelegramUser();
  return tg?.id ?? null;
}

/** Upserts the verified Telegram user on the server, then returns the row. */
export async function syncTelegramUser(): Promise<DbUser | null> {
  const tg = getTelegramUser();
  if (!tg) return null;
  const initData = rawInitData();
  if (initData) {
    try {
      const res = await syncUserFn({ data: { initData } });
      if (res.ok) return res.user as unknown as DbUser;
      console.warn("[azox-backend] syncUser rejected:", res.error);
    } catch (e) {
      console.error("[azox-backend] syncUser failed", e);
    }
  }
  return fetchUser(tg.id);
}

export async function fetchUser(telegramId: number): Promise<DbUser | null> {
  const initData = rawInitData();
  if (initData) {
    try {
      const res = await getMyUser({ data: { initData } });
      if (res.ok) return (res.user as unknown as DbUser) ?? null;
      console.warn("[azox-backend] getMyUser rejected:", res.error);
    } catch (e) {
      console.error("[azox-backend] getMyUser failed", e);
    }
    return null;
  }
  try {
    // Browser fallback: anon-visible columns only.
    const { data, error } = await db
      .from("users")
      .select(PUBLIC_USER_COLUMNS)
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (error) throw error;
    return data ? publicRowToDbUser(data as PublicUserRow) : null;
  } catch (e) {
    console.error("[azox-backend] fetchUser failed", e);
    return null;
  }
}

/**
 * Asks the server to pay a reward. The server decides the amount for fixed
 * rewards; returns the authoritative total when available.
 */
/** In-flight reward claims; follow-up task writes wait for them. */
let pendingClaims: Promise<unknown> = Promise.resolve();

export function claimRewardRemote(claim: RewardClaim): Promise<number | null> {
  const p = doClaimReward(claim);
  pendingClaims = Promise.allSettled([pendingClaims, p]);
  return p;
}

async function doClaimReward(claim: RewardClaim): Promise<number | null> {
  if (claim.type === "none") return null;
  const initData = rawInitData();
  if (!initData) return null;
  try {
    const res =
      claim.type === "global_button"
        ? await globalButtonPressFn({ data: { initData } })
        : claim.type === "daily_batch"
          ? await completeDailyGameFn({
              data: { initData, game: claim.game, indices: claim.indices },
            })
          : await claimRewardFn({ data: { initData, claim } });
    if (res.ok) return res.points;
    console.warn("[azox-backend] reward rejected:", claim.type, res.error);
    noteGameDisabled(res.error);
  } catch (e) {
    console.error("[azox-backend] reward failed", e);
  }
  const id = currentTelegramId();
  if (!id) return null;
  const user = await fetchUser(id);
  return user?.points ?? null;
}

/**
 * Submits a Main Tap batch. Returns the authoritative total only when the
 * server confirmed the batch (granted or already processed); null otherwise.
 */
export async function submitTapBatch(batchId: string, tapUnits: number): Promise<number | null> {
  const initData = rawInitData();
  if (!initData) return null;
  try {
    const res = await claimRewardFn({
      data: { initData, claim: { type: "tap_batch", batchId, tapUnits } },
    });
    if (res.ok) return res.points;
    console.warn("[azox-backend] tap batch rejected:", res.error);
  } catch (e) {
    console.error("[azox-backend] tap batch failed", e);
  }
  return null;
}

/** Fire-and-forget tap batch that survives page unload (keepalive). */
export function sendTapBatchKeepalive(batch: { id: string; units: number }): void {
  try {
    const initData = rawInitData();
    if (!initData) return;
    void fetch("/api/public/tap-flush", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, batchId: batch.id, tapUnits: batch.units }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // never throws
  }
}

/** True number of unique tasks completed by the verified user. */
export async function fetchTaskCount(_telegramId: number): Promise<number> {
  const initData = rawInitData();
  if (!initData) return 0;
  try {
    const res = await getMyTaskCount({ data: { initData } });
    return res.ok ? res.count : 0;
  } catch (e) {
    console.error("[azox-backend] fetchTaskCount failed", e);
    return 0;
  }
}

/** Records a social task (and its bonus task units) on the server. */
export async function recordTaskCompletion(taskId: string): Promise<void> {
  await pendingClaims;
  const initData = rawInitData();
  if (!initData) return;
  try {
    const res = await recordTaskFn({ data: { initData, taskId } });
    if (!res.ok) console.warn("[azox-backend] recordTask rejected:", res.error);
  } catch (e) {
    console.error("[azox-backend] recordTaskCompletion failed", e);
  }
}

/** Game achievement task units; the server decides ids and unit counts. */
export async function recordTaskUnits(kind: TaskUnitKind): Promise<number> {
  await pendingClaims;
  const initData = rawInitData();
  if (!initData) return 0;
  try {
    const res = await recordTaskUnitsFn({ data: { initData, kind } });
    if (res.ok) return res.added;
    console.warn("[azox-backend] recordTaskUnits rejected:", res.error);
    noteGameDisabled(res.error);
  } catch (e) {
    console.error("[azox-backend] recordTaskUnits failed", e);
  }
  return 0;
}

/** Re-syncs users.tasks_done on the server from the real user_tasks rows. */
export async function syncTasksDone(): Promise<number> {
  const telegramId = currentTelegramId();
  if (!telegramId) return 0;
  const initData = rawInitData();
  if (initData) {
    try {
      const res = await syncTasksDoneFn({ data: { initData } });
      if (res.ok) return res.tasksDone;
    } catch (e) {
      console.error("[azox-backend] syncTasksDone failed", e);
    }
  }
  return fetchTaskCount(telegramId);
}

/**
 * Submits a score for the global best. Returns task units earned (10 only
 * when the server stored a new world record).
 */
export async function submitGameScoreRemote(gameId: ScoreGame, score: number): Promise<number> {
  const initData = rawInitData();
  if (!initData || !Number.isInteger(score) || score <= 0) return 0;
  try {
    const res = await submitGameScoreFn({ data: { initData, gameId, score } });
    if (res.ok) return res.earnedTasks;
    console.warn("[azox-backend] submitGameScore rejected:", res.error);
    noteGameDisabled(res.error);
  } catch (e) {
    console.error("[azox-backend] submitGameScore failed", e);
  }
  return 0;
}

export type LeaderboardRow = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  points: number;
  tasks_done: number;
  referral_count: number;
  rank: string | null;
  photo_url: string | null;
};

export function displayName(row: { username: string | null; first_name: string | null }): string {
  return row.username ? `@${row.username}` : (row.first_name ?? "AZOX Player");
}

export async function fetchLeaderboard(
  column: "points" | "tasks_done" | "referral_count",
  limit = 100,
): Promise<LeaderboardRow[]> {
  try {
    const { data, error } = await db
      .from("users")
      .select(
        "telegram_id, username, first_name, last_name, points, tasks_done, referral_count, rank, photo_url",
      )
      .order(column, { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as LeaderboardRow[]) ?? [];
  } catch (e) {
    console.error("[azox-backend] fetchLeaderboard failed", e);
    return [];
  }
}

/* ------------------------------- Referrals ------------------------------- */

export type ReferredUser = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  points: number;
  joined_at: string | null;
};

/**
 * No-op: referral attribution (+1000 to the referrer) happens inside the
 * server-side upsert_user call when the user row is first created.
 */
export async function registerReferral(_code: string | null): Promise<boolean> {
  return false;
}

/** Users who joined through the verified user's referral link. */
export async function fetchReferredUsers(_telegramId: number): Promise<ReferredUser[]> {
  const initData = rawInitData();
  if (!initData) return [];
  try {
    const res = await getReferredUsers({ data: { initData } });
    return res.ok ? (res.users as unknown as ReferredUser[]) : [];
  } catch (e) {
    console.error("[azox-backend] fetchReferredUsers failed", e);
    return [];
  }
}

export type WalletRegistration = {
  wallet_address: string;
  registered_at: string | null;
};

/** Only a mainnet (chain 4663) row for the verified user is returned. */
export async function fetchWalletRegistration(
  _telegramId: number,
): Promise<WalletRegistration | null> {
  const initData = rawInitData();
  if (!initData) return null;
  try {
    const res = await getMyWalletRegistration({ data: { initData } });
    return res.ok ? res.registration : null;
  } catch (e) {
    console.error("[azox-backend] fetchWalletRegistration failed", e);
    return null;
  }
}

/**
 * Server verifies the payment on chain 4663, then saves the first mainnet
 * registration and flags the user as airdrop registered.
 */
export async function saveWalletRegistration(params: {
  walletAddress: string;
  txHash: string;
}): Promise<WalletRegistration | null> {
  const initData = rawInitData();
  if (!initData) return null;
  try {
    const res = await registerAirdropWalletFn({ data: { initData, ...params } });
    if (res.ok) return (res.registration as WalletRegistration | null) ?? null;
    console.warn("[azox-backend] registerAirdropWallet rejected:", res.error);
  } catch (e) {
    console.error("[azox-backend] saveWalletRegistration failed", e);
  }
  return null;
}
