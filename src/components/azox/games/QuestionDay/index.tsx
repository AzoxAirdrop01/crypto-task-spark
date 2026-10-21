import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Coins, Timer, Trophy } from "lucide-react";
import { useAzox } from "@/components/azox/app-provider";
import { useGameTasks } from "@/hooks/useGameTasks";
import { formatPoints } from "@/lib/azox-data";
import { haptic } from "@/lib/telegram";
import { QUESTION_POINTS } from "@/lib/rewards";
import { Button } from "@/components/ui/button";
import { fetchDailyQuestions, type DailyQuestionsFetch } from "@/lib/azox-backend";
import type { DailyQuestion as Question } from "@/lib/question-day.functions";

const SECONDS_PER_QUESTION = 60;
const POINTS_PER_CORRECT = QUESTION_POINTS;
const LETTERS = ["A", "B", "C", "D", "E"];

export default function QuestionDay() {
  const [state, setState] = useState<DailyQuestionsFetch | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchDailyQuestions().then((result) => {
      if (cancelled) return;
      setState(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state?.status === "ok") return <QuestionDayGame questions={state.questions} />;

  return (
    <div className="flex min-h-[80dvh] flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link
          to="/gaming"
          aria-label="Back to gaming hub"
          className="glass grid size-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-lg font-black text-primary">AZOX Question Day</h1>
      </header>
      {!loading && state?.status === "already_played" ? (
        <AlreadyPlayed nextResetAt={state.nextResetAt} />
      ) : loading ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          Loading questions…
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            Today's questions are not available right now. Please try again later.
          </p>
          <Button
            onClick={() => {
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function AlreadyPlayed({ nextResetAt }: { nextResetAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, Math.ceil((nextResetAt - now) / 1000));
  const hms = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
  return (
    <div
      className="rounded-3xl border p-6 text-center"
      style={{ background: "#0d0d0d", borderColor: "#22c55e" }}
    >
      <Trophy className="mx-auto size-8" style={{ color: "#FFD700" }} aria-hidden="true" />
      <p className="mt-3 text-base font-black" style={{ color: "#22c55e" }}>
        You've completed today's Question Day
      </p>
      <p className="mt-2 text-sm text-muted-foreground">New questions at 00:00 UTC</p>
      <p
        className="mt-3 font-mono text-2xl font-black tabular-nums"
        style={{ color: "#22c55e" }}
        aria-live="polite"
      >
        {hms}
      </p>
      <Link
        to="/gaming"
        className="mt-5 block rounded-xl px-4 py-2.5 text-sm font-black text-black"
        style={{ background: "#22c55e" }}
      >
        Back to Gaming
      </Link>
    </div>
  );
}

function QuestionDayGame({ questions }: { questions: Question[] }) {
  const { points: accountPoints, addPoints } = useAzox();
  const { onQuestionComplete } = useGameTasks();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);
  const [done, setDone] = useState(false);
  const completedRef = useRef(false);
  const correctIdxRef = useRef<number[]>([]);

  const current = questions[index] ?? questions[0];

  const next = useCallback(() => {
    setPicked(null);
    setTimeLeft(SECONDS_PER_QUESTION);
    setIndex((i) => {
      if (i + 1 >= questions.length) {
        setDone(true);
        return i;
      }
      return i + 1;
    });
  }, [questions.length]);

  useEffect(() => {
    if (done || picked !== null) return;
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) {
          setPicked(-1);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [done, picked]);

  useEffect(() => {
    if (picked === null || done) return;
    const t = setTimeout(next, 1400);
    return () => clearTimeout(t);
  }, [picked, done, next]);

  useEffect(() => {
    if (!done || completedRef.current) return;
    completedRef.current = true;
    const correctCount = Math.round(score / POINTS_PER_CORRECT);
    const allCorrect = correctCount === questions.length;
    // ONE backend request for the whole session (browser decides correctness).
    addPoints(0, { type: "daily_batch", game: "question", indices: correctIdxRef.current });
    onQuestionComplete(allCorrect);
  }, [done, score, onQuestionComplete, addPoints, questions.length]);

  if (!current) return null;

  const answer = (i: number) => {
    if (picked !== null || done) return;
    setPicked(i);
    haptic();
    if (i === current.correct) {
      setScore((s) => s + POINTS_PER_CORRECT);
      correctIdxRef.current.push(index);
      // Local display only; paid by the end-of-game batch.
      addPoints(POINTS_PER_CORRECT, { type: "none" });
    }
  };

  const optionStyle = (i: number) => {
    if (picked === null)
      return { background: "#1a1a1a", borderColor: "#22c55e", color: "#fff" };
    if (i === current.correct)
      return { background: "#22c55e", borderColor: "#22c55e", color: "#0d0d0d" };
    if (i === picked)
      return { background: "#ef4444", borderColor: "#ef4444", color: "#fff" };
    return { background: "#141414", borderColor: "#243024", color: "#9ca3af" };
  };

  return (
    <div
      className="flex min-h-[80dvh] flex-col gap-4"
      style={{ background: "#000" }}
    >
      <header className="flex items-center gap-3">
        <Link
          to="/gaming"
          aria-label="Back to gaming hub"
          className="glass grid size-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-lg font-black" style={{ color: "#22c55e" }}>
          AZOX Question Day
        </h1>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-bold tabular-nums">
          <Coins className="size-3.5" style={{ color: "#FFD700" }} aria-hidden="true" />
          {formatPoints(accountPoints)}
        </span>
      </header>

      {done ? (
        <div
          className="rounded-3xl border p-6 text-center"
          style={{ background: "#0d0d0d", borderColor: "#22c55e" }}
        >
          <Trophy className="mx-auto size-8" style={{ color: "#FFD700" }} aria-hidden="true" />
          <p className="mt-3 text-base font-black" style={{ color: "#22c55e" }}>
            Quiz complete!
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            You scored{" "}
            <span className="font-bold" style={{ color: "#FFD700" }}>
              {score}
            </span>{" "}
            points
          </p>
          <Link
            to="/gaming"
            className="mt-5 block rounded-xl px-4 py-2.5 text-sm font-black text-black"
            style={{ background: "#22c55e" }}
          >
            EXIT
          </Link>
        </div>
      ) : (
        <div
          className="flex flex-col gap-4 rounded-3xl border p-4"
          style={{ background: "#0d0d0d", borderColor: "rgba(34,197,94,0.35)" }}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-muted-foreground">
              Question {index + 1}/{questions.length}
            </span>
            <span
              className="flex items-center gap-1.5 font-mono tabular-nums"
              style={{ color: timeLeft < 10 ? "#ef4444" : "#22c55e" }}
            >
              <Timer className="size-3.5" aria-hidden="true" />
              {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:
              {String(timeLeft % 60).padStart(2, "0")}
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((index + 1) / questions.length) * 100}%`,
                background: "#22c55e",
              }}
            />
          </div>

          <div
            className="flex min-h-[84px] items-center rounded-2xl p-4"
            style={{ background: "#141414" }}
          >
            <p className="text-[16px] font-semibold leading-relaxed text-white">
              {current.question}
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            {current.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => answer(i)}
                disabled={picked !== null}
                className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors"
                style={optionStyle(i)}
              >
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-lg text-xs font-black"
                  style={{
                    background: "rgba(0,0,0,0.35)",
                    color: picked === null ? "#22c55e" : "inherit",
                  }}
                >
                  {LETTERS[i]}
                </span>
                <span className="min-w-0 flex-1">{opt}</span>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Score:{" "}
            <span className="font-bold" style={{ color: "#FFD700" }}>
              {score}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
