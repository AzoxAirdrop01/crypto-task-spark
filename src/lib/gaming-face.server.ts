// Server-only cached reader for the admin Gaming face (service-role RPC).
import { db } from "./azox-secure.server";
import { parseGamingFace, type GamingFace } from "./gaming-face";

const TTL_MS = 30_000;
let cached: { value: GamingFace; at: number } | null = null;
let inflight: Promise<GamingFace> | null = null;

/** 30s module cache, one shared in-flight request; never throws (fail-open). */
export async function getGamingFaceCached(): Promise<GamingFace> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await db().rpc("get_gaming_face");
      if (error) throw new Error(error.message);
      const value = parseGamingFace(data);
      cached = { value, at: Date.now() };
      return value;
    } catch {
      console.error("[gaming-face] read failed");
      return cached?.value ?? 1;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test-only reset. */
export function resetGamingFaceCache(): void {
  cached = null;
  inflight = null;
}