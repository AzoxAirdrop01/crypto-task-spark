import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDailyQuestions: vi.fn() }));

vi.mock("@/integrations/external-supabase/client", () => ({ externalSupabase: {} }));
vi.mock("@/lib/telegram", () => ({
  getTelegramUser: () => null,
  getWebApp: () => ({ initData: "fixture" }),
}));
vi.mock("@/lib/azox-secure.functions", () => ({}));
vi.mock("@/lib/profile.functions", () => ({}));
vi.mock("@/lib/game-switches.functions", () => ({}));
vi.mock("@/lib/question-day.functions", async (orig) => ({
  ...(await orig<typeof import("./question-day.functions")>()),
  getDailyQuestions: mocks.getDailyQuestions,
}));

describe("Question Day client cache", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getDailyQuestions.mockReset();
    mocks.getDailyQuestions.mockResolvedValue({ ok: true, questions: [] });
  });

  it("caches a successful fetch for the day", async () => {
    const { fetchDailyQuestions } = await import("./azox-backend");
    expect((await fetchDailyQuestions()).status).toBe("ok");
    expect((await fetchDailyQuestions()).status).toBe("ok");
    expect(mocks.getDailyQuestions).toHaveBeenCalledTimes(1);
  });

  it("returns already_played after markDailyQuestionsPlayed without calling the server", async () => {
    const { fetchDailyQuestions, markDailyQuestionsPlayed } = await import("./azox-backend");
    await fetchDailyQuestions();
    markDailyQuestionsPlayed();
    const r = await fetchDailyQuestions();
    expect(r.status).toBe("already_played");
    expect(mocks.getDailyQuestions).toHaveBeenCalledTimes(1);
  });
});
