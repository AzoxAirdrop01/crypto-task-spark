import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  isGameEnabled: vi.fn(),
  claimTapBatch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
}));
vi.mock("@/lib/telegram-auth.server", () => ({ verifyTelegramInitData: mocks.verify }));
vi.mock("@/lib/game-switches.server", () => ({ isGameEnabled: mocks.isGameEnabled }));
vi.mock("@/lib/azox-secure.server", () => ({ claimTapBatch: mocks.claimTapBatch }));

import { Route } from "@/routes/api/public/tap-flush";

type Handler = (input: { request: Request }) => Promise<Response>;
const post = (Route as unknown as { server: { handlers: { POST: Handler } } }).server.handlers.POST;

const BODY = { initData: "fixture-initdata", batchId: "abcdefgh12", tapUnits: 5 };

const send = (body: unknown) =>
  post({
    request: new Request("http://localhost/api/public/tap-flush", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  });

beforeEach(() => {
  mocks.verify.mockReset();
  mocks.isGameEnabled.mockReset();
  mocks.claimTapBatch.mockReset();
  mocks.verify.mockResolvedValue({ ok: true, user: { id: 7 } });
  mocks.isGameEnabled.mockResolvedValue(true);
  mocks.claimTapBatch.mockResolvedValue({ status: "granted", points: 120, rank: "Silver" });
});

describe("tap-flush keepalive route", () => {
  it("refuses with game_disabled and never claims while main-tap is paused", async () => {
    mocks.isGameEnabled.mockResolvedValue(false);
    const res = await send(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "game_disabled" });
    expect(mocks.isGameEnabled).toHaveBeenCalledWith("main-tap");
    expect(mocks.claimTapBatch).not.toHaveBeenCalled();
  });

  it("still pays out while the switch is on", async () => {
    const res = await send(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, granted: true, points: 120, rank: "Silver" });
    expect(mocks.claimTapBatch).toHaveBeenCalledWith(7, "abcdefgh12", 5);
  });

  it("checks the switch only after initData is verified", async () => {
    mocks.verify.mockResolvedValue({ ok: false, error: "invalid_initdata" });
    const res = await send(BODY);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_initdata" });
    expect(mocks.isGameEnabled).not.toHaveBeenCalled();
    expect(mocks.claimTapBatch).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before verifying or claiming", async () => {
    const res = await send({ initData: "", batchId: "x", tapUnits: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.claimTapBatch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await send("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
    expect(mocks.claimTapBatch).not.toHaveBeenCalled();
  });

  it("keeps the cooldown response shape", async () => {
    mocks.claimTapBatch.mockResolvedValue({ status: "cooldown", points: 0, rank: null });
    const res = await send(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "cooldown" });
  });
});
