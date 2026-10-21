import { useCallback } from "react";
import { externalSupabase as supabase } from "@/integrations/external-supabase/client";
import { readStorage, writeStorage } from "@/lib/points";
import { recordTaskUnits, submitGameScoreRemote } from "@/lib/azox-backend";
import { TASK_UNITS, type ScoreGame } from "@/lib/rewards";

const STREAK_KEY = "azox_daily_streak";

type StreakState = {
  dates: string[];
};

function today() {
  return new Date().toISOString().split("T")[0] as string;
}

/**
 * All game achievements are written as real rows in user_tasks — the single
 * source of truth for the task count shown in Profile and Task Rank.
 */
export function useGameTasks() {
  // AZOX Word — +TASK_UNITS.word_complete (10) Tasks when ALL 5 words answered correctly (once per day)
  const onWordComplete = useCallback((allCorrect: boolean) => {
    // Units are granted server-side by completeDailyGame (all 5 recorded).
    return allCorrect ? TASK_UNITS.word_complete : 0;
  }, []);

  // AZOX Box — +1 Task when box opened successfully (once per box/day)
  const onBoxOpen = useCallback(() => {
    void recordTaskUnits("box_open");
    return 1;
  }, []);

  // Question Day — +TASK_UNITS.question_complete (10) Tasks when ALL questions answered correctly (once per day)
  const onQuestionComplete = useCallback((allCorrect: boolean) => {
    // Units are granted server-side by completeDailyGame (all 5 recorded).
    return allCorrect ? TASK_UNITS.question_complete : 0;
  }, []);

  // Global Button — +1 Task each time successfully pressed
  const onGlobalButtonWin = useCallback(() => {
    // Recorded server-side by globalButtonPress (one row per slot).
    return 1;
  }, []);

  // Shoot / Snake / TakBom — +10 Tasks on new WORLD record (all users)
  const onNewGlobalBest = useCallback(
    async (gameId: ScoreGame, newScore: number): Promise<number> => {
      if (newScore <= 0) return 0;

      // The ONE global best row for this game
      const { data: globalRecord } = await (supabase as any)
        .from("global_best_scores")
        .select("best_score")
        .eq("game_id", gameId)
        .maybeSingle();

      const currentGlobalBest = globalRecord?.best_score ?? 0;
      if (newScore <= currentGlobalBest) return 0;

      // Atomic strictly-higher check, personal score and +10 task units
      // all happen on the server (only when a new record is stored).
      return submitGameScoreRemote(gameId, newScore);
    },
    [],
  );

  // Daily Gift streak — +3 Tasks every 5 consecutive days
  const onDailyGiftClaimed = useCallback(() => {
    const streak = readStorage<StreakState>(STREAK_KEY, { dates: [] });
    const day = today();

    if (!streak.dates.includes(day)) {
      streak.dates.push(day);
      if (streak.dates.length > 10) streak.dates = streak.dates.slice(-10);
    }

    let tasksEarned = 0;
    if (streak.dates.length >= 5) {
      const last5 = [...streak.dates].sort().slice(-5);
      let consecutive = true;
      for (let i = 1; i < last5.length; i++) {
        const diff =
          (new Date(last5[i]!).getTime() - new Date(last5[i - 1]!).getTime()) / 86_400_000;
        if (diff !== 1) {
          consecutive = false;
          break;
        }
      }
      if (consecutive) {
        tasksEarned = 3;
        void recordTaskUnits("daily_streak");
        streak.dates = [];
      }
    }

    writeStorage(STREAK_KEY, streak);
    return tasksEarned;
  }, []);

  const getStreak = useCallback(
    () => readStorage<StreakState>(STREAK_KEY, { dates: [] }).dates.length,
    [],
  );

  return {
    onWordComplete,
    onBoxOpen,
    onQuestionComplete,
    onGlobalButtonWin,
    onNewGlobalBest,
    onDailyGiftClaimed,
    getStreak,
  };
}
