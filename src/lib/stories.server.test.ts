import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(view["upsert"]).toHaveBeenCalledWith(
      { story_id: storyId, telegram_id: 42 },
      { onConflict: "story_id,telegram_id", ignoreDuplicates: true },
    );
    expect(rpc).toHaveBeenCalledWith("grant_story_task", {
      p_telegram_id: 42, p_story_id: storyId, p_kind: "view",
    });
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
    expect(comments["insert"]).toHaveBeenCalledTimes(2);
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
describe("Story media stores", () => {
  const path = "2026-10-23/3f2a1c9e-1111-4222-8333-444455556666.mp4";
  const base = {
    id: storyId, media_type: "video", media_url: "https://example.com/video.mp4",
    media_path: path, link_url: null, created_at: "c", expires_at: "e", geo_rule: null,
  };
  beforeEach(() => {
    mocks.db.mockReset();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    vi.stubEnv("R2_ACCOUNT_ID", "abc123def456");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIAEXAMPLE0000");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secretKey+/ExampleSecret0123456789abcdef");
    vi.stubEnv("R2_BUCKET", "azox-stories");
  });
  afterEach(() => vi.unstubAllEnvs());
  function setup(is_private: boolean, media_store = "r2", media_path: string | null = path) {
    const stories = table({ data: [{ ...base, is_private, media_store, media_path }], error: null });
    const from = vi.fn((name) => name === "stories" ? stories : table({ data: [], error: null }));
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://example.com/private-signed" } }));
    const storageFrom = vi.fn(() => ({ createSignedUrl }));
    mocks.db.mockReturnValue({ from, storage: { from: storageFrom } });
    return { stories, createSignedUrl, storageFrom };
  }
  it.each([false, true])("presigns R2 media for private=%s without exposing storage fields", async (isPrivate) => {
    const { stories, storageFrom } = setup(isPrivate);
    // Verified admin can see private rows without a recipient lookup.
    const result = await readStories({ initData: signed(2143639881) });
    expect(result.stories).toHaveLength(1);
    const url = new URL(result.stories[0]?.media_url ?? "");
    expect(url.origin).toBe("https://abc123def456.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/azox-stories/${path}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("21600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stories[0]).not.toHaveProperty("media_path");
    expect(result.stories[0]).not.toHaveProperty("media_store");
    expect(stories["select"]).toHaveBeenCalledWith(expect.stringContaining("media_store"));
    expect(storageFrom).not.toHaveBeenCalled();
  });
  it.each([false, true])("excludes R2 media for private=%s when configuration is missing", async (isPrivate) => {
    setup(isPrivate);
    for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) vi.stubEnv(name, "");
    expect((await readStories({ initData: signed(2143639881) })).stories).toEqual([]);
  });
  it.each([null, "/x", "a/../b"])("excludes R2 media with missing or invalid path %s", async (pathValue) => {
    setup(false, "r2", pathValue);
    expect((await readStories({ initData: signed(2143639881) })).stories).toEqual([]);
  });
  it.each([false, true])("preserves existing media resolution for private=%s", async (isPrivate) => {
    const { createSignedUrl } = setup(isPrivate, "supabase");
    const result = await readStories({ initData: signed(2143639881) });
    expect(result.stories[0]?.media_url).toBe(isPrivate ? "https://example.com/private-signed" : base.media_url);
    if (isPrivate) expect(createSignedUrl).toHaveBeenCalledWith(path, 7200);
    else expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
describe("Story geo targeting", () => {
  const other = "11111111-2222-4333-8444-555555555555";
  const base = { media_type: "image", media_url: "https://e.com/a.jpg", link_url: null, created_at: "c", expires_at: "e", is_private: false, media_path: null };
  const rows = [{ ...base, id: storyId, geo_rule: { zones: ["k1"] } }, { ...base, id: other, geo_rule: null }];
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    mocks.db.mockReset();
  });
  function setup(rpcResult: unknown) {
    const from = vi.fn(() => table({ data: rows, error: null }));
    const rpc = typeof rpcResult === "function" ? vi.fn(rpcResult as () => unknown) : vi.fn(async () => rpcResult);
    mocks.db.mockReturnValue({ from, rpc, storage: { from: vi.fn() } });
    return rpc;
  }
  const ids = (r: Awaited<ReturnType<typeof readStories>>) => r.stories.map((s) => s.id);
  it("hides a targeted story from a user outside the rule", async () => {
    const rpc = setup({ data: [], error: null });
    const r = await readStories({ initData: signed(42) });
    expect(ids(r)).toEqual([other]);
    expect(rpc).toHaveBeenCalledWith("story_ids_geo_allowed", { p_telegram_id: 42, p_story_ids: [storyId] });
    expect(JSON.stringify(r)).not.toContain("geo_rule");
  });
  it("shows it to a user inside the rule", async () => {
    setup({ data: [storyId], error: null });
    expect(ids(await readStories({ initData: signed(42) }))).toEqual([storyId, other]);
  });
  it("shows it to the admin without asking", async () => {
    const rpc = setup({ data: [], error: null });
    const r = await readStories({ initData: signed(2143639881) });
    expect(ids(r)).toEqual([storyId, other]);
    expect(rpc).not.toHaveBeenCalledWith("story_ids_geo_allowed", expect.anything());
    expect(JSON.stringify(r)).not.toContain("geo_rule");
  });
  it("passes null for anonymous callers and hides targeted rows", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const rpc = setup({ data: [], error: null });
    expect(ids(await readStories({}))).toEqual([other]);
    expect(rpc).toHaveBeenCalledWith("story_ids_geo_allowed", { p_telegram_id: null, p_story_ids: [storyId] });
  });
  it("fails closed on RPC error or throw", async () => {
    setup({ data: null, error: { message: "x" } });
    expect(ids(await readStories({ initData: signed(42) }))).toEqual([other]);
    setup(async () => { throw new Error("x"); });
    expect(ids(await readStories({ initData: signed(42) }))).toEqual([other]);
  });
  it("view/like/comment refuse a targeted story the user may not see", async () => {
    for (const result of [{ data: false, error: null }, { data: null, error: { message: "x" } }]) {
      const from = vi.fn(() => table({ data: { id: storyId, is_private: false, geo_rule: { zones: ["k1"] } }, error: null }));
      const rpc = vi.fn(async () => result);
      mocks.db.mockReturnValue({ from, rpc });
      const inactive = { ok: false, error: "inactive" };
      expect(await viewStory({ initData: signed(42), storyId })).toEqual(inactive);
      expect(await likeStory({ initData: signed(42), storyId })).toEqual(inactive);
      expect(await commentStory({ initData: signed(42), storyId, body: "hi" })).toEqual(inactive);
      expect(rpc).toHaveBeenCalledWith("story_geo_allows", { p_telegram_id: 42, p_story_id: storyId });
      expect(rpc).not.toHaveBeenCalledWith("grant_story_task", expect.anything());
    }
  });
  it("allows view when story_geo_allows is true", async () => {
    const from = vi.fn(() => table({ data: { id: storyId, is_private: false, geo_rule: { zones: ["k1"] } }, error: null }));
    const rpc = vi.fn(async (name: string) => (name === "story_geo_allows" ? { data: true, error: null } : { data: 2, error: null }));
    mocks.db.mockReturnValue({ from, rpc });
    expect(await viewStory({ initData: signed(42), storyId })).toEqual({ ok: true, tasks: 2 });
  });
});
