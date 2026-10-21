import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Coins, Play, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAzox } from "@/components/azox/app-provider";
import { AZOX_IMAGES, type AzoxImageKey } from "@/lib/azox-images";
import { GAMES, formatPoints } from "@/lib/azox-data";
import { haptic } from "@/lib/telegram";
import { QUESTION_POINTS } from "@/lib/rewards";

export const GAME_IDS = [
  "clicker",
  "box",
  "global-button",
  "question-day",
  "shoot",
  "snake",
  "tak-bom",
  "video-ads",
] as const;

export type GameId = (typeof GAME_IDS)[number];

const GAME_ALIASES: Record<string, GameId> = {
  "clicker-frenzy": "clicker",
  clicker: "clicker",
};

/** Resolve a URL param (including data-file ids like "clicker-frenzy") to a GameId. */
export function resolveGameId(value: string): GameId | null {
  if ((GAME_IDS as readonly string[]).includes(value)) return value as GameId;
  return GAME_ALIASES[value] ?? null;
}

const IMAGE_FOR: Record<GameId, AzoxImageKey> = {
  clicker: "clicker-frenzy",
  box: "box",
  "global-button": "global-button",
  "question-day": "question-day",
  shoot: "shoot",
  snake: "snake",
  "tak-bom": "tak-bom",
  "video-ads": "video-ads",
};

export const GAME_TITLES: Record<GameId, string> = {
  clicker: "Clicker Frenzy",
  box: "AZOX Box",
  "global-button": "The Global Button",
  "question-day": "AZOX Question Day",
  shoot: "AZOX Shoot",
  snake: "AZOX Snake",
  "tak-bom": "AZOX Tak Bom",
  "video-ads": "Azox Word",
};

function GameShell({
  game,
  subtitle,
  children,
}: {
  game: GameId;
  subtitle: string;
  children: React.ReactNode;
}) {
  const { points } = useAzox();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          to="/gaming"
          aria-label="Back to gaming hub"
          className="glass grid size-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <img
          src={AZOX_IMAGES[IMAGE_FOR[game]]}
          alt=""
          width={40}
          height={40}
          className="size-10 rounded-xl object-contain"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{GAME_TITLES[game]}</h1>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-bold tabular-nums">
          <Coins className="size-3.5 text-gold" aria-hidden="true" />
          {formatPoints(points)}
        </span>
      </div>
      {children}
    </div>
  );
}

function ClickerGame() {
  const { tap, rank } = useAzox();
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(15);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          setRunning(false);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [running]);

  const start = () => {
    setScore(0);
    setLeft(15);
    setRunning(true);
  };

  return (
    <GameShell game="clicker" subtitle="Tap as fast as you can for 15 seconds">
      <section className="glass flex flex-col items-center gap-4 rounded-2xl p-6">
        <p className="font-mono text-4xl font-bold tabular-nums">{left}s</p>
        <p className="text-sm text-muted-foreground">
          Session points:{" "}
          <span className="font-bold text-gold">{formatPoints(score)}</span>
        </p>
        {running ? (
          <button
            type="button"
            aria-label="Tap to earn"
            onPointerDown={() => {
              haptic();
              setScore((s) => s + tap(1));
            }}
            className="grid size-48 select-none place-items-center rounded-full border border-primary/60 bg-primary/15 text-lg font-bold transition-transform active:scale-95"
          >
            +{rank.pointsPerFinger}
          </button>
        ) : (
          <Button onClick={start} className="rounded-xl font-semibold">
            {left === 0 ? "Play again" : "Start"}
          </Button>
        )}
      </section>
    </GameShell>
  );
}

function BoxGame() {
  const { addPoints } = useAzox();
  const [reward, setReward] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);

  const open = () => {
    if (opening) return;
    setOpening(true);
    setReward(null);
    window.setTimeout(() => {
      const value = [25, 50, 75, 120, 250][Math.floor(Math.random() * 5)]!;
      addPoints(value, { type: "none" });
      setReward(value);
      setOpening(false);
      haptic("medium");
    }, 900);
  };

  return (
    <GameShell game="box" subtitle="Open a loot box for random points">
      <section className="glass glow-gold flex flex-col items-center gap-4 rounded-2xl p-6">
        <img
          src={AZOX_IMAGES.box}
          alt="AZOX loot box"
          width={140}
          height={140}
          className={opening ? "size-32 animate-pulse" : "size-32"}
        />
        <p className="text-sm text-muted-foreground">
          {reward !== null ? `You won +${reward} points!` : "Tap to open"}
        </p>
        <Button onClick={open} disabled={opening} className="rounded-xl font-semibold">
          {opening ? "Opening…" : "Open box"}
        </Button>
      </section>
    </GameShell>
  );
}

