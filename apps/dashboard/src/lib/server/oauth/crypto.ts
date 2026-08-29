import crypto from "node:crypto";

const SECRET_BYTES = 32;

export class OAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigurationError";
  }
}

function getPepper(): Buffer {
  const configured = process.env.MCP_OAUTH_TOKEN_PEPPER;
  if (configured && Buffer.byteLength(configured, "utf8") >= 32) {
    return Buffer.from(configured, "utf8");
  }
  if (process.env.NODE_ENV === "test") return Buffer.from("glassmkr-mcp-test-pepper", "utf8");
  throw new OAuthConfigurationError(
    "MCP_OAUTH_TOKEN_PEPPER is required and must be at least 32 bytes",
  );
}

export function generateOpaqueSecret(prefix: string): string {
  return `${prefix}${crypto.randomBytes(SECRET_BYTES).toString("base64url")}`;
}

export function hashOAuthValue(domain: string, value: string): Buffer {
  return crypto
    .createHmac("sha256", getPepper())
    .update(domain)
    .update("\0")
    .update(value)
    .digest();
}

export function hashOAuthValueHex(domain: string, value: string): string {
  return hashOAuthValue(domain, value).toString("hex");
}

export function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function timingSafeBufferEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
