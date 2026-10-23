// Pure geo zone helpers (lon, lat). No server imports.
export const K6_GREATER: [number, number][] = [[35.653,36.354],[35.451,37.117],[35.445,37.256],[36.036,39.392],[36.141,39.572],[36.922,40.342],[37.195,40.441],[38.629,40.633],[40.025,41.1],[41.407,41.726],[41.596,41.75],[42.804,41.75],[43.095,41.692],[43.237,41.607],[43.959,40.886],[45.298,39.734],[45.364,39.612],[45.843,38.14],[46.126,37.567],[47.168,37.296],[48.358,36.646],[49.561,35.445],[49.647,35.23],[49.725,34.213],[50.361,33.733],[50.481,33.599],[50.786,32.243],[52.334,31.144],[52.482,30.969],[52.52,30.799],[52.514,29.799],[52.491,29.666],[52.423,29.545],[51.62,28.55],[51.443,28.469],[51.294,28.451],[51.011,28.53],[49.958,29.462],[49.047,30.07],[48.014,30.896],[47.393,31.889],[45.63,32.874],[45.512,33.013],[44.977,33.987],[43.626,34.671],[42.658,35.796],[41.817,35.65],[41.605,35.678],[40.737,35.94],[38.996,35.751],[37.604,35.752],[36.252,35.854],[36.054,35.9],[35.89,36.0],[35.653,36.354]];

export const K1_REGION: [number, number][] = [[42.35,37.10],[43.20,37.35],[44.20,37.30],[44.80,37.15],[45.15,36.60],[45.55,35.95],[46.10,35.55],[46.20,35.15],[45.65,34.85],[45.20,35.05],[44.70,35.40],[44.35,35.85],[43.70,35.95],[43.45,36.35],[43.15,36.65],[42.70,36.75],[42.35,36.95]];

export function pointInPolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const COUNTRY_ZONE: Record<string, string> = {
  IQ: "k2_bashur",
  TR: "k3_bakur",
  IR: "k4_rojhelat",
  SY: "k5_rojava",
};

export function zonesFor(input: {
  lat: number | null;
  lon: number | null;
  country: string | null;
}): string[] {
  const { lat, lon } = input;
  if (typeof lat !== "number" || typeof lon !== "number") return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  const zones: string[] = [];
  const inK6 = pointInPolygon(lon, lat, K6_GREATER);
  if (inK6) zones.push("k6_greater");
  if (pointInPolygon(lon, lat, K1_REGION)) zones.push("k1_kurdistan_region");
  const sub = inK6 && input.country ? COUNTRY_ZONE[input.country.toUpperCase()] : undefined;
  if (sub) zones.push(sub);
  return zones;
}
