/** Pure, client-safe parser for the admin-selected Gaming face. */
export type GamingFace = 1 | 2;

export function parseGamingFace(raw: unknown): GamingFace {
  return raw === 2 || raw === "2" ? 2 : 1;
}