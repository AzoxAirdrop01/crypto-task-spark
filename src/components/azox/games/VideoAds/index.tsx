import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, Coins, Lightbulb, Trophy } from "lucide-react";
import { useAzox } from "@/components/azox/app-provider";
import { useGameTasks } from "@/hooks/useGameTasks";
import { formatPoints } from "@/lib/azox-data";
import AnswerSlots from "./AnswerSlots";
import WordTiles from "./WordTiles";
import WordTimer from "./WordTimer";
import {
  MAX_DAILY_POINTS,
  POINTS_PER_WORD,
  SECONDS_PER_WORD,
  WORDS_PER_DAY,
  formatHMS,
  useAzoxWord,
} from "./useAzoxWord";

const DIFF_LABEL = { easy: "🟢 Easy", medium: "🟡 Medium", hard: "🔴 Hard" };

export default function AzoxWord() {
  const { points: accountPoints } = useAzox();
  const g = useAzoxWord();
  const { onWordComplete } = useGameTasks();
  const wordTaskFiredRef = useRef(false);

  useEffect(() => {
    if (g.phase !== "complete" || wordTaskFiredRef.current) return;
    wordTaskFiredRef.current = true;
    const earned = onWordComplete(g.correctCount === WORDS_PER_DAY);
    if (earned > 0) toast.success(`+${earned} Tasks earned! 🔤`);
  }, [g.phase, g.correctCount, onWordComplete]);

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
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">Azox Word</h1>
          <p className="truncate text-xs text-muted-foreground">
            Unscramble 5 daily words
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-bold tabular-nums">
          <Coins className="size-3.5 text-gold" aria-hidden="true" />
          {formatPoints(accountPoints)}
        </span>
      </div>

      {!g.hydrated ? (
        <section className="glass grid h-64 place-items-center rounded-2xl">
          <p className="text-sm text-muted-foreground">Loading today's words…</p>
        </section>
      ) : g.phase === "intro" ? (
        <section className="glass glow-orange flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-black text-primary text-glow-orange">
            Azox Word
          </h2>
          <p className="text-sm text-muted-foreground">
            {WORDS_PER_DAY} words today • {POINTS_PER_WORD} pts each
          </p>
          <p className="text-xs text-muted-foreground">
            Max: {MAX_DAILY_POINTS} points per day
          </p>
          {g.index > 0 ? (
            <p className="text-xs font-semibold text-gold">
              Resuming at word {g.index + 1} of {WORDS_PER_DAY}
            </p>
          ) : null}
          <button
            type="button"
            onClick={g.start}
            className="mt-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-transform active:scale-95"
          >
            TAP TO START
          </button>
        </section>
      ) : g.phase === "complete" ? (
        <section className="glass glow-gold flex flex-col items-center gap-2 rounded-2xl p-8 text-center">
          <Trophy className="size-10 text-gold" aria-hidden="true" />
          <h2 className="text-lg font-black">Daily Challenge Done!</h2>
          <p className="text-sm text-muted-foreground">
            Words Correct:{" "}
            <span className="font-bold text-foreground">
              {g.correctCount}/{WORDS_PER_DAY}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Points Earned:{" "}
            <span className="font-bold text-gold">{formatPoints(g.score)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Best Score: {formatPoints(g.best)} pts
          </p>
          <p className="text-xs text-muted-foreground">Come back tomorrow!</p>
          <p className="font-mono text-lg font-bold tabular-nums text-primary">
            Resets in {formatHMS(g.resetIn)}
          </p>
          <Link
            to="/gaming"
            className="mt-2 rounded-xl border border-border px-5 py-2.5 text-sm font-bold"
          >
            EXIT
          </Link>
        </section>
      ) : (
        <>
          <section className="glass flex flex-col items-center gap-3 rounded-2xl p-5">
            <div className="flex items-center gap-2">
              {Array.from({ length: WORDS_PER_DAY }, (_, i) => (
                <span
                  key={i}
                  className={`size-2.5 rounded-full ${i < g.index ? "bg-primary" : "bg-secondary"}`}
                />
              ))}
            </div>
            <p className="text-xs font-semibold text-muted-foreground">
              Word {g.index + 1} of {WORDS_PER_DAY} •{" "}
              {DIFF_LABEL[g.current?.difficulty ?? "easy"]}
            </p>
            <WordTimer seconds={g.secondsLeft} total={SECONDS_PER_WORD} />
          </section>

          <section className="glass flex flex-col items-center gap-5 rounded-2xl p-5">
            <AnswerSlots
              length={g.answer.length}
              placed={g.placed}
              state={
                g.phase === "correct"
                  ? "correct"
                  : g.phase === "timeup"
                    ? "timeup"
                    : g.wrong
                      ? "wrong"
                      : "playing"
              }
              onReturn={g.returnLetter}
            />

            {g.phase === "correct" ? (
              <p className="rounded-xl bg-success/15 px-4 py-2 text-sm font-bold text-success">
                +{POINTS_PER_WORD} Points!
              </p>
            ) : g.phase === "timeup" ? (
              <p className="rounded-xl bg-destructive/15 px-4 py-2 text-center text-sm font-bold text-destructive">
                ⏰ Time's up! The word was: {g.answer}
              </p>
            ) : (
              <>
                <WordTiles
                  pool={g.pool}
                  disabled={g.wrong}
                  onPick={g.pickLetter}
                />
                <button
                  type="button"
                  onClick={g.useHint}
                  disabled={g.hintUsed}
                  className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-bold disabled:opacity-40"
                >
                  <Lightbulb className="size-3.5 text-gold" aria-hidden="true" />
                  {g.hintUsed ? "Hint used" : "Hint"}
                </button>
              </>
            )}
          </section>

          <p className="text-center text-xs text-muted-foreground">
            Session score:{" "}
            <span className="font-bold text-gold">{formatPoints(g.score)}</span>
          </p>
        </>
      )}
    </div>
  );
}
