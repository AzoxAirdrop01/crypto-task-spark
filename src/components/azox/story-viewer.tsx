import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Heart,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { rawInitData, syncTasksDone } from "@/lib/azox-backend";
import { getWebApp } from "@/lib/telegram";
import {
  addStoryComment,
  getStoryInsights,
  markStoryViewed,
  toggleStoryLike,
  type Story,
  type StoryInsights,
} from "@/lib/stories.functions";
import { cn } from "@/lib/utils";
import { StoryInsightsSheet } from "./story-insights-sheet";

type Props = {
  stories: Story[];
  engagement: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSeen: (id: string) => void;
  onLiked: (id: string, liked: boolean) => void;
};
function showTaskReward(tasks: number) {
  if (tasks <= 0) return;
  toast.success(`+${tasks} ${tasks === 1 ? "task" : "tasks"}`);
  void syncTasksDone().catch(() => {});
}
export function StoryViewer({ stories, engagement, isAdmin, onClose, onSeen, onLiked }: Props) {
  const [id, setId] = useState(stories.find((s) => !s.seen)?.id ?? stories[0]?.id);
  const index = stories.findIndex((s) => s.id === id);
  const story = stories[index];
  const storyId = story?.id;
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insights, setInsights] = useState<StoryInsights | null>(null);
  const [insightsError, setInsightsError] = useState(false);
  const [insightsRetry, setInsightsRetry] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const viewed = useRef(new Set<string>());
  const mounted = useRef(true);
  const likeLock = useRef(false);
  const sendLock = useRef(false);
  const viewFn = useServerFn(markStoryViewed);
  const likeFn = useServerFn(toggleStoryLike);
  const commentFn = useServerFn(addStoryComment);
  const insightsFn = useServerFn(getStoryInsights);
  const paused = focused || held || hidden || insightsOpen || sending;
  const advance = useCallback(
    (direction: number) => {
      const next = stories[index + direction];
      if (next) {
        setId(next.id);
        setProgress(0);
        setReady(false);
        setMediaError(false);
        setBody("");
        setNotice("");
      } else if (direction > 0) onClose();
    },
    [stories, index, onClose],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!story) onClose();
  }, [story, onClose]);
  useEffect(() => {
    if (!story || !ready || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    if (!engagement) {
      onSeen(story.id);
      return;
    }
    if (story.seen || isAdmin) return;
    const initData = rawInitData();
    if (!initData) return;
    void viewFn({ data: { initData, storyId: story.id } })
      .then((r) => {
        if (r.ok) {
          onSeen(story.id);
          showTaskReward(r.tasks);
        }
      })
      .catch(() => {});
  }, [story, ready, engagement, isAdmin, onSeen, viewFn]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const visibility = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (!story || !ready || paused || mediaError || story.media_type !== "image") return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 6000;
      previous = now;
      setProgress((value) => Math.min(1, value + delta));
    }, 40);
    return () => window.clearInterval(timer);
  }, [story, ready, paused, mediaError]);
  useEffect(() => {
    if (progress >= 1 && !paused) advance(1);
  }, [progress, paused, advance]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    if (paused) player.pause();
    else void player.play().catch(() => setHeld(true));
  }, [paused, id, ready]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!insightsOpen || !storyId || !isAdmin) return;
    let cancelled = false;
    setInsights(null);
    setInsightsError(false);
    const initData = rawInitData();
    if (!initData) {
      setInsightsError(true);
      return;
    }
    void insightsFn({ data: { initData, storyId } })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setInsights(r);
        else setInsightsError(true);
      })
      .catch(() => {
        if (!cancelled) setInsightsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [insightsOpen, storyId, isAdmin, insightsFn, insightsRetry]);
  async function like() {
    const initData = rawInitData();
    if (!story || !initData || likeLock.current) return;
    likeLock.current = true;
    setLikeBusy(true);
    const target = story;
    onLiked(target.id, !target.liked);
    try {
      const r = await likeFn({ data: { initData, storyId: target.id } });
      onLiked(target.id, r.ok ? r.liked : target.liked);
      if (r.ok) showTaskReward(r.tasks);
      if (!r.ok) setNotice("Could not save like");
    } catch {
      onLiked(target.id, target.liked);
      setNotice("Could not save like");
    } finally {
      likeLock.current = false;
      if (mounted.current) setLikeBusy(false);
    }
  }
  async function send() {
    const initData = rawInitData();
    if (!story || !initData || !body.trim() || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    try {
      const r = await commentFn({ data: { initData, storyId: story.id, body: body.trim() } });
      if (r.ok) {
        showTaskReward(r.tasks);
        setBody("");
        setNotice("Sent");
      } else setNotice(r.error === "too_many" ? "Comment limit reached" : "Could not send comment");
    } catch {
      setNotice("Could not send comment");
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  }
  function openLink() {
    if (!story?.link_url) return;
    try {
      const url = new URL(story.link_url);
      if (!["http:", "https:"].includes(url.protocol)) return;
      const app = getWebApp() as ReturnType<typeof getWebApp> & {
        openLink?: (url: string) => void;
      };
      if (app?.openLink) app.openLink(url.href);
      else window.open(url.href, "_blank", "noopener,noreferrer");
    } catch {
      setNotice("Could not open link");
    }
  }
  if (!story) return null;
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="story-screen fixed inset-0 z-[101] flex flex-col bg-background text-foreground outline-none"
          onKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) return;
            if (event.key === "ArrowRight") advance(1);
            if (event.key === "ArrowLeft") advance(-1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">Azad Bashqali Stories</DialogPrimitive.Title>
          <div className="relative z-10 px-4 pt-3">
            <div className="mb-3 flex gap-1" aria-label={`Story ${index + 1} of ${stories.length}`}>
              {stories.map((s, i) => (
                <div
                  key={s.id}
                  className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/25"
                >
                  <div
                    className="h-full origin-left bg-foreground"
                    style={{ transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Avatar className="size-9 border border-story-accent">
                <AvatarImage src="/azox/azad-bashqali.jpg" alt="Azad Bashqali" />
                <AvatarFallback>AB</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 text-sm font-bold">Azad Bashqali</span>
              <Button
                variant="ghost"
                size="icon"
                title={held ? "Play story" : "Pause story"}
                aria-label={held ? "Play story" : "Pause story"}
                onClick={() => setHeld((v) => !v)}
              >
                {held ? <CirclePlay /> : <CirclePause />}
              </Button>
              {story.media_type === "video" && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={muted ? "Unmute" : "Mute"}
                  aria-label={muted ? "Unmute" : "Mute"}
                  onClick={() => setMuted((m) => !m)}
                >
                  {muted ? <VolumeX /> : <Volume2 />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close stories"
                title="Close stories"
                onClick={onClose}
              >
                <X />
              </Button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {story.media_type === "image" ? (
              <img
                key={story.id}
                src={story.media_url}
                alt="Azad Bashqali story"
                className="size-full object-contain"
                onLoad={() => setReady(true)}
                onError={() => setMediaError(true)}
              />
            ) : (
              <video
                key={story.id}
                ref={video}
                src={story.media_url}
                className="size-full object-contain"
                playsInline
                autoPlay
                muted={muted}
                preload="auto"
                onLoadedData={() => setReady(true)}
                onTimeUpdate={(e) => {
                  const p = e.currentTarget;
                  if (Number.isFinite(p.duration) && p.duration > 0)
                    setProgress(p.currentTime / p.duration);
                }}
                onEnded={() => {
                  if (!paused) advance(1);
                }}
                onError={() => setMediaError(true)}
              />
            )}
            {mediaError && (
              <p className="absolute inset-x-0 top-1/2 text-center text-sm text-muted-foreground">
                Story unavailable
              </p>
            )}
            <Button
              variant="ghost"
              aria-label="Previous story"
              disabled={index === 0}
              className="absolute inset-y-0 left-0 h-full w-1/3 rounded-none hover:bg-transparent"
              onClick={() => advance(-1)}
            >
              <ChevronLeft className="sr-only" />
            </Button>
            <Button
              variant="ghost"
              aria-label="Next story"
              className="absolute inset-y-0 right-0 h-full w-1/3 rounded-none hover:bg-transparent"
              onClick={() => advance(1)}
            >
              <ChevronRight className="sr-only" />
            </Button>
          </div>
          <div className="relative z-10 flex flex-col gap-3 px-4 pb-4 pt-3">
            <div className="flex items-center justify-center gap-3">
              {story.link_url && (
                <Button variant="secondary" onClick={openLink}>
                  <ExternalLink />
                  Open link
                </Button>
              )}
              {isAdmin && (
                <Button variant="secondary" onClick={() => setInsightsOpen(true)}>
                  Insights
                </Button>
              )}
            </div>
            {engagement && (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <Input
                  aria-label="Comment"
                  placeholder="Comment"
                  value={body}
                  maxLength={500}
                  disabled={sending}
                  onChange={(e) => setBody(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  aria-label="Send comment"
                  title="Send comment"
                  disabled={sending || !body.trim()}
                >
                  <Send />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={story.liked ? "Unlike story" : "Like story"}
                  title={story.liked ? "Unlike story" : "Like story"}
                  aria-pressed={story.liked}
                  disabled={likeBusy}
                  onClick={() => void like()}
                >
                  <Heart className={cn(story.liked && "fill-destructive text-destructive")} />
                </Button>
              </form>
            )}
            <p role="status" className="min-h-5 text-center text-xs text-muted-foreground">
              {notice}
            </p>
          </div>
          {isAdmin && (
            <StoryInsightsSheet
              open={insightsOpen}
              onOpenChange={setInsightsOpen}
              insights={insights}
              error={insightsError}
              onRetry={() => setInsightsRetry((value) => value + 1)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
