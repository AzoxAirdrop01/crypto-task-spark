import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAzox } from "@/components/azox/app-provider";
import { toSwitchId } from "@/lib/game-switches";
import { ChevronRight } from "lucide-react";
import { GAMES } from "@/lib/azox-data";
import { AzoxFooter } from "@/components/azox/footer";
import { ReferralFace } from "./referral-face";

export function GamingPage() {
  const { isGameEnabled, refreshGameSwitches, gamingFace, refreshGamingFace } = useAzox();
  useEffect(() => {
    refreshGameSwitches();
    refreshGamingFace();
  }, [refreshGameSwitches, refreshGamingFace]);
  if (gamingFace === null) {
    return <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (gamingFace === 2) return <ReferralFace />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">AZOX Gaming</h1>
        <p className="text-sm text-muted-foreground">
          Play, earn points and climb the global ranks.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {GAMES.map((game) => {
          const switchId = toSwitchId(game.id);
          if (switchId && !isGameEnabled(switchId)) {
            return (
              <div
                key={game.id}
                aria-disabled="true"
                aria-label={`${game.name} (paused)`}
                className="glass flex cursor-not-allowed flex-col items-center gap-3 rounded-2xl p-4 text-center opacity-50"
              >
                <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-3xl border border-border bg-secondary/40 p-3">
                  <span className="absolute right-2 top-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Paused
                  </span>
                  <img
                    src={game.image}
                    alt={game.name}
                    width={120}
                    height={120}
                    className="size-full rounded-2xl object-contain grayscale"
                  />
                </div>
                <span className="line-clamp-2 text-xs font-semibold leading-snug">{game.name}</span>
              </div>
            );
          }
          return (
            <Link
              key={game.id}
              to="/games/$game"
              params={{ game: game.id }}
              className="glass group flex flex-col items-center gap-3 rounded-2xl p-4 text-center transition-transform active:scale-95 hover:border-accent/40"
            >
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-3xl border border-border bg-secondary/40 p-3">
                <span className="absolute right-2 top-2 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {game.tag}
                </span>
                <img
                  src={game.image}
                  alt={game.name}
                  width={120}
                  height={120}
                  className="size-full rounded-2xl object-contain transition-transform duration-200 group-hover:scale-105"
                />
              </div>
              <span className="line-clamp-2 text-xs font-semibold leading-snug">{game.name}</span>
            </Link>
          );
        })}
      </div>

      <Link
        to="/leaderboard"
        className="glass glow-gold flex items-center justify-between rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
      >
        <div>
          <p className="text-sm font-bold">Global Leaderboard</p>
          <p className="text-xs text-muted-foreground">See where you rank worldwide</p>
        </div>
        <ChevronRight className="size-5 text-gold" aria-hidden="true" />
      </Link>

      <AzoxFooter />
    </div>
  );
}
