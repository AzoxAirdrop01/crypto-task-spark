import { describe, expect, it } from "vitest";
import { parseGamingFace } from "./gaming-face";

describe("Gaming face parser", () => {
  it.each([2, "2"])("selects Face 2 for %s", (raw) => {
    expect(parseGamingFace(raw)).toBe(2);
  });
  it.each([1, null, undefined, 3, "x", new Error("down")])("defaults %s to Face 1", (raw) => {
    expect(parseGamingFace(raw)).toBe(1);
  });
});