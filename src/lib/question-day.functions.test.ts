import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  rpc: vi.fn(),
  start: vi.fn(),
  enabled: vi.fn(),
  face: vi.fn(),
  utcDay: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: (validate: (data: unknown) => unknown) => ({
      handler: (handler: (input: { data: unknown }) => unknown) =>
        (input: { data: unknown }) => handler({ data: validate(input.data) }),
    }),
  }),
}));
vi.mock("./telegram-auth.server", () => ({ verifyTelegramInitData: mocks.verify }));
vi.mock("./game-switches.server", () => ({ isGameEnabled: mocks.enabled }));
vi.mock("./gaming-face.server", () => ({ getGamingFaceCached: mocks.face }));
vi.mock("./azox-secure.server", () => ({
  db: () => ({
    rpc: (fn: string, args: unknown) =>
      fn === "start_daily_play" ? mocks.start(args) : mocks.rpc(fn, args),
  }),
  utcDay: mocks.utcDay,
}));

import { getDailyQuestions } from "./question-day.functions";

const input = { data: { initData: "verified-fixture" } };
const questions = Array.from({ length: 5 }, (_, slot) => ({
  slot,
  question: `Question ${slot + 1}?`,
  options: ["A", "B", "C", "D", "E"],
  correct: slot,
  difficulty: "easy",
}));

describe("Question Day verified daily reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.verify.mockResolvedValue({ ok: true, user: { id: 42 } });
    mocks.utcDay.mockReturnValue("2026-10-17");
    mocks.enabled.mockResolvedValue(true);
    mocks.face.mockResolvedValue(1);
    mocks.start.mockResolvedValue({ data: true, error: null });
    mocks.rpc.mockResolvedValue({
      data: { day: "2026-10-17", source_date: "2026-10-16", questions },
      error: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads the shared UTC day and returns only the five question fields", async () => {
    const result = await getDailyQuestions(input);
    expect(mocks.verify).toHaveBeenCalledWith("verified-fixture");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_daily_questions", {
      p_day: "2026-10-17",
    });
    expect(result).toEqual({
      ok: true,
      questions: questions.map(({ slot: _slot, ...question }) => question),
    });
  });

  it.each(["invalid", "stale", "not_configured", "missing"])(
    "does not access the database when verification fails with %s",
    async (error) => {
      mocks.verify.mockResolvedValue({ ok: false, error });
      expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([0, 4, 6])("rejects %i questions instead of exactly five", async (count) => {
    mocks.rpc.mockResolvedValue({
      data: { questions: Array.from({ length: count }, () => questions[0]) },
      error: null,
    });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it.each(["", "   "])("rejects a blank question (%j)", async (question) => {
    mocks.rpc.mockResolvedValue({
      data: { questions: [{ ...questions[0], question }, ...questions.slice(1)] },
      error: null,
    });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it.each([
    ["A", "B", "C", "D"],
    ["A", "B", "C", "D", "E", "F"],
    ["A", "B", "C", "D", ""],
    ["A", "B", "C", "D", "   "],
    ["A", "B", "C", "D", 5],
  ])("rejects invalid options %j", async (...options) => {
    mocks.rpc.mockResolvedValue({
      data: { questions: [{ ...questions[0], options }, ...questions.slice(1)] },
      error: null,
    });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it.each([-1, 5, 1.5, "1"])("rejects invalid correct index %j", async (correct) => {
    mocks.rpc.mockResolvedValue({
      data: { questions: [{ ...questions[0], correct }, ...questions.slice(1)] },
      error: null,
    });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it("accepts repeated option text and all three difficulties", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        questions: questions.map((question, index) => ({
          ...question,
          options: ["Same", "Same", "C", "D", "E"],
          difficulty: ["easy", "medium", "hard"][index % 3],
        })),
      },
      error: null,
    });
    expect((await getDailyQuestions(input)).ok).toBe(true);
  });

  it("returns unavailable without exposing RPC errors or thrown details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
    mocks.rpc.mockRejectedValue(new Error("private detail"));
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private detail");
  });

  it("fetches again on the next UTC day rather than caching", async () => {
    await getDailyQuestions(input);
    mocks.utcDay.mockReturnValue("2026-10-18");
    await getDailyQuestions(input);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_daily_questions", { p_day: "2026-10-18" });
  });

  it.each(["", "x".repeat(8193)])("rejects initData outside 1–8192 characters", (initData) => {
    expect(() => getDailyQuestions({ data: { initData } })).toThrow();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("first call serves questions and records the start with the verified id and UTC day", async () => {
    const result = await getDailyQuestions(input);
    expect(result.ok).toBe(true);
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      p_telegram_id: 42,
      p_game: "question",
      p_day: "2026-10-17",
    });
  });

  it("second call the same day returns already_played with next UTC midnight and no questions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T15:30:00Z"));
    mocks.start.mockResolvedValue({ data: false, error: null });
    const result = await getDailyQuestions(input);
    vi.useRealTimers();
    expect(result).toEqual({
      ok: false,
      error: "already_played",
      nextResetAt: Date.UTC(2026, 9, 18),
    });
    expect("questions" in result).toBe(false);
  });

  it("start RPC error fails closed with unavailable and no questions", async () => {
    mocks.start.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it("paused game stays unavailable and never records a start", async () => {
    mocks.enabled.mockResolvedValue(false);
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("Face 2 never reads questions or burns a daily start", async () => {
    mocks.face.mockResolvedValue(2);
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([false, true])("Face 1 and face read failure preserve daily reads (failure=%s)", async (failed) => {
    if (failed) mocks.face.mockRejectedValue(new Error("private face read detail"));
    expect(await getDailyQuestions(input)).toEqual({
      ok: true,
      questions: questions.map(({ slot: _slot, ...question }) => question),
    });
    expect(mocks.enabled).toHaveBeenCalledExactlyOnceWith("question-day");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_daily_questions", { p_day: "2026-10-17" });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      p_telegram_id: 42, p_game: "question", p_day: "2026-10-17",
    });
  });

  it("face read failure still respects a paused Question Day switch", async () => {
    mocks.face.mockRejectedValue(new Error("private face read detail"));
    mocks.enabled.mockResolvedValue(false);
    expect(await getDailyQuestions(input)).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
