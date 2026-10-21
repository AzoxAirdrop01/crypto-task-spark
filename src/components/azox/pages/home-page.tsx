import { WORD_POINTS } from "@/lib/rewards";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Play, Timer, Coins } from "lucide-react";
import { ClickButton } from "@/components/azox/click-button";
import { AzoxFooter } from "@/components/azox/footer";
import { CATEGORIES, RANKS } from "@/lib/azox-data";
import { AZOX_IMAGES } from "@/lib/azox-images";
import { Button } from "@/components/ui/button";
import { formatHMS } from "@/components/azox/games/GlobalButton/useGlobalButton";

const SLOT_MS = 3 * 60 * 60 * 1000; // every 3 hours (UTC+3 slots align with UTC)

function currentSlot(now: number): number {
  return Math.floor(now / SLOT_MS) * SLOT_MS;
}

function useGlobalButtonTimer() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const slot = currentSlot(now);
  const nextSlot = slot + SLOT_MS;
  const timeUntilNext = Math.max(0, nextSlot - now);
  return formatHMS(timeUntilNext);
}

export function HomePage() {
  const time = useGlobalButtonTimer();

  return (
    <div className="flex flex-col gap-5">
      {/* Global Button timer */}
      <section className="glass glow-purple flex items-center gap-3 rounded-2xl p-4">
        <div className="relative flex size-14 shrink-0 items-center justify-center">
          <img
            src={AZOX_IMAGES["global-button"]}
            alt="The Global Button"
            width={56}
            height={56}
            className="size-14 rounded-2xl object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary">
            <Timer className="size-3.5" aria-hidden="true" />
            The Global Button
          </div>
          <p className="text-sm text-muted-foreground">Next activation in</p>
        </div>
        <span className="rounded-xl border border-primary/40 bg-primary/15 px-3 py-1.5 font-mono text-lg font-bold tabular-nums text-foreground">
          {time}
        </span>
      </section>

      {/* Azox Word */}
      <section className="glass flex items-center gap-3 rounded-2xl p-4">
        <img
          src={AZOX_IMAGES["video-ads"]}
          alt="Azox Word"
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-2xl object-contain"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Azox Word</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Coins className="size-3.5 text-gold" aria-hidden="true" /> Unscramble
            5 daily words • +{WORD_POINTS.toLocaleString()} each
          </p>
        </div>
        <Button
          asChild
          className="rounded-xl bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
        >
          <Link to="/games/$game" params={{ game: "video-ads" }}>
            <Play className="size-4" aria-hidden="true" />
            Play
          </Link>
        </Button>
      </section>


      {/* Main click button */}
      <section className="flex flex-col items-center gap-2 py-4">
        <ClickButton />
      </section>

      {/* Multi-touch rank table */}
      <section className="glass rounded-2xl p-4">
        <h2 className="mb-3 text-sm font-bold">Multi-touch rewards</h2>
        <ul className="grid grid-cols-2 gap-2">
          {RANKS.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-3 py-2"
            >
              <span className="text-xs font-medium" style={{ color: r.color }}>
                {r.key}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.pointsPerFinger} / finger
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Future categories */}
      <section>
        <h2 className="mb-3 text-sm font-bold">Future Categories</h2>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <span
              key={c}
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      </section>

      <AzoxFooter />
    </div>
  );
}
