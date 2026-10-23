import { MINI_APP_URL } from "./referral-link";

export type PickResult = "ok" | "self" | "no_referrer" | "already_registered" | "limit" | "error";
export type BotDeps = {
  getFace: () => Promise<1 | 2>;
  recordPick: (referrerId: number, friendId: number) => Promise<PickResult>;
  getReferralLink: (telegramId: number) => Promise<string | null>;
  send: (chatId: number, text: string, extra?: Record<string, unknown>) => Promise<void>;
};
export const FRIEND_REQUEST_ID = 1;
export const MAX_FRIENDS_PER_PICK = 10;

/** Compare all characters without a content-dependent early exit. */
export function verifyWebhookSecret(header: string | null, expected: string | undefined): boolean {
  if (!expected || header === null) return false;
  let difference = header.length ^ expected.length;
  for (let i = 0; i < Math.max(header.length, expected.length); i++) {
    difference |= (header.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function userId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

const openApp = { reply_markup: { inline_keyboard: [[{ text: "Open AZOX", url: MINI_APP_URL }]] } };
const removeKeyboard = { reply_markup: { remove_keyboard: true } };
const inactive = "Friend invites are not active right now.";

export async function handleBotUpdate(update: unknown, deps: BotDeps): Promise<void> {
  const message = object(object(update)?.["message"]);
  const chat = object(message?.["chat"]);
  const sender = object(message?.["from"]);
  if (!message || chat?.["type"] !== "private" || !userId(chat["id"]) ||
      !sender || !userId(sender["id"]) || sender["is_bot"] === true) return;
  const senderId = sender["id"];
  const chatId = chat["id"];

  if ("users_shared" in message || "user_shared" in message) {
    const shared = object(message["users_shared"] ?? message["user_shared"]);
    if (shared?.["request_id"] !== FRIEND_REQUEST_ID) return;
    const users = "users_shared" in message
      ? shared["users"]
      : [{ user_id: shared["user_id"] }];
    if (!Array.isArray(users)) return;
    const ids = [...new Set(users.map((user) => object(user)?.["user_id"])
      .filter((id): id is number => userId(id) && id !== senderId))]
      .slice(0, MAX_FRIENDS_PER_PICK);
    if (!ids.length) return;
    if (await deps.getFace() !== 2) {
      await deps.send(chatId, inactive, removeKeyboard);
      return;
    }
    const counts: Record<PickResult, number> = {
      ok: 0, self: 0, no_referrer: 0, already_registered: 0, limit: 0, error: 0,
    };
    for (const id of ids) {
      const result = await deps.recordPick(senderId, id);
      counts[result]++;
    }
    const lines: string[] = [];
    if (counts.ok) lines.push(`Saved ${counts.ok} friend(s). If they join AZOX with your link, you earn the referral bonus together.`);
    if (counts.already_registered) lines.push(`${counts.already_registered} friend(s) already use AZOX, so no referral bonus is possible for them.`);
    if (counts.no_referrer) lines.push("Open the AZOX app once first, then try again.");
    if (counts.limit) lines.push("You reached the maximum number of saved friends.");
    if (counts.error) lines.push("Something went wrong. Please try again later.");
    if (lines.length) await deps.send(chatId, lines.join("\n"), removeKeyboard);
    if (counts.ok > 0) {
      try {
        const link = await deps.getReferralLink(senderId);
        if (link) {
          await deps.send(chatId, `Join me on AZOX and earn points:\n${link}`, {
            reply_markup: { inline_keyboard: [[{ text: "Open AZOX", url: link }]] },
          });
          await deps.send(chatId,
            "Forward the message above to your picked friends: hold it, tap Forward, and select several chats.",
          );
        }
      } catch {
        // Picks are already saved; invite lookup or delivery must not fail the update.
      }
    }
    return;
  }

  const text = message["text"];
  if (typeof text !== "string") return;
  const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/.exec(text.trim());
  if (!start) return;
  if (start[1] !== "invite") {
    await deps.send(chatId, "Welcome to AZOX.", openApp);
    return;
  }
  if (await deps.getFace() !== 2) {
    await deps.send(chatId, inactive, openApp);
    return;
  }
  await deps.send(chatId,
    "Pick the friends you want to invite from your Telegram list. If they join AZOX with your link, you both get the referral bonus.",
    { reply_markup: {
      keyboard: [[{ text: "👥 Pick friends", request_users: {
        request_id: FRIEND_REQUEST_ID, user_is_bot: false, max_quantity: MAX_FRIENDS_PER_PICK,
      } }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    } },
  );
}