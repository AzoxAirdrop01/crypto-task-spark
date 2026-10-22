import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { GamingFace } from "./gaming-face";

type Result = { ok: true; face: GamingFace } | { ok: false; error: string };

export const getGamingFace = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ initData: z.string().min(1).max(8192) }).parse(d))
  .handler(async ({ data }): Promise<Result> => {
    const { verifyTelegramInitData } = await import("./telegram-auth.server");
    const v = await verifyTelegramInitData(data.initData);
    if (!v.ok) return { ok: false, error: v.error };
    const { getGamingFaceCached } = await import("./gaming-face.server");
    return { ok: true, face: await getGamingFaceCached() };
  });