/** Pure (client-safe) game switch ids. A missing id in the DB means ON. */
export const GAME_SWITCH_IDS = [
  "shoot",
  "video-ads",
  "snake",
  "tak-bom",
  "question-day",
  "box",
  "global-button",
  "clicker",
  "main-tap",
] as const;

export type GameId = (typeof GAME_SWITCH_IDS)[number];
export type GameSwitches = Record<GameId, boolean>;

export const GAME_DISABLED = "game_disabled" as const;

export function allGamesOn(): GameSwitches {
  return Object.fromEntries(GAME_SWITCH_IDS.map((id) => [id, true])) as GameSwitches;
}

/** Merges a raw RPC object; only explicit `false` turns a game OFF. */
export function parseGameSwitches(raw: unknown): GameSwitches {
  const out = allGamesOn();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const id of GAME_SWITCH_IDS) {
      if ((raw as Record<string, unknown>)[id] === false) out[id] = false;
    }
  }
  return out;
}

const ALIASES: Record<string, GameId> = {
  "clicker-frenzy": "clicker",
  takbom: "tak-bom",
  word: "video-ads",
  question: "question-day",
};

/** Normalizes card ids / score ids / daily-batch ids to switch ids. */
export function toSwitchId(value: string): GameId | null {
  if ((GAME_SWITCH_IDS as readonly string[]).includes(value)) return value as GameId;
  return ALIASES[value] ?? null;
}
