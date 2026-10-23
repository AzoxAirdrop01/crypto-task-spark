// Cloudflare R2 (S3 API) presigned GET URLs. Server-only; uses WebCrypto (Workers + Node 18+).
// Story media lives in a PRIVATE R2 bucket; clients only ever receive short-lived signed URLs.
// R2 egress is free, so the browser downloads straight from R2 and never through this Worker.
// Never log keys or signed URLs.

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type Env = Record<string, string | undefined>;

export function readR2Config(env: Env = process.env): R2Config | null {
  const accountId = env["R2_ACCOUNT_ID"]?.trim();
  const accessKeyId = env["R2_ACCESS_KEY_ID"]?.trim();
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"]?.trim();
  const bucket = env["R2_BUCKET"]?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

// RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* unescaped).
function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Object keys are our own generated paths (YYYY-MM-DD/uuid.ext); encode each segment. */
function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

export const R2_MAX_EXPIRES_SECONDS = 7 * 24 * 3600;

export async function presignR2Get(
  cfg: R2Config,
  key: string,
  expiresSeconds = 6 * 3600,
  now: Date = new Date(),
): Promise<string> {
  if (!key || key.startsWith("/") || key.includes("..")) throw new Error("invalid key");
  const expires = Math.min(Math.max(Math.floor(expiresSeconds), 1), R2_MAX_EXPIRES_SECONDS);
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const path = `/${uriEncode(cfg.bucket)}/${encodeKey(key)}`;

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    path,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + cfg.secretAccessKey), date);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
