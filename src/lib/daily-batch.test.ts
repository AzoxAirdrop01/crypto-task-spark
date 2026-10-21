import { describe, expect, it } from "vitest";
import { DAILY_GAMES, normalizeIndices, runDailyBatch, type DailyBatchDeps } from "./daily-batch";
import { QUESTION_POINTS, QUESTIONS_PER_DAY, WORD_POINTS, WORDS_PER_DAY } from "./rewards";

const DAY = "2026-10-04";

/** In-memory model of claim_reward + reward_events + user_tasks. */
function fake() {
  const events = new Map<string, number>();
  const tasks = new Set<string>();
  let points = 0;
  let calls = 0;
  const deps: DailyBatchDeps = {
    claimOnce: async (key, pts) => {
      if (pts <= 0) throw new Error("p_points must be > 0");
      if (events.has(key)) return { granted: false, points };
      events.set(key, pts);
      points += pts;
      return { granted: true, points };
    },
    countEvents: async (keys) => keys.filter((k) => events.has(k)).length,
    insertTaskIds: async (ids) => {
      const missing = ids.filter((i) => !tasks.has(i));
      missing.forEach((i) => tasks.add(i));
      return missing.length;
    },
    unitIds: (base, n) => Array.from({ length: n }, (_, i) => (i ? `${base}#${i + 1}` : base)),
    currentPoints: async () => points,
  };
  /** One server call = one runDailyBatch. */
  const call = async (game: "word" | "question", idx: number[]) => {
    calls++;
    const n = normalizeIndices(game, idx);
    if (!n) return null;
    return runDailyBatch(game, DAY, n, deps);
  };
  return { call, events, tasks, get points() { return points; }, get calls() { return calls; } };
}

describe("daily game batch rewards", () => {
  it("current games have exactly 5 items", () => {
    expect(WORDS_PER_DAY).toBe(5);
    expect(QUESTIONS_PER_DAY).toBe(5);
  });

  it("Word completes with one backend call and grants +10 units", async () => {
    const f = fake();
    const r = await f.call("word", [0, 1, 2, 3, 4]);
    expect(f.calls).toBe(1);
    expect(r).toEqual({ points: 5 * WORD_POINTS, granted: 5, allRecorded: true, unitsAdded: 10 });
  });

  it("Question Day completes with one backend call and grants +10 units", async () => {
    const f = fake();
    const r = await f.call("question", [0, 1, 2, 3, 4]);
    expect(f.calls).toBe(1);
    expect(r).toEqual({ points: 5 * QUESTION_POINTS, granted: 5, allRecorded: true, unitsAdded: 10 });
  });

  it("partial results retry safely without double payment", async () => {
    const f = fake();
    await f.call("word", [0, 2]);
    const r = await f.call("word", [0, 2]);
    expect(r!.granted).toBe(0);
    expect(f.points).toBe(2 * WORD_POINTS);
    const r2 = await f.call("word", [0, 1, 2]);
    expect(r2!.granted).toBe(1);
    expect(f.points).toBe(3 * WORD_POINTS);
  });

  it("word_complete units require all 5 word rewards", async () => {
    const f = fake();
    const r = await f.call("word", [0, 1, 2, 3]);
    expect(r!.allRecorded).toBe(false);
    expect(r!.unitsAdded).toBe(0);
    expect(f.tasks.size).toBe(0);
    const r2 = await f.call("word", [4]);
    expect(r2!.unitsAdded).toBe(10);
    const r3 = await f.call("word", [0, 1, 2, 3, 4]);
    expect(r3!.unitsAdded).toBe(0); // units counted once
  });

  it("question_complete units require all 5 question rewards", async () => {
    const f = fake();
    expect((await f.call("question", [1, 2, 3, 4]))!.unitsAdded).toBe(0);
    expect((await f.call("question", [0]))!.unitsAdded).toBe(10);
    expect([...f.tasks]).toEqual(
      Array.from({ length: 10 }, (_, i) =>
        i ? `game-question-complete-${DAY}#${i + 1}` : `game-question-complete-${DAY}`,
      ),
    );
  });

  it("rejects a 6th question/index and oversize batches", () => {
    expect(normalizeIndices("question", [5])).toBeNull();
    expect(normalizeIndices("word", [-1])).toBeNull();
    expect(normalizeIndices("question", [0, 1, 2, 3, 4, 4])).toBeNull();
    expect(normalizeIndices("word", [1.5])).toBeNull();
    expect(normalizeIndices("question", [3, 1, 3])).toEqual([1, 3]);
  });

  it("server owns fixed amounts and reward keys", async () => {
    expect(DAILY_GAMES.word.points).toBe(1000);
    expect(DAILY_GAMES.question.points).toBe(1000);
    const f = fake();
    await f.call("question", [2]);
    expect(f.events.get(`question-${DAY}-2`)).toBe(1000);
    await f.call("word", [2]);
    expect(f.events.get(`word-${DAY}-2`)).toBe(1000);
  });

  it("existing once-only idempotency is intact (no repeat grant per key)", async () => {
    const f = fake();
    await Promise.all([f.call("word", [3]), f.call("word", [3])]);
    expect(f.points).toBe(WORD_POINTS);
  });
});
