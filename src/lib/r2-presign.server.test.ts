import { describe, expect, it } from "vitest";
import { presignR2Get, readR2Config } from "./r2-presign.server";

const cfg = {
  accountId: "abc123def456",
  accessKeyId: "AKIAEXAMPLE0000",
  secretAccessKey: "secretKey+/ExampleSecret0123456789abcdef",
  bucket: "azox-stories",
};
const key = "2026-10-23/3f2a1c9e-1111-4222-8333-444455556666.mp4";
const now = new Date("2026-10-23T19:30:15.123Z");

describe("R2 presigned story media", () => {
  it("matches the reference SigV4 known answer exactly", async () => {
    expect(await presignR2Get(cfg, key, 21600, now)).toBe(
      "https://abc123def456.r2.cloudflarestorage.com/azox-stories/2026-10-23/3f2a1c9e-1111-4222-8333-444455556666.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE0000%2F20261023%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261023T193015Z&X-Amz-Expires=21600&X-Amz-SignedHeaders=host&X-Amz-Signature=5dc8eef2e4687ec180e1ca652e138dd01f453eab8ebdb28086f88d54299ad851",
    );
  });
  it.each(["", "/x", "a/../b"])("rejects unsafe key %s", async (invalid) => {
    await expect(presignR2Get(cfg, invalid)).rejects.toThrow("invalid key");
  });
  it.each([[0, "1"], [-10, "1"], [604801, "604800"], [Infinity, "604800"], [1.9, "1"]])(
    "clamps expiry %s to %s", async (input, expected) => {
      const url = new URL(await presignR2Get(cfg, key, Number(input), now));
      expect(url.searchParams.get("X-Amz-Expires")).toBe(expected);
    },
  );
  it("requires all four configuration values and trims whitespace", () => {
    const env = {
      R2_ACCOUNT_ID: " abc123def456 ", R2_ACCESS_KEY_ID: " AKIAEXAMPLE0000 ",
      R2_SECRET_ACCESS_KEY: " secretKey+/ExampleSecret0123456789abcdef ",
      R2_BUCKET: " azox-stories ",
    };
    expect(readR2Config(env)).toEqual(cfg);
    expect(readR2Config({})).toBeNull();
    for (const name of Object.keys(env)) {
      for (const value of [undefined, "", "   "]) {
        expect(readR2Config({ ...env, [name]: value })).toBeNull();
      }
    }
  });
});