import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { referralLinkFor } from "./referral-link";

const mocks = vi.hoisted(() => ({
  face: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), read: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/gaming-face.server", () => ({ getGamingFaceCached: mocks.face }));
vi.mock("@/lib/azox-secure.server", () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

import { Route } from "@/routes/api/public/telegram/webhook";

type Handler = (input: { request: Request }) => Promise<Response>;
const post = (Route as unknown as { server: { handlers: { POST: Handler } } }).server.handlers.POST;
const request = () => new Request("http://localhost/api/public/telegram/webhook", {
  method: "POST",
  headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "fixture-secret" },
  body: JSON.stringify({ message: {
    chat: { id: 123, type: "private" }, from: { id: 123, is_bot: false },
    users_shared: { request_id: 1, users: [{ user_id: 200 }, { user_id: 201 }] },
  } }),
});
const sentMessages = () => mocks.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-token");
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.face.mockResolvedValue(2);
  mocks.rpc.mockResolvedValue({ data: "ok", error: null });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
  mocks.read.mockResolvedValue({ data: { referral_code: "AZOX123" }, error: null });
  mocks.fetch.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Telegram webhook forwardable invites", () => {
  it("reads only the referrer's code and sends their personal card only to their chat", async () => {
    const res = await post({ request: request() });
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("users");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("referral_code");
    expect(mocks.eq).toHaveBeenCalledExactlyOnceWith("telegram_id", 123);
    const messages = sentMessages();
    expect(messages).toHaveLength(3);
    expect(messages.map(message => message.chat_id)).toEqual([123, 123, 123]);
    expect(messages[1].text).toContain(referralLinkFor("AZOX123"));
    expect(messages[1].reply_markup.inline_keyboard[0][0].url).toBe(referralLinkFor("AZOX123"));
    expect(messages[1]).not.toHaveProperty("protect_content");
  });

  it.each([null, { referral_code: null }, { referral_code: "" }])("skips the card without a referral code %#", async (data) => {
    mocks.read.mockResolvedValue({ data, error: null });
    expect((await post({ request: request() })).status).toBe(200);
    expect(sentMessages()).toHaveLength(1);
  });

  it("keeps the confirmation when the code read throws", async () => {
    mocks.read.mockRejectedValue(new Error("unavailable"));
    expect(await (await post({ request: request() })).json()).toEqual({ ok: true });
    expect(sentMessages()).toHaveLength(1);
  });

  it("acknowledges delivery errors without retrying or messaging friends", async () => {
    mocks.fetch.mockRejectedValue(new Error("unavailable"));
    expect(await (await post({ request: request() })).json()).toEqual({ ok: true });
    expect(sentMessages().map(message => message.chat_id)).toEqual([123]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});