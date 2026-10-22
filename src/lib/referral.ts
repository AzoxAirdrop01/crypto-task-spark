/**
 * Pure referral attribution logic (no IO). The server wires real database
 * calls into `runReferralSync`; tests wire an in-memory fake.
 *
 * The one-time reward amounts live in the DB's apply_referral_reward function;
 * attribution (referrals row, referred_by, referral_count) stays inside the
 * existing upsert_user flow for newly created users. This layer makes
 * sure upsert_user only ever receives a code that is valid, not the user's
 * own, and only for a brand-new user.
 */

/** @deprecated Legacy test-fixture amount only; live amounts are decided in the DB. */
export const REFERRAL_REWARD = 1000;

/** Telegram start_param allows A-Z a-z 0-9 _ - and up to 512 chars. */
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim();
  return CODE_RE.test(code) ? code : null;
}

export type ReferralDeps = {
  /** True when a users row already exists for this Telegram id. */
  userExists: (telegramId: number) => Promise<boolean>;
  /** telegram_id owning this referral_code, or null. */
  findReferrerByCode: (code: string) => Promise<number | null>;
  /** Calls upsert_user with this referral code (or null). */
  upsertUser: (referralCode: string | null) => Promise<void>;
  /** Current users.referred_by of a user. */
  readReferredBy: (telegramId: number) => Promise<number | null>;
  /** Recomputes the referrer's rank (grant_points(referrer, 0)). */
  recomputeRank: (telegramId: number) => Promise<void>;
};

export type ReferralOutcome =
  | "attributed"
  | "existing_user"
  | "no_code"
  | "invalid_code"
  | "unknown_code"
  | "self_referral"
  | "not_applied";

export async function runReferralSync(
  telegramId: number,
  startParam: string | null,
  deps: ReferralDeps,
): Promise<{ outcome: ReferralOutcome; referrerId: number | null }> {
  const isNew = !(await deps.userExists(telegramId));

  let code: string | null = null;
  let outcome: ReferralOutcome = "no_code";
  let referrerId: number | null = null;

  if (!isNew) {
    outcome = "existing_user";
  } else if (startParam) {
    const normalized = normalizeReferralCode(startParam);
    if (!normalized) {
      outcome = "invalid_code";
    } else {
      const owner = await deps.findReferrerByCode(normalized);
      if (owner === null) outcome = "unknown_code";
      else if (owner === telegramId) outcome = "self_referral";
      else {
        code = normalized;
        referrerId = owner;
      }
    }
  }

  // Existing users and rejected codes never pass a code to upsert_user.
  await deps.upsertUser(code);

  if (code && referrerId !== null) {
    const referredBy = await deps.readReferredBy(telegramId);
    if (referredBy === referrerId) {
      try {
        await deps.recomputeRank(referrerId);
      } catch (e) {
        console.error("[referral] referrer rank recompute failed", e);
      }
      return { outcome: "attributed", referrerId };
    }
    return { outcome: "not_applied", referrerId: null };
  }
  return { outcome, referrerId: null };
}
