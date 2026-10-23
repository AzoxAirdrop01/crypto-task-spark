import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), helpers: vi.fn() }));

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
  isGameEnabled: async (id: string) => id !== "global-button" && id !== "main-tap",
}));
vi.mock("./azox-secure.server", () => {
  mocks.helpers();
  return {};
});

import { claimReward, globalButtonPress } from "./azox-secure.functions";

describe("game switch gate", () => {
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
});
