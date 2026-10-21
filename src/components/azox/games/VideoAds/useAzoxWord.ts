import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAzox } from "@/components/azox/app-provider";
import { haptic } from "@/lib/telegram";
import { WORD_POINTS } from "@/lib/rewards";

export const SECONDS_PER_WORD = 60;
export const POINTS_PER_WORD = WORD_POINTS;
export const WORDS_PER_DAY = 5;
export const MAX_DAILY_POINTS = POINTS_PER_WORD * WORDS_PER_DAY;

export type Difficulty = "easy" | "medium" | "hard";
export type WordEntry = { word: string; difficulty: Difficulty; points: number };

const EASY_WORDS = [
  "CAT","DOG","SUN","MAP","KEY","ACE","BIT","CUP","DEN","EGG",
  "FAN","GAS","HAT","ICE","JAR","KID","LAP","MEN","NET","OWN",
  "PAN","RAG","SAP","TAB","VAN","WAX","ZAP","BED","COD","FIT",
];

const MEDIUM_WORDS = [
  "BLOCK","BRAND","CHAIN","DANCE","EARTH","FLAME","GRACE","HEART",
  "INBOX","JUICE","KNIFE","LEMON","MOUSE","NIGHT","OCEAN","PLANE",
  "QUEST","RIDER","STONE","TIGER","UNION","VALOR","WHALE","XENON",
  "YOUNG","ZEBRA","CLOUD","DRAFT","ELITE","FLOCK",
];

const HARD_WORDS = [
  "BITCOIN","ANDROID","BALLOON","CAPTAIN","DIAMOND","ELEMENT",
  "FANTASY","GENERAL","HARMONY","INSTALL","JUSTICE","KITCHEN",
  "LANTERN","MISSION","NETWORK","OCTOBER","PAYMENT","QUANTUM",
  "RAILWAY","SCATTER","THERMAL","UPGRADE","VENTURE","WARRIOR",
  "COMPLEX","FORTUNE","IMAGINE","MACHINE","PACKAGE","RESPOND",
  "SOLANA","PHANTOM","TRADING","AIRDROP","DIGITAL","CHAPTER",
  "PROGRAM","FREEDOM","NATURAL","REPLACE","COMBINE","FACTORY",
  "JOURNEY","AMAZING","CLUSTER","FEATURE","APPROVE","FORWARD",
  "CREATIVE","UNIVERSE","COMPLETE","PLATFORM","EXCHANGE","SECURITY",
  "TOGETHER","DOCUMENT","FUNCTION","CONTINUE","PRACTICE","QUESTION",
  "STANDARD","ABSOLUTE","COMPUTER","DATABASE","GENERATE","HARDWARE",
];

export function getDailyWords(dateStr: string): WordEntry[] {
  const seed = dateStr
    .split("")
    .reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
  let rng = seed;
  const seededRandom = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };
  const pick = (arr: string[]) => arr[Math.floor(seededRandom() * arr.length)]!;

  return [
    { word: pick(EASY_WORDS), difficulty: "easy", points: POINTS_PER_WORD },
    { word: pick(MEDIUM_WORDS), difficulty: "medium", points: POINTS_PER_WORD },
    { word: pick(HARD_WORDS), difficulty: "hard", points: POINTS_PER_WORD },
    { word: pick(HARD_WORDS), difficulty: "hard", points: POINTS_PER_WORD },
    { word: pick(HARD_WORDS), difficulty: "hard", points: POINTS_PER_WORD },
  ];
}