function GlobalButtonGame() {
  const { addPoints } = useAzox();
  const [left, setLeft] = useState(10);
  const [won, setWon] = useState(false);

  useEffect(() => {
    const i = setInterval(() => setLeft((l) => (l <= 0 ? 10 : l - 1)), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <GameShell game="global-button" subtitle="Press it the moment it goes live">
      <section className="glass glow-purple flex flex-col items-center gap-4 rounded-2xl p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Timer className="size-4" aria-hidden="true" /> Next window in {left}s
        </div>
        <Button
          disabled={left > 3}
          onClick={() => {
            addPoints(500, { type: "none" });
            setWon(true);
          }}
          className="h-16 w-40 rounded-2xl text-base font-bold"
        >
          {left > 3 ? "Locked" : "PRESS!"}
        </Button>
        {won ? <p className="text-sm font-semibold text-gold">+500 points</p> : null}
      </section>
    </GameShell>
  );
}

const QUESTIONS = [
  {
    q: "Which chain is the AZOX token built for?",
    options: ["Robinhood Chain", "Bitcoin", "Dogechain"],
    answer: 0,
  },
  {
    q: "How many AZOX ranks are there?",
    options: ["5", "7", "10"],
    answer: 1,
  },
  {
    q: "What does the Global Button reward?",
    options: ["Nothing", "Bonus points", "A refund"],
    answer: 1,
  },
];

function QuestionDayGame() {
  const { addPoints } = useAzox();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const question = QUESTIONS[index]!;

  const choose = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (i === question.answer) addPoints(QUESTION_POINTS, { type: "none" });
  };

  return (
    <GameShell game="question-day" subtitle={`Answer correctly to earn +${QUESTION_POINTS}`}>
      <section className="glass flex flex-col gap-3 rounded-2xl p-5">
        <p className="text-sm font-semibold">{question.q}</p>
        {question.options.map((o, i) => {
          const isAnswer = i === question.answer;
          const state =
            picked === null
              ? "border-border"
              : isAnswer
                ? "border-success text-success"
                : i === picked
                  ? "border-destructive text-destructive"
                  : "border-border opacity-60";
          return (
            <button
              key={o}
              type="button"
              onClick={() => choose(i)}
              className={`rounded-xl border bg-secondary/40 px-3 py-2.5 text-left text-sm ${state}`}
            >
              {o}
            </button>
          );
        })}
        {picked !== null ? (
          <Button
            onClick={() => {
              setPicked(null);
              setIndex((n) => (n + 1) % QUESTIONS.length);
            }}
            className="mt-1 rounded-xl font-semibold"
          >
            Next question
          </Button>
        ) : null}
      </section>
    </GameShell>
  );
}

function VideoAdsGame() {
  const { addPoints } = useAzox();
  const [watching, setWatching] = useState(false);
  const [done, setDone] = useState(false);

  const watch = () => {
    if (watching) return;
    setWatching(true);
    window.setTimeout(() => {
      addPoints(75, { type: "none" });
      setWatching(false);
      setDone(true);
    }, 2000);
  };

  return (
    <GameShell game="video-ads" subtitle="Watch an ad to earn +75">
      <section className="glass flex flex-col items-center gap-4 rounded-2xl p-6">
        <div className="grid aspect-video w-full place-items-center rounded-2xl border border-border bg-secondary/40">
          {watching ? (
            <span className="animate-pulse text-sm text-muted-foreground">
              Playing ad…
            </span>
          ) : (
            <Play className="size-10 text-accent" aria-hidden="true" />
          )}
        </div>
        <Button onClick={watch} disabled={watching} className="rounded-xl font-semibold">
          {watching ? "Playing…" : done ? "Watch another" : "Watch ad"}
        </Button>
      </section>
    </GameShell>
  );
}

function ComingSoonGame({ game }: { game: GameId }) {
  const meta = GAMES.find((g) => g.name === GAME_TITLES[game]);
  return (
    <GameShell game={game} subtitle={meta?.tag ?? "Arcade"}>
      <section className="glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
        <img
          src={AZOX_IMAGES[IMAGE_FOR[game]]}
          alt=""
          width={96}
          height={96}
          className="size-24 rounded-2xl object-contain"
        />
        <p className="text-sm font-bold">{GAME_TITLES[game]} is coming soon</p>
        <p className="text-xs text-muted-foreground">
          This arcade game is in development. Keep tapping to climb the ranks in
          the meantime.
        </p>
        <Link
          to="/"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Back to tapping
        </Link>
      </section>
    </GameShell>
  );
}

export function GameScreen({ game }: { game: GameId }) {
  switch (game) {
    case "clicker":
      return <ClickerGame />;
    case "box":
      return <BoxGame />;
    case "global-button":
      return <GlobalButtonGame />;
    case "question-day":
      return <QuestionDayGame />;
    case "video-ads":
      return <VideoAdsGame />;
    default:
      return <ComingSoonGame game={game} />;
  }
}
