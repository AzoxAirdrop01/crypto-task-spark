import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), helpers: vi.fn(), face: vi.fn(), enabled: vi.fn(), claimTapBatch: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: (validate: (data: unknown) => unknown) => ({
      handler: (handler: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
        handler({ data: validate(input.data) }),
    }),
  }),
}));
vi.mock("./telegram-auth.server", () => ({ verifyTelegramInitData: mocks.verify }));
vi.mock("./game-switches.server", () => ({
  isGameEnabled: mocks.enabled,
}));
vi.mock("./gaming-face.server", () => ({ getGamingFaceCached: mocks.face }));
vi.mock("./azox-secure.server", () => {
  mocks.helpers();
  return { claimTapBatch: mocks.claimTapBatch, utcDay: () => "2026-10-23" };
});

import { claimReward, completeDailyGame, globalButtonPress } from "./azox-secure.functions";

describe("game switch gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ ok: true, user: { id: 7 } });
    mocks.face.mockResolvedValue(1);
    mocks.enabled.mockImplementation(async (id: string) => id !== "global-button" && id !== "main-tap");
    mocks.claimTapBatch.mockResolvedValue({ status: "granted", points: 5, rank: "Bronze" });
  });

  it("refuses a paused game before any DB write", async () => {
    mocks.verify.mockResolvedValue({ ok: true, user: { id: 7 } });
    const r = await globalButtonPress({ data: { initData: "fixture" } });
    expect(r).toEqual({ ok: false, error: "game_disabled" });
    expect(mocks.helpers).not.toHaveBeenCalled();
  });

  it("refuses a tap_batch as game main-tap before any DB write", async () => {
    mocks.verify.mockResolvedValue({ ok: true, user: { id: 7 } });
    const r = await claimReward({
      data: {
        initData: "fixture",
        claim: { type: "tap_batch", batchId: "abcdefgh12", tapUnits: 5 },
      },
    });
    expect(r).toEqual({ ok: false, error: "game_disabled" });
    expect(mocks.helpers).not.toHaveBeenCalled();
  });

  it.each(["shoot", "global-button", "word"])("Face 2 refuses %s before any write", async (game) => {
    mocks.face.mockResolvedValue(2);
    mocks.enabled.mockResolvedValue(true);
    const result = game === "shoot"
      ? await claimReward({ data: { initData: "fixture", claim: { type: "game_score", gameId: "shoot", score: 1 } } })
      : game === "word"
        ? await completeDailyGame({ data: { initData: "fixture", game: "word", indices: [0] } })
        : await globalButtonPress({ data: { initData: "fixture" } });
    expect(result).toEqual({ ok: false, error: "game_disabled" });
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.helpers).not.toHaveBeenCalled();
    expect(mocks.claimTapBatch).not.toHaveBeenCalled();
  });

  it("Face 2 leaves Main Tap payable when its own switch is ON", async () => {
    mocks.face.mockResolvedValue(2);
    mocks.enabled.mockResolvedValue(true);
    const result = await claimReward({ data: {
      initData: "fixture", claim: { type: "tap_batch", batchId: "abcdefgh12", tapUnits: 5 },
    } });
    expect(result).toEqual({ ok: true, granted: true, points: 5, rank: "Bronze" });
    expect(mocks.enabled).toHaveBeenCalledWith("main-tap");
    expect(mocks.claimTapBatch).toHaveBeenCalledWith(7, "abcdefgh12", 5);
  });

  it.each([false, true])("Face 1 respects Main Tap switch enabled=%s", async (enabled) => {
    mocks.enabled.mockResolvedValue(enabled);
    const result = await claimReward({ data: {
      initData: "fixture", claim: { type: "tap_batch", batchId: "abcdefgh12", tapUnits: 5 },
    } });
    expect(result).toEqual(enabled
      ? { ok: true, granted: true, points: 5, rank: "Bronze" }
      : { ok: false, error: "game_disabled" });
    expect(mocks.enabled).toHaveBeenCalledWith("main-tap");
    expect(mocks.claimTapBatch).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it.each([false, true])("failed face read respects Main Tap switch enabled=%s", async (enabled) => {
    mocks.face.mockRejectedValue(new Error("unavailable"));
    mocks.enabled.mockResolvedValue(enabled);
    const result = await claimReward({ data: {
      initData: "fixture", claim: { type: "tap_batch", batchId: "abcdefgh12", tapUnits: 5 },
    } });
    expect(result).toEqual(enabled
      ? { ok: true, granted: true, points: 5, rank: "Bronze" }
      : { ok: false, error: "game_disabled" });
    expect(mocks.enabled).toHaveBeenCalledWith("main-tap");
    expect(mocks.claimTapBatch).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });
});
