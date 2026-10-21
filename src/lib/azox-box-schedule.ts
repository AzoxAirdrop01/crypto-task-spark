export const BOXES_PER_DAY = 20;
export const SESSION_SECONDS = 90;
export const MAX_WINNERS = 65000;
export const BOX_REWARD = 3600;

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function secondsFromMidnight(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** Completely random (but date-seeded) schedule: up to 20 boxes, wildly varying gaps. */
export function generateDailySchedule(dateStr: string): number[] {
  const dateSeed = dateStr
    .split("")
    .reduce((a, c, i) => a + c.charCodeAt(0) * (i + 7) * 31, 0);

  let rng = dateSeed ^ 0xdeadbeef;
  const seededRandom = () => {
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return Math.abs(rng % 1000) / 1000;
  };

  const totalSeconds = 24 * 60 * 60;
  const times: number[] = [];
  let lastTime = Math.floor(seededRandom() * 3600);

  for (let i = 0; i < BOXES_PER_DAY; i++) {
    times.push(lastTime);
    const minGap = 900;
    const maxGap = 5400;
    const gap = minGap + Math.floor(seededRandom() * (maxGap - minGap));
    lastTime += gap + SESSION_SECONDS;
    if (lastTime >= totalSeconds - SESSION_SECONDS) break;
  }

  return times;
}

export function getSchedule(dateStr: string): number[] {
  const key = `azoxBox_schedule_v2_${dateStr}`;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
      }
    } catch {
      /* ignore corrupt entries */
    }
  }
  const schedule = generateDailySchedule(dateStr);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(schedule));
  }
  return schedule;
}

export function getCurrentSession(
  schedule: number[],
  secs: number,
): number | null {
  for (let i = 0; i < schedule.length; i++) {
    const start = schedule[i]!;
    if (secs >= start && secs < start + SESSION_SECONDS) return i;
  }
  return null;
}

/** How many boxes have already appeared (started) today. */
export function countAppeared(schedule: number[], secs: number): number {
  return schedule.filter((t) => t <= secs).length;
}

export function readOpened(dateStr: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`azoxBox_opened_${dateStr}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

export function readNumber(key: string): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(key));
  return Number.isFinite(n) ? n : 0;
}
