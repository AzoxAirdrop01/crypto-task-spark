import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TAP_BATCH_MAX_UNITS } from "@/lib/tap-batch";

const Body = z.object({
  initData: z.string().min(1).max(8192),
  batchId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  tapUnits: z.number().int().min(1).max(TAP_BATCH_MAX_UNITS),
});

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

// Keepalive Main Tap flush (sent when the Mini App is hidden/closed).
export const Route = createFileRoute("/api/public/tap-flush")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return json({ ok: false, error: "invalid" }, 400);
          }
          const parsed = Body.safeParse(raw);
          if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
          const { verifyTelegramInitData } = await import("@/lib/telegram-auth.server");
          const auth = await verifyTelegramInitData(parsed.data.initData);
          if (!auth.ok) return json({ ok: false, error: auth.error }, 401);
          const { isGameEnabled } = await import("@/lib/game-switches.server");
          if (!(await isGameEnabled("main-tap")))
            return json({ ok: false, error: "game_disabled" });
          const { claimTapBatch } = await import("@/lib/azox-secure.server");
          const { mapClaimStatus } = await import("@/lib/claim-status");
          const m = mapClaimStatus(
            await claimTapBatch(auth.user.id, parsed.data.batchId, parsed.data.tapUnits),
          );
          if (!m.ok) {
            const error = m.error === "cooldown" ? "cooldown" : "server_error";
            return json({ ok: false, error });
          }
          return json({ ok: true, granted: m.granted, points: m.points, rank: m.rank });
        } catch {
          console.error("[tap-flush] failed");
          return json({ ok: false, error: "server_error" }, 500);
        }
      },
    },
  },
});
