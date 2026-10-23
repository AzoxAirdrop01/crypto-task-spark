import { z } from "zod";
import { getExternalSupabaseAdmin } from "@/integrations/external-supabase/admin.server";
import { verifyTelegramInitData } from "./telegram-auth.server";
import { canSeeStory, resolveStoryMedia } from "./story-visibility";

// Never export this identity to client-reachable modules.
const STORY_ADMIN_ID = 2143639881;
export const storyListSchema = z.object({ initData: z.string().max(8192).optional() });
export const storyActionSchema = z.object({
  initData: z.string().min(1).max(8192),
  storyId: z.string().uuid(),
});
export const storyCommentSchema = storyActionSchema.extend({
  body: z.string().trim().min(1).max(500),
});
export type StoryFailure = {
  ok: false;
  error:
    | "invalid"
    | "missing"
    | "stale"
    | "not_configured"
    | "inactive"
    | "too_many"
    | "forbidden"
    | "server_error";
};
export type Story = {
  id: string;
  media_type: "image" | "video";
  media_url: string;
  link_url: string | null;
  created_at: string;
  expires_at: string;
  seen: boolean;
  liked: boolean;
};
export type StoriesResult = {
  stories: Story[];
  isAdmin: boolean;
  engagement: boolean;
  error?: string;
};
export type InsightPerson = {
  name: string;
  username: string | null;
  photoUrl: string | null;
  time: string;
  body?: string;
};
export type StoryInsights = {
  ok: true;
  viewers: InsightPerson[];
  likers: InsightPerson[];
  comments: InsightPerson[];
  counts: { views: number; likes: number; comments: number };
};
export function safeStoryLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
export function isStoryAdmin(id: number): boolean {
  return id === STORY_ADMIN_ID;
}
const failure = (error: StoryFailure["error"]): StoryFailure => ({ ok: false, error });
async function grantStoryTask(
  userId: number,
  storyId: string,
  kind: "view" | "like" | "comment",
): Promise<number> {
  try {
    const { data, error } = await getExternalSupabaseAdmin().rpc("grant_story_task", {
      p_telegram_id: userId,
      p_story_id: storyId,
      p_kind: kind,
    });
    if (error) {
      console.error("Story task grant failed");
      return 0;
    }
    return typeof data === "number" && Number.isInteger(data) && data >= 0 ? data : 0;
  } catch {
    console.error("Story task grant failed");
    return 0;
  }
}
function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("Story database request failed");
  return result.data;
}
async function active(storyId: string) {
  return check(
    await getExternalSupabaseAdmin()
      .from("stories")
      .select("id,is_private,geo_rule")
      .eq("id", storyId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  ) as { id: string; is_private?: boolean | null; geo_rule?: unknown } | null;
}
/** Active AND visible to this verified user; private non-recipients look inactive. */
async function activeVisible(storyId: string, userId: number): Promise<boolean> {
  const story = await active(storyId);
  if (!story) return false;
  const isAdmin = isStoryAdmin(userId);
  if (isAdmin) return true;
  if (story.geo_rule !== null && story.geo_rule !== undefined) {
    try {
      const { data, error } = await getExternalSupabaseAdmin().rpc("story_geo_allows", {
        p_telegram_id: userId,
        p_story_id: storyId,
      });
      if (error || data !== true) return false;
    } catch {
      return false;
    }
  }
  if (!story.is_private) return true;
  const rec = check(
    await getExternalSupabaseAdmin()
      .from("story_recipients")
      .select("telegram_id")
      .eq("story_id", storyId)
      .eq("telegram_id", userId)
      .maybeSingle(),
  );
  return canSeeStory({
    isPrivate: true,
    userId,
    isAdmin,
    recipients: rec ? [userId] : [],
  });
}
export async function readStories(input: unknown): Promise<StoriesResult> {
  const parsed = storyListSchema.safeParse(input);
  const auth = await verifyTelegramInitData(parsed.success ? parsed.data.initData : undefined);
  const isAdmin = auth.ok && isStoryAdmin(auth.user.id);
  try {
    const db = getExternalSupabaseAdmin();
    const allRows =
      check(
        await db
          .from("stories")
          .select("id,media_type,media_url,link_url,created_at,expires_at,is_private,media_path,geo_rule")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: true }),
      ) ?? [];
    const userId = auth.ok ? auth.user.id : null;
    const privateIds = allRows.filter((r) => r.is_private).map((r) => String(r.id));
    let mine = new Set<string>();
    if (userId !== null && !isAdmin && privateIds.length) {
      const rec = check(
        await db
          .from("story_recipients")
          .select("story_id")
          .eq("telegram_id", userId)
          .in("story_id", privateIds),
      );
      mine = new Set((rec ?? []).map((r) => String(r.story_id)));
    }
    const privacyVisible = allRows.filter((r) =>
      canSeeStory({
        isPrivate: Boolean(r.is_private),
        userId,
        isAdmin,
        recipients: userId !== null && mine.has(String(r.id)) ? [userId] : [],
      }),
    );
    // Geo targeting: fail closed for targeted rows; admin sees everything.
    let visible = privacyVisible;
    if (!isAdmin) {
      const targeted = privacyVisible
        .filter((r) => r.geo_rule !== null && r.geo_rule !== undefined)
        .map((r) => String(r.id));
      if (targeted.length) {
        let allowed = new Set<string>();
        try {
          const { data, error } = await db.rpc("story_ids_geo_allowed", {
            p_telegram_id: userId,
            p_story_ids: targeted,
          });
          if (!error && Array.isArray(data)) allowed = new Set(data.map((x) => String(x)));
        } catch {
          allowed = new Set();
        }
        const blocked = new Set(targeted.filter((id) => !allowed.has(id)));
        visible = privacyVisible.filter((r) => !blocked.has(String(r.id)));
      }
    }
    // Private media: short-lived signed URL from the private bucket, or excluded.
    const sign = async (path: string) => {
      const { data } = await db.storage.from("stories-private").createSignedUrl(path, 7200);
      return data?.signedUrl ?? null;
    };
    const resolved = await Promise.all(
      visible.map(async (r) => ({
        r,
        url: await resolveStoryMedia(
          {
            isPrivate: Boolean(r.is_private),
            mediaUrl: r.media_url ?? null,
            mediaPath: r.media_path ?? null,
          },
          sign,
        ),
      })),
    );
    const media = new Map<string, string>();
    const rows = resolved
      .filter((x) => x.url !== null)
      .map((x) => {
        media.set(String(x.r.id), x.url as string);
        return x.r;
      });
    let seen = new Set<string>();
    let liked = new Set<string>();
    if (auth.ok && rows.length) {
      const ids = rows.map((r) => String(r.id));
      const [views, likes] = await Promise.all([
        db
          .from("story_views")
          .select("story_id")
          .eq("telegram_id", auth.user.id)
          .in("story_id", ids),
        db
          .from("story_likes")
          .select("story_id")
          .eq("telegram_id", auth.user.id)
          .in("story_id", ids),
      ]);
      seen = new Set((check(views) ?? []).map((r) => String(r.story_id)));
      liked = new Set((check(likes) ?? []).map((r) => String(r.story_id)));
    }
    return {
      stories: rows.map((r) => ({
        id: String(r.id),
        media_type: r.media_type as Story["media_type"],
        media_url: media.get(String(r.id)) ?? "",
        link_url: safeStoryLink(r.link_url),
        created_at: String(r.created_at),
        expires_at: String(r.expires_at),
        seen: isAdmin || seen.has(r.id),
        liked: liked.has(r.id),
      })),
      isAdmin,
      engagement: auth.ok,
    };
  } catch {
    return { stories: [], isAdmin: false, engagement: false, error: "server_error" };
  }
}
export async function viewStory(input: unknown): Promise<{ ok: true; tasks: number } | StoryFailure> {
  const p = storyActionSchema.safeParse(input);
  if (!p.success) return failure("invalid");
  const a = await verifyTelegramInitData(p.data.initData);
  if (!a.ok) return failure(a.error);
  try {
    if (!(await activeVisible(p.data.storyId, a.user.id))) return failure("inactive");
    if (!isStoryAdmin(a.user.id))
      check(
        await getExternalSupabaseAdmin()
          .from("story_views")
          .upsert(
            { story_id: p.data.storyId, telegram_id: a.user.id },
            { onConflict: "story_id,telegram_id", ignoreDuplicates: true },
          ),
      );
    const tasks = isStoryAdmin(a.user.id) ? 0 : await grantStoryTask(a.user.id, p.data.storyId, "view");
    return { ok: true, tasks };
  } catch {
    return failure("server_error");
  }
}
export async function likeStory(
  input: unknown,
): Promise<{ ok: true; liked: boolean; tasks: number } | StoryFailure> {
  const p = storyActionSchema.safeParse(input);
  if (!p.success) return failure("invalid");
  const a = await verifyTelegramInitData(p.data.initData);
  if (!a.ok) return failure(a.error);
  try {
    if (!(await activeVisible(p.data.storyId, a.user.id))) return failure("inactive");
    const db = getExternalSupabaseAdmin();
    const existing = check(
      await db
        .from("story_likes")
        .select("story_id")
        .eq("story_id", p.data.storyId)
        .eq("telegram_id", a.user.id)
        .maybeSingle(),
    );
    if (existing)
      check(
        await db
          .from("story_likes")
          .delete()
          .eq("story_id", p.data.storyId)
          .eq("telegram_id", a.user.id),
      );
    else
      check(
        await db
          .from("story_likes")
          .upsert(
            { story_id: p.data.storyId, telegram_id: a.user.id },
            { onConflict: "story_id,telegram_id", ignoreDuplicates: true },
          ),
      );
    const liked = !existing;
    const tasks = liked ? await grantStoryTask(a.user.id, p.data.storyId, "like") : 0;
    return { ok: true, liked, tasks };
  } catch {
    return failure("server_error");
  }
}
export async function commentStory(input: unknown): Promise<{ ok: true; tasks: number } | StoryFailure> {
  const p = storyCommentSchema.safeParse(input);
  if (!p.success) return failure("invalid");
  const a = await verifyTelegramInitData(p.data.initData);
  if (!a.ok) return failure(a.error);
  try {
    if (!(await activeVisible(p.data.storyId, a.user.id))) return failure("inactive");
    const db = getExternalSupabaseAdmin();
    const { count, error } = await db
      .from("story_comments")
      .select("id", { count: "exact", head: true })
      .eq("story_id", p.data.storyId)
      .eq("telegram_id", a.user.id);
    if (error) throw error;
    if ((count ?? 0) >= 5) return failure("too_many");
    check(
      await db
        .from("story_comments")
        .insert({ story_id: p.data.storyId, telegram_id: a.user.id, body: p.data.body }),
    );
    const tasks = await grantStoryTask(a.user.id, p.data.storyId, "comment");
    return { ok: true, tasks };
  } catch {
    return failure("server_error");
  }
}
export async function storyInsights(input: unknown): Promise<StoryInsights | StoryFailure> {
  const p = storyActionSchema.safeParse(input);
  if (!p.success) return failure("forbidden");
  const a = await verifyTelegramInitData(p.data.initData);
  if (!a.ok || !isStoryAdmin(a.user.id)) return failure("forbidden");
  try {
    const db = getExternalSupabaseAdmin();
    // This is the only projection of engagement counts or other people's data.
    const [v, l, c] = await Promise.all([
      db
        .from("story_views")
        .select("telegram_id,viewed_at")
        .eq("story_id", p.data.storyId)
        .order("viewed_at", { ascending: false }),
      db
        .from("story_likes")
        .select("telegram_id,created_at")
        .eq("story_id", p.data.storyId)
        .order("created_at", { ascending: false }),
      db
        .from("story_comments")
        .select("telegram_id,body,created_at")
        .eq("story_id", p.data.storyId)
        .order("created_at", { ascending: false }),
    ]);
    const viewers = check(v) ?? [];
    const likers = check(l) ?? [];
    const comments = check(c) ?? [];
    const ids = [...new Set([...viewers, ...likers, ...comments].map((r) => r.telegram_id))];
    const users = ids.length
      ? (check(
          await db
            .from("users")
            .select("telegram_id,username,first_name,last_name,photo_url")
            .in("telegram_id", ids),
        ) ?? [])
      : [];
    const people = new Map(
      users.map((u) => [
        String(u.telegram_id),
        {
          name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "User",
          username: u.username ? `@${String(u.username).replace(/^@/, "")}` : null,
          photoUrl: safeStoryLink(u.photo_url),
        },
      ]),
    );
    const person = (id: unknown, time: string, body?: string): InsightPerson => ({
      ...(people.get(String(id)) ?? { name: "User", username: null, photoUrl: null }),
      time,
      ...(body === undefined ? {} : { body }),
    });
    return {
      ok: true,
      viewers: viewers.map((r) => person(r.telegram_id, r.viewed_at)),
      likers: likers.map((r) => person(r.telegram_id, r.created_at)),
      comments: comments.map((r) => person(r.telegram_id, r.created_at, r.body)),
      counts: { views: viewers.length, likes: likers.length, comments: comments.length },
    };
  } catch {
    return failure("server_error");
  }
}