export function shuffleWord(word: string): string[] {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = letters[i]!;
    letters[i] = letters[j]!;
    letters[j] = a;
  }
  if (letters.join("") === word && letters.length > 1) {
    const a = letters[0]!;
    letters[0] = letters[1]!;
    letters[1] = a;
  }
  return letters;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatHMS(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function secondsUntilTomorrow(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.floor((next.getTime() - now.getTime()) / 1000);
}

const K = {
  lastPlayed: "azoxWord_lastPlayed",
  todayScore: "azoxWord_todayScore",
  todayCorrect: "azoxWord_todayCorrect",
  best: "azoxWord_bestScore",
  wordIndex: "azoxWord_wordIndex",
  completed: "azoxWord_completed",
  correctIdx: "azoxWord_correctIdx",
} as const;

function readIndices(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(K.correctIdx) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

function readNumber(key: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export type Phase = "intro" | "playing" | "correct" | "timeup" | "complete";

export function useAzoxWord() {
  const { addPoints } = useAzox();
  const [hydrated, setHydrated] = useState(false);
  const [date, setDate] = useState(todayKey);
  const [words, setWords] = useState<WordEntry[]>(() => getDailyWords(todayKey()));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [best, setBest] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_WORD);
  const [pool, setPool] = useState<{ id: number; letter: string }[]>([]);
  const [placed, setPlaced] = useState<{ id: number; letter: string }[]>([]);
  const [wrong, setWrong] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [resetIn, setResetIn] = useState(0);
  const timers = useRef<number[]>([]);

  const current = words[index];

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // Hydrate from localStorage after mount.
  useEffect(() => {
    const today = todayKey();
    const last = window.localStorage.getItem(K.lastPlayed);
    setDate(today);
    setWords(getDailyWords(today));
    setBest(readNumber(K.best));
    if (last === today) {
      const done = window.localStorage.getItem(K.completed) === "true";
      setScore(readNumber(K.todayScore));
      setCorrectCount(readNumber(K.todayCorrect));
      setIndex(Math.min(readNumber(K.wordIndex), WORDS_PER_DAY));
      setPhase(done ? "complete" : "intro");
    } else {
      window.localStorage.setItem(K.lastPlayed, today);
      window.localStorage.setItem(K.todayScore, "0");
      window.localStorage.setItem(K.todayCorrect, "0");
      window.localStorage.setItem(K.wordIndex, "0");
      window.localStorage.setItem(K.completed, "false");
      window.localStorage.setItem(K.correctIdx, "[]");
    }
    setHydrated(true);
    return clearTimers;
  }, []);

  // Countdown to next day.
  useEffect(() => {
    setResetIn(secondsUntilTomorrow());
    const i = setInterval(() => setResetIn(secondsUntilTomorrow()), 1000);
    return () => clearInterval(i);
  }, []);

  const loadWord = useCallback(
    (i: number) => {
      const entry = words[i];
      if (!entry) return;
      const letters = shuffleWord(entry.word).map((letter, id) => ({ id, letter }));
      setPool(letters);
      setPlaced([]);
      setWrong(false);
      setHintUsed(false);
      setSecondsLeft(SECONDS_PER_WORD);
      setPhase("playing");
    },
    [words],
  );

  const finishDay = useCallback(
    (finalScore: number) => {
      window.localStorage.setItem(K.completed, "true");
      window.localStorage.setItem(K.wordIndex, String(WORDS_PER_DAY));
      const nextBest = Math.max(readNumber(K.best), finalScore);
      window.localStorage.setItem(K.best, String(nextBest));
      setBest(nextBest);
      setPhase("complete");
      // ONE backend request for the whole session (browser decides correctness).
      addPoints(0, { type: "daily_batch", game: "word", indices: readIndices() });
    },
    [addPoints],
  );

  const advance = useCallback(
    (fromIndex: number, currentScore: number) => {
      const next = fromIndex + 1;
      setIndex(next);
      window.localStorage.setItem(K.wordIndex, String(next));
      if (next >= WORDS_PER_DAY) finishDay(currentScore);
      else loadWord(next);
    },
    [finishDay, loadWord],
  );

  // Per-word timer.
  useEffect(() => {
    if (phase !== "playing") return;
    const i = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(i);
          setPhase("timeup");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [phase]);

  // Time-up pause then advance.
  useEffect(() => {
    if (phase !== "timeup") return;
    haptic("medium");
    later(() => advance(index, score), 1500);
    return clearTimers;
  }, [phase, index, score, advance]);

  // Correct celebration then advance.
  useEffect(() => {
    if (phase !== "correct") return;
    later(() => advance(index, score), 800);
    return clearTimers;
  }, [phase, index, score, advance]);

  const start = useCallback(() => {
    const i = Math.min(readNumber(K.wordIndex), WORDS_PER_DAY - 1);
    setIndex(i);
    loadWord(i);
  }, [loadWord]);

  const submit = useCallback(
    (letters: { id: number; letter: string }[]) => {
      if (!current) return;
      const guess = letters.map((l) => l.letter).join("");
      if (guess === current.word) {
        haptic("medium");
        const nextScore = score + POINTS_PER_WORD;
        const nextCorrect = correctCount + 1;
        setScore(nextScore);
        setCorrectCount(nextCorrect);
        window.localStorage.setItem(K.todayScore, String(nextScore));
        window.localStorage.setItem(K.todayCorrect, String(nextCorrect));
        window.localStorage.setItem(K.correctIdx, JSON.stringify([...readIndices(), index]));
        // Local display only; paid by the end-of-game batch.
        addPoints(POINTS_PER_WORD, { type: "none" });
        setPhase("correct");
      } else {
        haptic();
        setWrong(true);
        later(() => {
          setWrong(false);
          setPool((p) => [...p, ...letters].sort((a, b) => a.id - b.id));
          setPlaced([]);
        }, 500);
      }
    },
    [current, score, correctCount, addPoints, index],
  );

  const pickLetter = useCallback(
    (id: number) => {
      if (phase !== "playing" || wrong) return;
      const tile = pool.find((p) => p.id === id);
      if (!tile) return;
      haptic("light");
      const nextPlaced = [...placed, tile];
      setPool((p) => p.filter((x) => x.id !== id));
      setPlaced(nextPlaced);
      if (current && nextPlaced.length === current.word.length) {
        later(() => submit(nextPlaced), 150);
      }
    },
    [phase, wrong, pool, placed, current, submit],
  );

  const returnLetter = useCallback(
    (id: number) => {
      if (phase !== "playing" || wrong) return;
      const tile = placed.find((p) => p.id === id);
      if (!tile) return;
      haptic("light");
      setPlaced((p) => p.filter((x) => x.id !== id));
      setPool((p) => [...p, tile].sort((a, b) => a.id - b.id));
    },
    [phase, wrong, placed],
  );

  const useHint = useCallback(() => {
    if (phase !== "playing" || hintUsed || !current) return;
    const target = current.word[placed.length];
    if (!target) return;
    const tile = pool.find((p) => p.letter === target);
    if (!tile) return;
    setHintUsed(true);
    pickLetter(tile.id);
  }, [phase, hintUsed, current, placed.length, pool, pickLetter]);

  const answer = useMemo(() => current?.word ?? "", [current]);

  return {
    hydrated,
    date,
    words,
    index,
    current,
    answer,
    phase,
    score,
    correctCount,
    best,
    secondsLeft,
    pool,
    placed,
    wrong,
    hintUsed,
    resetIn,
    start,
    pickLetter,
    returnLetter,
    useHint,
  };
}
