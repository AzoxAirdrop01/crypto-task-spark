import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), req: vi.fn() }));
vi.mock("@/integrations/external-supabase/admin.server", () => ({
  getExternalSupabaseAdmin: () => ({ rpc: m.rpc }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: m.req }));
import { captureGpsGeo, captureIpGeo } from "./geo-capture.server";
const reqWith = (cf?: Record<string, unknown>, headers: Record<string, string> = {}) => ({
  cf,
  headers: new Headers(headers),
});
describe("geo capture", () => {
  beforeEach(() => {
    m.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    m.req.mockReset();
  });
  it("writes cf data with zones", async () => {
    m.req.mockReturnValue(reqWith({ country: "IQ", region: "Erbil", city: "Erbil", latitude: "36.19", longitude: "44.01" }));
    await captureIpGeo(5);
    expect(m.rpc).toHaveBeenCalledWith("upsert_user_geo", {
      p_telegram_id: 5, p_country: "IQ", p_region: "Erbil", p_city: "Erbil",
      p_lat: 36.19, p_lon: 44.01, p_source: "ip",
      p_zones: ["k6_greater", "k1_kurdistan_region", "k2_bashur"],
    });
  });
  it("falls back to cf-ipcountry", async () => {
    m.req.mockReturnValue(reqWith(undefined, { "cf-ipcountry": "tr" }));
    await captureIpGeo(5);
    expect(m.rpc.mock.calls[0]![1]).toMatchObject({ p_country: "TR", p_lat: null, p_lon: null, p_zones: [] });
  });
  it.each(["XX", "T1", "ABC"])("ignores country %s", async (c) => {
    m.req.mockReturnValue(reqWith({ country: c, latitude: "x" }));
    await captureIpGeo(5);
    expect(m.rpc.mock.calls[0]![1]).toMatchObject({ p_country: null, p_lat: null });
  });
  it("never throws on RPC error, rejection, or missing request", async () => {
    m.req.mockReturnValue(reqWith({ country: "IQ" }));
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(captureIpGeo(5)).resolves.toBeUndefined();
    m.rpc.mockRejectedValueOnce(new Error("boom"));
    await expect(captureIpGeo(5)).resolves.toBeUndefined();
    m.req.mockImplementation(() => { throw new Error("no req"); });
    await expect(captureIpGeo(5)).resolves.toBeUndefined();
  });
  it("times out after 1500ms", async () => {
    vi.useFakeTimers();
    m.req.mockReturnValue(reqWith({ country: "IQ" }));
    m.rpc.mockReturnValue(new Promise(() => {}));
    const p = captureIpGeo(5);
    await vi.advanceTimersByTimeAsync(1600);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
  it("GPS capture passes lat/lon/zones", async () => {
    m.req.mockReturnValue(reqWith({ country: "TR", latitude: "1", longitude: "1" }));
    await captureGpsGeo(9, 37.91, 40.22);
    expect(m.rpc).toHaveBeenCalledWith("upsert_user_geo", {
      p_telegram_id: 9, p_country: "TR", p_region: null, p_city: null,
      p_lat: 37.91, p_lon: 40.22, p_source: "gps", p_zones: ["k6_greater", "k3_bakur"],
    });
  });
});
