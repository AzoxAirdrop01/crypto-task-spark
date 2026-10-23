import { createFileRoute, notFound } from "@tanstack/react-router";
import { GAME_TITLES, GameScreen, resolveGameId } from "@/components/azox/games/game-screen";
import AzoxWord from "@/components/azox/games/VideoAds";
import AzoxBox from "@/components/azox/games/AzoxBox";
import ClickerFrenzy from "@/components/azox/games/ClickerFrenzy";
import GlobalButton from "@/components/azox/games/GlobalButton";
import QuestionDay from "@/components/azox/games/QuestionDay";
import ShootGame from "@/components/azox/games/ShootGame";
import SnakeGame from "@/components/azox/games/SnakeGame";
import TakBomGame from "@/components/azox/games/TakBom";

import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAzox } from "@/components/azox/app-provider";
import { Button } from "@/components/ui/button";
import { GAME_DISABLED_EVENT } from "@/lib/azox-backend";
import { toSwitchId } from "@/lib/game-switches";

function PausedScreen() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-muted-foreground">
        This game is temporarily paused. Please check back soon.
      </p>
      <Button asChild className="rounded-xl font-semibold">
        <Link to="/gaming">Back to Games</Link>
      </Button>
    </div>
  );
}

export const Route = createFileRoute("/games/$game")({
  loader: ({ params }) => {
    const game = resolveGameId(params.game);
    if (!game) throw notFound();
    return { game };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Game unavailable — AZOX" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `${GAME_TITLES[loaderData.game]} — AZOX Gaming`;
    const description = `Play ${GAME_TITLES[loaderData.game]} in the AZOX mini app and earn points toward your next rank.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: GameRoute,
});

function GameRoute() {
  const { game } = Route.useLoaderData();
  const { addPoints, isGameEnabled, refreshGameSwitches, gamingFace } = useAzox();
  const navigate = useNavigate();
  useEffect(() => refreshGameSwitches(), [refreshGameSwitches]);
  useEffect(() => {
    const onDisabled = () => {
      toast("This game was just paused");
      refreshGameSwitches();
      void navigate({ to: "/gaming" });
    };
    window.addEventListener(GAME_DISABLED_EVENT, onDisabled);
    return () => window.removeEventListener(GAME_DISABLED_EVENT, onDisabled);
  }, [navigate, refreshGameSwitches]);
  if (gamingFace === null) {
    return <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (gamingFace === 2) return <PausedScreen />;
  const switchId = toSwitchId(game);
  if (switchId && !isGameEnabled(switchId)) return <PausedScreen />;
  if (game === "shoot") {
    return (
      <ShootGame
        onGameOver={(score) => addPoints(score, { type: "game_score", gameId: "shoot", score })}
      />
    );
  }
  if (game === "snake") {
    return <SnakeGame />;
  }
  if (game === "tak-bom") {
    return <TakBomGame />;
  }
  if (game === "box") {
    return <AzoxBox />;
  }
  if (game === "global-button") {
    return <GlobalButton />;
  }
  if (game === "video-ads") {
    return <AzoxWord />;
  }
  if (game === "question-day") {
    return <QuestionDay />;
  }
  if (game === "clicker") {
    return <ClickerFrenzy />;
  }

  return <GameScreen game={game} />;
}
