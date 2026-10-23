import { getExternalSupabaseAdmin } from "@/integrations/external-supabase/admin.server";
import { verifyTelegramInitData } from "./telegram-auth.server";
import { locationInput, policyInput } from "./access-schemas";
import { LOCATION_MIN_INTERVAL_SECONDS } from "./location-limits";
import { captureGpsGeo, captureIpGeo } from "./geo-capture.server";

// Access policy + location writes for the VERIFIED Telegram user only.
// Never log coordinates or initData.
export type GpsMode = "off" | "optional" | "required";
type AuthError = "invalid" | "missing" | "stale" | "not_configured" | "server_error";
export type AccessFailure = { ok: false; error: AuthError | "banned" };
const fail = (error: AccessFailure["error"]): AccessFailure => ({ ok: false, error });

async function verifiedId(initData: string): Promise<number | AccessFailure> {
  const a = await verifyTelegramInitData(initData);
  return a.ok ? a.user.id : fail(a.error);
}

async function policyFor(id: number): Promise<{ banned: boolean; gps: GpsMode } | null> {
  const { data, error } = await getExternalSupabaseAdmin().rpc("get_access_policy", {
    p_telegram_id: id,
  });
  if (error || !data) return null;
  const d = data as { banned?: unknown; gps?: unknown };
  const gps: GpsMode = d.gps === "required" || d.gps === "optional" ? d.gps : "off";
  return { banned: d.banned === true, gps };
}

// Record the caller IP for a VERIFIED user. Awaited inside its own try/catch
// with a hard timeout so it can never slow down, fail or block the policy
// response. Never logs the IP or initData.
async function recordCallerIp(id: number): Promise<void> {
  try {
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const { pickClientIp } = await import("./client-ip");
    const ip = pickClientIp(getRequestHeaders());
    if (!ip) return;
    await Promise.race([
      getExternalSupabaseAdmin().rpc("record_ip", { p_telegram_id: id, p_ip: ip }),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  } catch {
    // Swallow: IP logging must never affect the policy response.
  }
}

export async function readAccessPolicy(
  input: unknown,
): Promise<{ ok: true; banned: boolean; gps: GpsMode } | AccessFailure> {
  try {
    const p = policyInput.safeParse(input);
    if (!p.success) return fail("missing");
    const id = await verifiedId(p.data.initData);
    if (typeof id !== "number") return id;
    await Promise.all([recordCallerIp(id), captureIpGeo(id)]);
    const pol = await policyFor(id);
    return pol ? { ok: true, ...pol } : fail("server_error");
  } catch {
    return fail("server_error");
  }
}

export async function writeLocation(
  input: unknown,
): Promise<{ ok: true; stored: boolean } | AccessFailure> {
  try {
    const p = locationInput.safeParse(input);
    if (!p.success) return fail("invalid");
    const id = await verifiedId(p.data.initData);
    if (typeof id !== "number") return id;
    const pol = await policyFor(id);
    if (!pol) return fail("server_error");
    if (pol.banned) return fail("banned");
    const { data, error } = await getExternalSupabaseAdmin().rpc("record_location", {
      p_telegram_id: id,
      p_latitude: p.data.latitude,
      p_longitude: p.data.longitude,
      p_accuracy: p.data.horizontalAccuracy ?? null,
      p_min_interval_seconds: LOCATION_MIN_INTERVAL_SECONDS,
    });
    if (error) return fail(error.code === "23514" ? "invalid" : "server_error");
    const stored = (data as { stored?: unknown } | null)?.stored === true;
    if (stored) {
      try {
        await captureGpsGeo(id, p.data.latitude, p.data.longitude);
      } catch {
        // swallow
      }
    }
    return { ok: true, stored };
  } catch {
    return fail("server_error");
  }
}
