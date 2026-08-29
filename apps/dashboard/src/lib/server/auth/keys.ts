// Dashboard API key utilities.
//
// Two key types live here:
//   - Account API keys (gmk_acct_<env>_*): used by humans and automation
//     acting on behalf of an account. Authenticate against the management
//     API surface (POST /api/v1/servers, etc).
//   - Collector keys     (gmk_cru_<env>_*): used by the Crucible agent
//     for telemetry ingestion. Scoped to one server only.
//
// Both share the same wire format and the same storage hashing, but they
// are NOT interchangeable: the auth middleware (PR #2) refuses a collector
// key on a management endpoint, and refuses an account key on the ingest
// endpoint, before any DB lookup. This is the key-separation invariant
// (spec Part 2).
//
// Format (Stripe-style):
//   gmk_acct_live_<43-char-base62>_<4-char-checksum>     50 chars total
//   gmk_acct_test_<43-char-base62>_<4-char-checksum>
//   gmk_cru_live_<43-char-base62>_<4-char-checksum>      49 chars total
//   gmk_cru_test_<43-char-base62>_<4-char-checksum>
//
// Why this format:
//   - Visible prefix: support engineers reading a log can tell at a glance
//     whether they're looking at a leaked account key vs a collector key,
//     live vs test.
//   - 32 bytes of CSPRNG entropy = 256 bits, well past brute-force range.
//   - Base62 alphabet (0-9 a-z A-Z): URL-safe, no symbols, no encoding
//     friction. 32 bytes ≈ 43 base62 chars.
//   - 4-char checksum: lets the API reject malformed keys at the edge
//     without a DB lookup. Cheap rejection for attackers, cheap auth
//     for valid keys. Implementation: CRC32 of (prefix + body), base62
//     and zero-padded to 4 chars.
//   - GitHub secret scanning: register `gmk_acct_live_` and
//     `gmk_cru_live_` as Glassmkr's prefixes so a key committed to a
//     public repo gets auto-revoked. Out of scope for v1; the format is
//     ready for it.
//
// Storage:
//   - Plaintext keys are NEVER stored. Hash is HMAC-SHA256(pepper, key).
//     Server-side pepper lives in env var GLASSMKR_KEY_PEPPER, NOT the DB.
//     An attacker who exfiltrates only the database cannot brute-force
//     because they lack the pepper.
//   - HMAC-SHA256 over bcrypt/argon2: API keys are 256-bit high-entropy.
//     The slow-by-design property of bcrypt buys nothing (brute force is
//     infeasible regardless of hash speed) while costing ~10ms per auth.
//     HMAC is ~1us per auth and supports constant-time compare via
//     timingSafeEqual.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/** Which authentication tier the key authorises. */
export type KeyKind = "acct" | "cru";

/** Live keys hit prod data; test keys may someday hit a sandbox. */
export type KeyEnv = "live" | "test";

export interface ParsedKey {
  kind: KeyKind;
  env: KeyEnv;
  /** Everything before the body, i.e. "gmk_acct_live_". Useful for the
   *  defence-in-depth prefix check after the HMAC lookup. */
  prefix: string;
  /** The 43-char random body. */
  body: string;
  /** The 4-char checksum (already verified against body if returned by parseKey). */
  checksum: string;
  /** The full original key string. Useful for callers that want to hash it. */
  raw: string;
}

