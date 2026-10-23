import { describe, expect, it } from "vitest";
import { allGamesOn, parseGameSwitches } from "./game-switches";

describe("main-tap switch", () => {
  it("is ON when missing", () => {
    expect(allGamesOn()["main-tap"]).toBe(true);
    expect(parseGameSwitches({})["main-tap"]).toBe(true);
  });
  it("is OFF only on explicit false and leaves other ids alone", () => {
    const s = parseGameSwitches({ "main-tap": false });
    expect(s["main-tap"]).toBe(false);
    expect(s.clicker).toBe(true);
    expect(s.snake).toBe(true);
    expect(parseGameSwitches({ snake: false })["main-tap"]).toBe(true);
  });
});
