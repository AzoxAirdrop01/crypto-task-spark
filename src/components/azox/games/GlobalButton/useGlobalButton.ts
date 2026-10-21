import { useCallback, useEffect, useRef, useState } from "react";
import { useAzox } from "@/components/azox/app-provider";
import { haptic } from "@/lib/telegram";
import { GLOBAL_BUTTON_REWARD } from "@/lib/rewards";

const SLOT_MS = 3 * 60 * 60 * 1000; // every 3 hours (UTC+3 slots align with UTC)
const ACTIVE_MS = 20 * 1000;
const MAX_WINNERS = 35000;
const REWARD = GLOBAL_BUTTON_REWARD;

const PRESS_KEY = "globalButton_lastPress";
const WINNERS_KEY = "globalButton_winners";

/** Timestamp (ms) of the activation slot at or before `now`. */
function currentSlot(now: number): number {
  return Math.floor(now / SLOT_MS) * SLOT_MS;
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function formatHMS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function useGlobalButton() {
  const { addPoints } = useAzox();
  const [now, setNow] = useState(() => Date.now());
  const [lastPress, setLastPress] = useState(0);
  const [winners, setWinners] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const pressing = useRef(false);

  useEffect(() => {
    setLastPress(readNumber(PRESS_KEY, 0));
    setWinners(readNumber(WINNERS_KEY, 0));
    setHydrated(true);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const slot = currentSlot(now);
  const nextSlot = slot + SLOT_MS;
  const sinceSlot = now - slot;
  const spotsLeft = Math.max(0, MAX_WINNERS - winners);
  const isActive = sinceSlot < ACTIVE_MS && spotsLeft > 0;
  const hasPressed = lastPress === slot;
  const missed = !isActive && !hasPressed && sinceSlot >= ACTIVE_MS;

  const handlePress = useCallback(() => {
    if (pressing.current) return;
    const t = Date.now();
    const s = currentSlot(t);
    if (t - s >= ACTIVE_MS) return;
    if (readNumber(PRESS_KEY, 0) === s) return;
    const w = readNumber(WINNERS_KEY, 0);
    if (w >= MAX_WINNERS) return;

    pressing.current = true;
    window.localStorage.setItem(PRESS_KEY, String(s));
    window.localStorage.setItem(WINNERS_KEY, String(w + 1));
    setLastPress(s);
    setWinners(w + 1);
    addPoints(REWARD, { type: "global_button" });
    haptic("medium");
    window.setTimeout(() => {
      pressing.current = false;
    }, 500);
  }, [addPoints]);

  return {
    isActive,
    hasPressed,
    missed,
    hydrated,
    timeUntilNext: Math.max(0, nextSlot - now),
    timeLeft: Math.max(0, ACTIVE_MS - sinceSlot),
    spotsLeft,
    maxWinners: MAX_WINNERS,
    reward: REWARD,
    handlePress,
  };
}
