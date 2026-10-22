import { createFileRoute } from "@tanstack/react-router";
import { handleBotUpdate, verifyWebhookSecret, type BotDeps, type PickResult } from "@/lib/telegram-bot-updates";

const MAX_BODY_BYTES = 64 * 1024;
const PICK_RESULTS = new Set<PickResult>(["ok", "self", "no_referrer", "already_registered", "limit"]);

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
        if (!secret) {
          console.error("[telegram-webhook] secret not configured");
          return Response.json({ error: "not_configured" }, { status: 503 });
        }
        if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
          return Response.json({ error: "too_large" }, { status: 413 });
        }
        let update: unknown;
        try {
          // Bound the actual streamed bytes as well as Content-Length.
          const reader = request.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_BODY_BYTES) {
                await reader.cancel();
                return Response.json({ error: "too_large" }, { status: 413 });
              }
              chunks.push(value);
            }
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          update = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        try {
          const { getGamingFaceCached } = await import("@/lib/gaming-face.server");
          const { db } = await import("@/lib/azox-secure.server");
          const deps: BotDeps = {
            getFace: getGamingFaceCached,
            recordPick: async (referrerId, friendId) => {
              try {
                const { data, error } = await db().rpc("record_friend_pick", {
                  p_referrer: referrerId, p_friend: friendId,
                });
                return !error && PICK_RESULTS.has(data) ? data as PickResult : "error";
              } catch {
                return "error";
              }
            },
            send: async (chatId, text, extra) => {
              const token = process.env["TELEGRAM_BOT_TOKEN"];
              if (!token) {
                console.error("[telegram-webhook] bot token not configured");
                return;
              }
              const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text, ...extra }),
              });
              if (!response.ok) console.error("[telegram-webhook] send failed", response.status);
            },
          };
          await handleBotUpdate(update, deps);
        } catch {
          console.error("[telegram-webhook] handler failed");
        }
        return Response.json({ ok: true });
      },
    },
  },
});