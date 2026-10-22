import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/integrations/external-supabase/admin.server", () => ({
  getExternalSupabaseAdmin: mocks.db,
}));
import {
  commentStory,
  isStoryAdmin,
  likeStory,
  readStories,
  safeStoryLink,
  storyActionSchema,
  storyCommentSchema,
  storyInsights,
  viewStory,
} from "./stories.server";
const token = "test:stories-token";
function signed(id: number) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) };
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({
    ...fields,
    hash: createHmac("sha256", key).update(check).digest("hex"),
  }).toString();
}
const storyId = "7bd0193c-05e8-4a9c-8514-1ad52d5cbffc";
function table(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt", "order", "in", "upsert", "insert", "delete"])
    chain[method] = vi.fn(() => chain);
  chain["maybeSingle"] = vi.fn(async () => result);
  chain["then"] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
describe("Stories validation and privacy", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    mocks.db.mockReset();
  });
  it("accepts only UUID story ids and trims bounded comments", () => {
    expect(storyActionSchema.safeParse({ initData: "x", storyId: "bad" }).success).toBe(false);
    expect(storyCommentSchema.parse({ initData: "x", storyId, body: "  hello  " }).body).toBe(
      "hello",
    );
    for (const body of ["   ", "x".repeat(501)])
      expect(storyCommentSchema.safeParse({ initData: "x", storyId, body }).success).toBe(false);
  });
  it("permits only http and https story links", () => {
    expect(safeStoryLink("https://example.com")).toBe("https://example.com/");
    for (const url of ["javascript:alert(1)", "tg://test", "/relative", "data:text/html,x"])
      expect(safeStoryLink(url)).toBeNull();
  });
  it("rejects non-admin insights before accessing the database", async () => {
    expect(isStoryAdmin(42)).toBe(false);
    expect(await storyInsights({ initData: signed(42), storyId })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await storyInsights({ initData: "invalid", storyId })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("returns viewing-only stories without Telegram verification and no counts or identities", async () => {
    const row = {
      id: storyId,
      media_type: "image",
      media_url: "https://example.com/image.jpg",
      link_url: "javascript:alert(1)",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10000).toISOString(),
    };
    const from = vi.fn(() => table({ data: [row], error: null }));
    mocks.db.mockReturnValue({ from });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const result = await readStories({});
    expect(result).toEqual({
      stories: [{ ...row, link_url: null, seen: false, liked: false }],
      engagement: false,
      isAdmin: false,
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("stories");
  });
  it("does not record the admin as a viewer", async () => {
    const from = vi.fn(() => table({ data: { id: storyId }, error: null }));
    const rpc = vi.fn();
    mocks.db.mockReturnValue({ from, rpc });
    expect(await viewStory({ initData: signed(2143639881), storyId })).toEqual({ ok: true, tasks: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("stories");
  });
  it("refuses comments after five recorded comments", async () => {
    const from = vi.fn((name) =>
      table(
        name === "stories" ? { data: { id: storyId }, error: null } : { count: 5, error: null },
      ),
    );
    mocks.db.mockReturnValue({ from });
    expect(await commentStory({ initData: signed(42), storyId, body: "Hello" })).toEqual({
      ok: false,
      error: "too_many",
    });
  });
  it("handles invalid and inactive engagement without throwing", async () => {
    expect(await viewStory({ initData: "bad", storyId })).toEqual({ ok: false, error: "invalid" });
    mocks.db.mockReturnValue({ from: () => table({ data: null, error: null }) });
    expect(await viewStory({ initData: signed(42), storyId })).toEqual({
      ok: false,
      error: "inactive",
    });
  });
  it("grants view tasks with the verified user after recording the view", async () => {
    const view = table({ data: null, error: null });
    const from = vi.fn((name) => name === "stories"
      ? table({ data: { id: storyId }, error: null }) : view);
    const rpc = vi.fn(async () => ({ data: 7, error: null }));
    mocks.db.mockReturnValue({ from, rpc });
    expect(await viewStory({ initData: signed(42), storyId })).toEqual({ ok: true, tasks: 7 });
    expect(view.upsert).toHaveBeenCalledWith(
      { story_id: storyId, telegram_id: 42 },
      { onConflict: "story_id,telegram_id", ignoreDuplicates: true },
    );
    expect(rpc).toHaveBeenCalledWith("grant_story_task", {
      p_telegram_id: 42, p_story_id: storyId, p_kind: "view",
    });
    expect(vi.mocked(view.upsert).mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });
  it("grants only when adding a like, never when removing it", async () => {
    let existing: unknown = null;
    const from = vi.fn((name) => table({
      data: name === "stories" ? { id: storyId } : existing, error: null,
    }));
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    mocks.db.mockReturnValue({ from, rpc });
    expect(await likeStory({ initData: signed(42), storyId })).toEqual({ ok: true, liked: true, tasks: 3 });
    expect(rpc).toHaveBeenCalledWith("grant_story_task", {
      p_telegram_id: 42, p_story_id: storyId, p_kind: "like",
    });
    existing = { story_id: storyId };
    expect(await likeStory({ initData: signed(42), storyId })).toEqual({ ok: true, liked: false, tasks: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("asks the database for comment tasks after every successful comment", async () => {
    const comments = table({ count: 0, error: null });
    const from = vi.fn((name) => name === "stories"
      ? table({ data: { id: storyId }, error: null }) : comments);
    const rpc = vi.fn().mockResolvedValueOnce({ data: 5, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    mocks.db.mockReturnValue({ from, rpc });
    expect(await commentStory({ initData: signed(42), storyId, body: "First" })).toEqual({ ok: true, tasks: 5 });
    expect(await commentStory({ initData: signed(42), storyId, body: "Second" })).toEqual({ ok: true, tasks: 0 });
    expect(comments.insert).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, "grant_story_task", {
      p_telegram_id: 42, p_story_id: storyId, p_kind: "comment",
    });
  });
  it.each(["view", "like", "comment"] as const)("does not fail %s on RPC errors or exceptions", async (kind) => {
    const from = vi.fn((name) => table(name === "stories"
      ? { data: { id: storyId }, error: null } : { data: null, count: 0, error: null }));
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "private" } })
      .mockRejectedValueOnce(new Error("private"));
    mocks.db.mockReturnValue({ from, rpc });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const action = kind === "view" ? viewStory : kind === "like" ? likeStory : commentStory;
      for (let i = 0; i < 2; i++) {
        expect(await action({ initData: signed(42), storyId, body: "Hello" })).toEqual({
          ok: true, tasks: 0, ...(kind === "like" ? { liked: true } : {}),
        });
      }
      expect(log.mock.calls).toEqual([["Story task grant failed"], ["Story task grant failed"]]);
    } finally {
      log.mockRestore();
    }
  });
  it.each([-1, 1.5, "2", null, undefined, NaN, Infinity])("treats invalid task value %s as zero", async (data) => {
    const from = vi.fn(() => table({ data: { id: storyId }, error: null }));
    const rpc = vi.fn(async () => ({ data, error: null }));
    mocks.db.mockReturnValue({ from, rpc });
    expect(await viewStory({ initData: signed(42), storyId })).toEqual({ ok: true, tasks: 0 });
  });
  it.each(["view", "like", "comment"] as const)("never grants %s for inactive or invisible stories", async (kind) => {
    const rpc = vi.fn();
    const action = kind === "view" ? viewStory : kind === "like" ? likeStory : commentStory;
    for (const data of [null, { id: storyId, is_private: true }]) {
      const from = vi.fn((name) => table({ data: name === "stories" ? data : null, error: null }));
      mocks.db.mockReturnValue({ from, rpc });
      expect(await action({ initData: signed(42), storyId, body: "Hello" })).toEqual({ ok: false, error: "inactive" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never grants tasks after a failed engagement write", async () => {
    const rpc = vi.fn();
    const from = vi.fn((name) => table(name === "stories"
      ? { data: { id: storyId }, error: null } : { data: null, error: "failed" }));
    mocks.db.mockReturnValue({ from, rpc });
    for (const action of [viewStory, likeStory, commentStory]) {
      expect(await action({ initData: signed(42), storyId, body: "Hello" })).toEqual({ ok: false, error: "server_error" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
