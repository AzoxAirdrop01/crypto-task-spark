// Pure data: rank thresholds. Safe to import from server code.
export type RankKey = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Epic" | "Legendary";

export type Rank = {
  key: RankKey;
  threshold: number;
  pointsPerFinger: number;
  color: string;
};

export const RANKS: Rank[] = [
  { key: "Bronze", threshold: 0, pointsPerFinger: 1, color: "#b87333" },
  { key: "Silver", threshold: 250_000, pointsPerFinger: 2, color: "#c0c7d0" },
  { key: "Gold", threshold: 700_000, pointsPerFinger: 3, color: "#f5c542" },
  { key: "Platinum", threshold: 1_300_000, pointsPerFinger: 4, color: "#7fd1e0" },
  { key: "Diamond", threshold: 2_500_000, pointsPerFinger: 5, color: "#67e8f9" },
  { key: "Epic", threshold: 7_000_000, pointsPerFinger: 6, color: "#7c3aed" },
  {
    key: "Legendary",
    threshold: 25_000_000,
    pointsPerFinger: 7,
    color: "#f5c542",
  },
];

export function rankForPoints(points: number): Rank {
  let current: Rank = RANKS[0]!;
  for (const r of RANKS) {
    if (points >= r.threshold) current = r;
  }
  return current;
}

export function nextRank(points: number): Rank | null {
  const sorted = [...RANKS].sort((a, b) => a.threshold - b.threshold);
  for (const r of sorted) {
    if (points < r.threshold) return r;
  }
  return null;
}
