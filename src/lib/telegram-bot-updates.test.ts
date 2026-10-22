import { describe, expect, it, vi } from "vitest";
import { handleBotUpdate, verifyWebhookSecret, type BotDeps, type PickResult } from "./telegram-bot-updates";
import { MINI_APP_URL } from "./referral-link";

function deps(face: 1 | 2 = 2) {
  return {
    getFace: vi.fn<BotDeps["getFace"]>().mockResolvedValue(face),
    recordPick: vi.fn<BotDeps["recordPick"]>().mockResolvedValue("ok"),
    send: vi.fn<BotDeps["send"]>().mockResolvedValue(undefined),
  };
}
function message(fields: Record<string, unknown>) {
  return { message: { chat: { id: 123, type: "private" }, from: { id: 123, is_bot: false }, ...fields } };
}
function shared(ids: unknown[], request_id = 1) {
  return message({ users_shared: { request_id, users: ids.map(user_id => ({ user_id })) } });
}
const removed = { reply_markup: { remove_keyboard: true } };
const openApp = { reply_markup: { inline_keyboard: [[{ text: "Open AZOX", url: MINI_APP_URL }]] } };

describe("Telegram friend picker", () => {
  it.each(["/start invite", "/start@AZOX_Airdrop_bot invite"])("sends Face 2 picker for %s", async (text) => {
    const d = deps();
    await handleBotUpdate(message({ text }), d);
    expect(d.send).toHaveBeenCalledWith(123,
      "Pick the friends you want to invite from your Telegram list. If they join AZOX with your link, you both get the referral bonus.",
      { reply_markup: { keyboard: [[{ text: "👥 Pick friends", request_users: {
        request_id: 1, user_is_bot: false, max_quantity: 10,
      } }]], resize_keyboard: true, one_time_keyboard: true } });
  });

  it("sends only an inactive notice and Open AZOX on Face 1", async () => {
    const d = deps(1);
    await handleBotUpdate(message({ text: "/start invite" }), d);
    expect(d.send).toHaveBeenCalledExactlyOnceWith(123, "Friend invites are not active right now.", openApp);
    expect(d.recordPick).not.toHaveBeenCalled();
  });

  it.each(["/start", "/start other", "/start@AZOX_Airdrop_bot other", "/start invite-other"])("welcomes %s", async (text) => {
    const d = deps();
    await handleBotUpdate(message({ text }), d);
    expect(d.send).toHaveBeenCalledWith(123, "Welcome to AZOX.", openApp);
    expect(d.getFace).not.toHaveBeenCalled();
  });

  it("deduplicates, skips self and invalid ids, and saves at most ten friends", async () => {
    const d = deps();
    await handleBotUpdate(shared([123, 200, 200, 0, -2, 1.5, "201", null, ...Array.from({ length: 15 }, (_, i) => 201 + i)]), d);
    expect(d.recordPick.mock.calls).toEqual(Array.from({ length: 10 }, (_, i) => [123, 200 + i]));
    expect(d.send).toHaveBeenCalledExactlyOnceWith(123,
      "Saved 10 friend(s). If they join AZOX with your link, you earn the referral bonus together.", removed);
  });

  it("ignores another request id", async () => {
    const d = deps();
    await handleBotUpdate(shared([200], 2), d);
    expect(d.recordPick).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.getFace).not.toHaveBeenCalled();
  });

  it("accepts legacy user_shared", async () => {
    const d = deps();
    await handleBotUpdate(message({ user_shared: { request_id: 1, user_id: 200 } }), d);
    expect(d.recordPick).toHaveBeenCalledExactlyOnceWith(123, 200);
    expect(d.send).toHaveBeenCalledWith(123, expect.stringContaining("Saved 1 friend(s)."), removed);
  });

  it("records no picks on Face 1 and removes the keyboard", async () => {
    const d = deps(1);
    await handleBotUpdate(shared([200]), d);
    expect(d.recordPick).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledExactlyOnceWith(123, "Friend invites are not active right now.", removed);
  });

  it.each<[PickResult, string]>([
    ["ok", "Saved 1 friend(s). If they join AZOX with your link, you earn the referral bonus together."],
    ["already_registered", "1 friend(s) already use AZOX, so no referral bonus is possible for them."],
    ["no_referrer", "Open the AZOX app once first, then try again."],
    ["limit", "You reached the maximum number of saved friends."],
    ["error", "Something went wrong. Please try again later."],
  ])("summarizes %s and removes the keyboard", async (result, text) => {
    const d = deps();
    d.recordPick.mockResolvedValue(result);
    await handleBotUpdate(shared([200]), d);
    expect(d.send).toHaveBeenCalledExactlyOnceWith(123, text, removed);
  });

  it("joins only applicable summary lines in one reply", async () => {
    const d = deps();
    d.recordPick.mockResolvedValueOnce("ok").mockResolvedValueOnce("already_registered")
      .mockResolvedValueOnce("limit").mockResolvedValueOnce("error");
    await handleBotUpdate(shared([200, 201, 202, 203]), d);
    expect(d.send).toHaveBeenCalledExactlyOnceWith(123, [
      "Saved 1 friend(s). If they join AZOX with your link, you earn the referral bonus together.",
      "1 friend(s) already use AZOX, so no referral bonus is possible for them.",
      "You reached the maximum number of saved friends.",
      "Something went wrong. Please try again later.",
    ].join("\n"), removed);
  });

  it.each([
    null, undefined, 42, "garbage", [], {}, { message: null },
    message({ chat: { id: -123, type: "group" }, text: "/start invite" }),
    message({ from: { id: 123, is_bot: true }, text: "/start invite" }),
    message({ from: undefined, text: "/start invite" }),
    message({ chat: { type: "private" }, text: "/start invite" }),
    message({ from: { id: 0 }, text: "/start invite" }),
    message({ users_shared: null }), message({ users_shared: { request_id: 1, users: "junk" } }),
    message({ users_shared: { request_id: 1, users: [null, {}, { user_id: -2 }] } }),
    message({ user_shared: { request_id: 1, user_id: 123 } }),
    message({ text: "hello" }), message({ text: 1 }),
  ])("silently ignores malformed or unexpected input %#", async (update) => {
    const d = deps();
    await expect(handleBotUpdate(update, d)).resolves.toBeUndefined();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.recordPick).not.toHaveBeenCalled();
    expect(d.getFace).not.toHaveBeenCalled();
  });
});

describe("Webhook secret verification", () => {
  it("accepts equal secrets", () => expect(verifyWebhookSecret("test-secret", "test-secret")).toBe(true));
  it.each<[string | null, string | undefined]>([
    ["test-secret", "other-value"], ["test-secret-extra", "test-secret"], ["short", "longer"],
    ["", "test-secret"], [null, "test-secret"], ["test-secret", ""], ["", ""],
    ["test-secret", undefined], [null, undefined], ["a\0", "a"],
  ])("rejects unequal or missing secrets %#", (header, expected) => {
    expect(verifyWebhookSecret(header, expected)).toBe(false);
  });
});