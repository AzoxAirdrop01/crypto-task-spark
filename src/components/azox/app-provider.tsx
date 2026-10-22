import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchGameSwitches, fetchGamingFace } from "@/lib/azox-backend";
import type { GamingFace } from "@/lib/gaming-face";
import { allGamesOn, toSwitchId, type GameId, type GameSwitches } from "@/lib/game-switches";
import type { RewardClaim } from "@/lib/rewards";
import { usePoints } from "@/hooks/usePoints";
import { useTasks } from "@/hooks/useTasks";
import { useUser } from "@/hooks/useUser";
import { useBoxAlert } from "@/hooks/useBoxAlert";
import { AzoxContext, useAzox, type AzoxState } from "@/components/azox/azox-context";

export { useAzox };
export type { AzoxState };

export function AzoxProvider({ children }: { children: ReactNode }) {
  const { user, dbUser } = useUser();
  const {
    points,
    rank,
    nextRank,
    progress,
    level,
    addPoints: rawAddPoints,
    tap,
    globalWins,
  } = usePoints();

  // Admin game switches: fetched on open and on Gaming/game mounts; no polling.
  const [gameSwitches, setGameSwitches] = useState<GameSwitches>(allGamesOn);
  const refreshGameSwitches = useCallback(() => {
    void fetchGameSwitches().then(setGameSwitches);
  }, []);
  useEffect(() => refreshGameSwitches(), [refreshGameSwitches]);
  const [gamingFace, setGamingFace] = useState<GamingFace | null>(null);
  const refreshGamingFace = useCallback(() => {
    void fetchGamingFace().then(setGamingFace);
  }, []);
  useEffect(() => refreshGamingFace(), [refreshGamingFace]);
  const isGameEnabled = useCallback((id: GameId) => gameSwitches[id] !== false, [gameSwitches]);

  // Never add points for a game known to be paused.
  const addPoints = useCallback(
    (n: number, claim: RewardClaim) => {
      const game =
        claim.type === "box_open"
          ? "box"
          : claim.type === "clicker_round"
            ? "clicker"
            : claim.type === "game_score"
              ? claim.gameId
              : claim.type === "daily_batch"
                ? claim.game
                : claim.type === "global_button"
                  ? "global-button"
                  : null;
      const id = game ? toSwitchId(game) : null;
      if (id && gameSwitches[id] === false) return;
      rawAddPoints(n, claim);
    },
    [rawAddPoints, gameSwitches],
  );
  const { completedTasks, completeTask, dailyClaimed, claimDaily } = useTasks(addPoints);
  const boxAlert = useBoxAlert();

  const value = useMemo<AzoxState>(
    () => ({
      user,
      dbUser,
      points,
      rank,
      nextRank,
      progress,
      level,
      addPoints,
      tap,
      completedTasks,
      completeTask,
      dailyClaimed,
      claimDaily,
      globalWins,
      referrals: dbUser?.referral_count ?? 0,
      isBoxOpen: boxAlert.isBoxOpen,
      boxSecondsRemaining: boxAlert.secondsRemaining,
      boxAlreadyOpened: boxAlert.alreadyOpened,
      gameSwitches,
      isGameEnabled,
      refreshGameSwitches,
      gamingFace,
      refreshGamingFace,
    }),
    [
      user,
      dbUser,
      points,
      rank,
      nextRank,
      progress,
      level,
      addPoints,
      tap,
      completedTasks,
      completeTask,
      dailyClaimed,
      claimDaily,
      globalWins,
      boxAlert,
      gameSwitches,
      isGameEnabled,
      refreshGameSwitches,
      gamingFace,
      refreshGamingFace,
    ],
  );

  return <AzoxContext.Provider value={value}>{children}</AzoxContext.Provider>;
}
