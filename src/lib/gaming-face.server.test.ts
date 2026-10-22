import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./azox-secure.server", () => ({ db: () => ({ rpc: mocks.rpc }) }));

import { getGamingFaceCached, resetGamingFaceCache } from "./gaming-face.server";

describe("Gaming face cache", () => {
  beforeEach(() => {
    resetGamingFaceCache();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("caches for 30 seconds", async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await getGamingFaceCached()).toBe(2);
    vi.advanceTimersByTime(29_999);
    expect(await getGamingFaceCached()).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ data: 1, error: null });
    vi.advanceTimersByTime(1);
    expect(await getGamingFaceCached()).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("get_gaming_face");
  });

  it("shares one in-flight request", async () => {
    let resolveRead: (value: { data: number; error: null }) => void = () => undefined;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const first = getGamingFaceCached();
    const second = getGamingFaceCached();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    resolveRead({ data: 2, error: null });
    expect(await Promise.all([first, second])).toEqual([2, 2]);
  });

  it("fails open to Face 1 on RPC errors and thrown failures", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect(await getGamingFaceCached()).toBe(1);
    mocks.rpc.mockRejectedValueOnce(new Error("down"));
    expect(await getGamingFaceCached()).toBe(1);
  });

  it("returns the last cached face when a later read fails", async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValueOnce({ data: "2", error: null });
    expect(await getGamingFaceCached()).toBe(2);
    vi.advanceTimersByTime(30_001);
    mocks.rpc.mockRejectedValueOnce(new Error("down"));
    expect(await getGamingFaceCached()).toBe(2);
  });
});