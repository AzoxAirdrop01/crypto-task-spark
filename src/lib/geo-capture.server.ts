import { getExternalSupabaseAdmin } from "@/integrations/external-supabase/admin.server";
import { zonesFor } from "./geo-zones";

// Coarse geo capture for VERIFIED users. Never throws, never logs location data.
const TIMEOUT_MS = 1500;

type CfGeo = {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function country(v: unknown): string | null {
  const s = str(v)?.toUpperCase() ?? null;
  if (!s || !/^[A-Z]{2}$/.test(s) || s === "XX" || s === "T1") return null;
  return s;
}

async function readCf(): Promise<CfGeo> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const cf = (request as unknown as { cf?: Record<string, unknown> } | undefined)?.cf;
  if (cf && typeof cf === "object") {
    return {
      country: country(cf["country"]),
      region: str(cf["region"]),
      city: str(cf["city"]),
      lat: num(cf["latitude"]),
      lon: num(cf["longitude"]),
    };
  }
  return {
    country: country(request?.headers?.get("cf-ipcountry")),
    region: null,
    city: null,
    lat: null,
    lon: null,
  };
}

async function guarded(work: () => Promise<unknown>): Promise<void> {
  try {
    await Promise.race([
      work().catch(() => undefined),
      new Promise((res) => setTimeout(res, TIMEOUT_MS)),
    ]);
  } catch {
    // never affect the caller
  }
}

export async function captureIpGeo(userId: number): Promise<void> {
  await guarded(async () => {
    const g = await readCf();
    await getExternalSupabaseAdmin().rpc("upsert_user_geo", {
      p_telegram_id: userId,
      p_country: g.country,
      p_region: g.region,
      p_city: g.city,
      p_lat: g.lat,
      p_lon: g.lon,
      p_source: "ip",
      p_zones: zonesFor({ lat: g.lat, lon: g.lon, country: g.country }),
    });
  });
}

export async function captureGpsGeo(userId: number, lat: number, lon: number): Promise<void> {
  await guarded(async () => {
    let c: string | null = null;
    try {
      c = (await readCf()).country;
    } catch {
      c = null;
    }
    await getExternalSupabaseAdmin().rpc("upsert_user_geo", {
      p_telegram_id: userId,
      p_country: c,
      p_region: null,
      p_city: null,
      p_lat: lat,
      p_lon: lon,
      p_source: "gps",
      p_zones: zonesFor({ lat, lon, country: c }),
    });
  });
}