export class KeyFormatError extends Error {
  constructor(public reason: string) {
    super(`Invalid key format: ${reason}`);
    this.name = "KeyFormatError";
  }
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PREFIX_PATTERN = /^gmk_(acct|cru)_(live|test)_$/;

/** Length of the base62-encoded random body. Chosen so 32 random bytes
 *  fit deterministically: ceil(256 / log2(62)) = 43. */
export const KEY_BODY_LENGTH = 43;

/** Length of the base62-encoded CRC32 checksum, zero-padded. */
export const KEY_CHECKSUM_LENGTH = 4;

/** Number of CSPRNG bytes per key. 256 bits is comfortably past brute-force. */
const KEY_ENTROPY_BYTES = 32;

const BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ----------------------------------------------------------------------------
// Base62 encoding
// ----------------------------------------------------------------------------

/**
 * Encode a non-negative bigint into base62. Result has no leading zeros;
 * use {@link base62EncodeFixed} if you need a fixed-width string.
 */
function base62Encode(value: bigint): string {
  if (value < 0n) throw new Error("base62Encode: negative value");
  if (value === 0n) return "0";
  let n = value;
  let out = "";
  while (n > 0n) {
    out = BASE62_ALPHABET[Number(n % 62n)] + out;
    n = n / 62n;
  }
  return out;
}

/**
 * Encode a non-negative bigint as base62 with a fixed output length, zero-padded.
 * Throws if the value doesn't fit.
 */
function base62EncodeFixed(value: bigint, width: number): string {
  const encoded = base62Encode(value);
  if (encoded.length > width) {
    throw new Error(`base62EncodeFixed: value too large for width ${width}`);
  }
  return encoded.padStart(width, "0");
}

/** Convert a Buffer to a single bigint, big-endian. */
function bufferToBigInt(buf: Buffer): bigint {
  let n = 0n;
  for (const b of buf) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

// ----------------------------------------------------------------------------
// CRC32 (IEEE 802.3 polynomial)
// ----------------------------------------------------------------------------
// Used purely for the 4-char checksum on keys. Not cryptographic; an
// attacker can compute valid checksums for guessed keys. The checksum's
// only job is to reject typos and obviously malformed keys at the edge
// without a DB lookup.

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(input: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = CRC32_TABLE[(crc ^ input.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ----------------------------------------------------------------------------
// Generation
// ----------------------------------------------------------------------------

/** Generate a 43-char base62 random body from CSPRNG. */
function generateBody(): string {
  const bytes = randomBytes(KEY_ENTROPY_BYTES);
  return base62EncodeFixed(bufferToBigInt(bytes), KEY_BODY_LENGTH);
}

/** Compute the 4-char checksum for a (prefix, body) pair.
 *  CRC32 fits in up to ~6 base62 chars; we deterministically take the
 *  last 4 of the zero-padded representation. The choice of last-4 vs
 *  first-4 is arbitrary but must match the verification side; we keep
 *  it consistent here. */
function computeChecksum(prefix: string, body: string): string {
  const c = crc32(prefix + body);
  const encoded = base62Encode(BigInt(c)).padStart(KEY_CHECKSUM_LENGTH, "0");
  return encoded.slice(-KEY_CHECKSUM_LENGTH);
}

function buildPrefix(kind: KeyKind, env: KeyEnv): string {
  return `gmk_${kind}_${env}_`;
}

/**
 * Generate a fresh API key. Returns the plaintext to be shown to the
 * caller exactly once; storage is via {@link hashKey}.
 *
 * @example
 *   const key = generateKey("acct", "live");
 *   // key.raw = "gmk_acct_live_<43 chars>_<4 chars>"
 */
export function generateKey(kind: KeyKind, env: KeyEnv): ParsedKey {
  const prefix = buildPrefix(kind, env);
  const body = generateBody();
  const checksum = computeChecksum(prefix, body);
  const raw = `${prefix}${body}_${checksum}`;
  return { kind, env, prefix, body, checksum, raw };
}

/** Convenience: generate an account API key. */
export function generateAccountKey(env: KeyEnv = "live"): ParsedKey {
  return generateKey("acct", env);
}

/** Convenience: generate a collector key. */
export function generateCollectorKey(env: KeyEnv = "live"): ParsedKey {
  return generateKey("cru", env);
}

// ----------------------------------------------------------------------------
// Parsing + verification
// ----------------------------------------------------------------------------

/**
 * Strict format regex matched at the auth-middleware edge. Rejects any
 * string that doesn't have the right shape, before we waste cycles
 * computing HMAC or hitting the DB.
 *
 *   gmk_acct_live_<43 base62>_<4 base62>
 *   gmk_acct_test_<43 base62>_<4 base62>
 *   gmk_cru_live_<43 base62>_<4 base62>
 *   gmk_cru_test_<43 base62>_<4 base62>
 */
const KEY_REGEX = new RegExp(
  `^(gmk_(acct|cru)_(live|test)_)([0-9a-zA-Z]{${KEY_BODY_LENGTH}})_([0-9a-zA-Z]{${KEY_CHECKSUM_LENGTH}})$`,
);

/**
 * Parse and structurally validate a key string. Returns null for any
 * malformed input. Use {@link parseKeyOrThrow} when you want a typed
 * exception for the failure reason.
 *
 * Format and checksum are verified. Whether the key actually exists in
 * the DB is a separate lookup.
 */
export function parseKey(raw: string): ParsedKey | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const m = KEY_REGEX.exec(raw);
  if (!m) return null;
  const [, prefix, kindStr, envStr, body, checksum] = m;
  const expected = computeChecksum(prefix, body);
  if (!timingSafeStringEquals(checksum, expected)) return null;
  return {
    kind: kindStr as KeyKind,
    env: envStr as KeyEnv,
    prefix,
    body,
    checksum,
    raw,
  };
}

/** Variant of {@link parseKey} that throws {@link KeyFormatError}. */
export function parseKeyOrThrow(raw: string): ParsedKey {
  const parsed = parseKey(raw);
  if (parsed === null) {
    // Deliberately vague reason; the caller should not echo it back to
    // the client. Logged at debug level only.
    throw new KeyFormatError("does not match expected pattern or checksum failed");
  }
  return parsed;
}

// ----------------------------------------------------------------------------
// Hashing for storage and lookup
// ----------------------------------------------------------------------------

/**
 * Compute the storage hash of a plaintext key. Same function used at
 * creation time (to write the row) and at auth time (to look the row up).
 *
 * The pepper is read from the GLASSMKR_KEY_PEPPER env var. Tests should set
 * it to a fixed value via setPepperForTests().
 *
 * @returns 32-byte HMAC-SHA256 digest
 */
export function hashKey(plaintextKey: string, pepper?: string): Buffer {
  const p = pepper ?? getPepper();
  return createHmac("sha256", p).update(plaintextKey).digest();
}

let cachedPepper: string | null = null;

function getPepper(): string {
  if (cachedPepper !== null) return cachedPepper;
  const p = process.env.GLASSMKR_KEY_PEPPER;
  if (!p || p.length < 32) {
    throw new Error(
      "GLASSMKR_KEY_PEPPER env var is missing or too short (need >= 32 chars). " +
      "Set a 32+ char random string in the systemd unit's EnvironmentFile. " +
      "See docs/runbooks/key-pepper-rotation.md.",
    );
  }
  cachedPepper = p;
  return p;
}

/**
 * Test-only: override the pepper. Reset by passing null.
 * @internal
 */
export function setPepperForTests(pepper: string | null): void {
  cachedPepper = pepper;
}

// ----------------------------------------------------------------------------
// Constant-time comparison
// ----------------------------------------------------------------------------

/**
 * Constant-time equality on two strings. Returns false if the strings
 * differ in length OR content; an attacker can still distinguish the
 * length cases by the boolean result, but not by timing.
 *
 * Use this anywhere a secret-bearing string is compared to user input.
 */
export function timingSafeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still call timingSafeEqual on padded buffers to flatten the timing
    // signal at this caller site. The early-return above is recoverable
    // length information, which is acceptable for our threat model
    // (key lengths are public).
    const sentinel = Buffer.alloc(1, 0);
    timingSafeEqual(sentinel, sentinel);
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Constant-time equality on two Buffers. Returns false if lengths differ.
 * Used for HMAC digest comparison.
 */
export function timingSafeBufferEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    const sentinel = Buffer.alloc(1, 0);
    timingSafeEqual(sentinel, sentinel);
    return false;
  }
  return timingSafeEqual(a, b);
}

// ----------------------------------------------------------------------------
// Last-4 helper for UI
// ----------------------------------------------------------------------------

/** Extract the last 4 chars of a parsed key for UI display ("...a1b2"). */
export function lastFour(parsed: ParsedKey): string {
  // The checksum is the last 4 chars of the wire format. Use it directly
  // so UIs and audit logs can correlate against keys whose plaintext is
  // long gone.
  return parsed.checksum;
}
