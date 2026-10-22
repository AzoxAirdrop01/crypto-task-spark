import { z } from "zod";
import { getExternalSupabaseAdmin } from "@/integrations/external-supabase/admin.server";
import { verifyTelegramInitData } from "./telegram-auth.server";

// Restricted-table reads for the VERIFIED Telegram user only.
const schema = z.object({ initData: z.string().min(1).max(8192) });
export type ProfileFailure = {
  ok: false;
  error: "invalid" | "missing" | "stale" | "not_configured" | "server_error";
};
const failure = (error: ProfileFailure["error"]): ProfileFailure => ({ ok: false, error });

export const USER_COLUMNS =
  "telegram_id,username,first_name,last_name,points,tasks_done,referral_code,referred_by,referral_count,photo_url,rank,joined_at,last_seen";
const REFERRED_COLUMNS = "telegram_id,username,first_name,last_name,photo_url,points,joined_at";

type Row = Record<string, string | number | boolean | null>;

async function verified(input: unknown): Promise<number | ProfileFailure> {
  const p = schema.safeParse(input);
  if (!p.success) return failure("missing");
  const a = await verifyTelegramInitData(p.data.initData);
  return a.ok ? a.user.id : failure(a.error);
}

export async function readMyUser(
  input: unknown,
): Promise<{ ok: true; user: Row | null } | ProfileFailure> {
  try {
    const id = await verified(input);
    if (typeof id !== "number") return id;
    const { data, error } = await getExternalSupabaseAdmin()
      .from("users")
      .select(USER_COLUMNS)
      .eq("telegram_id", id)
      .maybeSingle();
    if (error) return failure("server_error");
    return { ok: true, user: (data as Row | null) ?? null };
  } catch {
    return failure("server_error");
  }
}

export async function readMyWalletRegistration(
  input: unknown,
): Promise<
  | { ok: true; registration: { wallet_address: string; registered_at: string | null } | null }
  | ProfileFailure
> {
  try {
    const id = await verified(input);
    if (typeof id !== "number") return id;
    const { data, error } = await getExternalSupabaseAdmin()
      .from("wallet_registrations")
      .select("wallet_address, registered_at")
      .eq("telegram_id", id)
      .eq("chain_id", 4663)
      .order("registered_at", { ascending: true })
      .limit(1);
    if (error) return failure("server_error");
    const row = (data as { wallet_address: string; registered_at: string | null }[] | null)?.[0];
    return {
      ok: true,
      registration: row
        ? { wallet_address: String(row.wallet_address), registered_at: row.registered_at ?? null }
        : null,
    };
  } catch {
    return failure("server_error");
  }
}

export async function readMyTaskCount(
  input: unknown,
): Promise<{ ok: true; count: number } | ProfileFailure> {
  try {
    const id = await verified(input);
    if (typeof id !== "number") return id;
    const { count, error } = await getExternalSupabaseAdmin()
      .from("user_tasks")
      .select("task_id", { count: "exact", head: true })
      .eq("telegram_id", id);
    if (error) return failure("server_error");
    return { ok: true, count: count ?? 0 };
  } catch {
    return failure("server_error");
  }
}

export async function readReferredUsers(
  input: unknown,
): Promise<{ ok: true; users: Row[] } | ProfileFailure> {
  try {
    const id = await verified(input);
    if (typeof id !== "number") return id;
    const { data, error } = await getExternalSupabaseAdmin()
      .from("users")
      .select(REFERRED_COLUMNS)
      .eq("referred_by", id)
      .order("joined_at", { ascending: false });
    if (error) return failure("server_error");
    const { data: rewards, error: rewardsError } = await getExternalSupabaseAdmin()
      .from("referrals")
      .select("referred_id, points_given")
      .eq("referrer_id", id);
    if (rewardsError) return failure("server_error");
    const pointsByUser = new Map(
      ((rewards as { referred_id: number; points_given: number | null }[] | null) ?? [])
        .map((row) => [String(row.referred_id), row.points_given ?? 1000]),
    );
    return {
      ok: true,
      users: ((data as Row[] | null) ?? []).map((row) => ({
        ...row,
        points_given: pointsByUser.get(String(row.telegram_id)) ?? 1000,
      })),
    };
  } catch {
    return failure("server_error");
  }
}
