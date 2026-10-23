import { describe, expect, it } from "vitest";
import { K1_REGION, K6_GREATER, pointInPolygon, zonesFor } from "./geo-zones";
const both: [string, number, number][] = [["Erbil",44.01,36.19],["Duhok",42.95,36.87],["Sulaymaniyah",45.43,35.56],["Halabja",45.99,35.18],["Zakho",42.68,37.14]];
const k6only: [string, number, number][] = [["Kirkuk",44.39,35.47],["Mosul",43.13,36.34],["Diyarbakir",40.22,37.91],["Van",43.38,38.5],["Kermanshah",47.06,34.31],["Urmia",45.07,37.55],["Qamishli",41.22,37.05],["Ahvaz",48.67,31.32],["Sivas",37.02,39.75],["Raqqa",39.01,35.95],["Aleppo",37.16,36.2]];
const none: [string, number, number][] = [["Baghdad",44.37,33.31],["Basra",47.78,30.51],["Ankara",32.86,39.93],["Istanbul",28.98,41.01],["Tehran",51.39,35.69],["Tabriz",46.29,38.08],["Berlin",13.4,52.5]];
describe("geo zones", () => {
  it.each(both)("%s is in K1 and K6", (_, lon, lat) => {
    expect(pointInPolygon(lon, lat, K1_REGION)).toBe(true);
    expect(pointInPolygon(lon, lat, K6_GREATER)).toBe(true);
  });
  it.each(k6only)("%s is in K6 only", (_, lon, lat) => {
    expect(pointInPolygon(lon, lat, K6_GREATER)).toBe(true);
    expect(pointInPolygon(lon, lat, K1_REGION)).toBe(false);
  });
  it.each(none)("%s is in neither", (_, lon, lat) => {
    expect(zonesFor({ lat, lon, country: null })).toEqual([]);
  });
  it("country sub-zones", () => {
    expect(zonesFor({ lon: 40.22, lat: 37.91, country: "TR" })).toEqual(["k6_greater", "k3_bakur"]);
    expect(zonesFor({ lon: 47.06, lat: 34.31, country: "IR" })).toContain("k4_rojhelat");
    expect(zonesFor({ lon: 41.22, lat: 37.05, country: "SY" })).toContain("k5_rojava");
    expect(zonesFor({ lon: 44.39, lat: 35.47, country: "IQ" })).toContain("k2_bashur");
    expect(zonesFor({ lon: 44.39, lat: 35.47, country: null })).toEqual(["k6_greater"]);
    expect(zonesFor({ lon: 44.01, lat: 36.19, country: "IQ" })).toEqual(["k6_greater", "k1_kurdistan_region", "k2_bashur"]);
    expect(zonesFor({ lon: 44.37, lat: 33.31, country: "IQ" })).toEqual([]);
  });
  it("null/invalid coordinates", () => {
    expect(zonesFor({ lat: null, lon: 44, country: "IQ" })).toEqual([]);
    expect(zonesFor({ lat: NaN, lon: 44, country: "IQ" })).toEqual([]);
  });
});
