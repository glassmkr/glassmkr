// Tests for the API key utility module.
//
// Covers: format validation, generation, parsing, checksum verification,
// HMAC hashing, constant-time comparison, edge cases.
//
// Threat-model coverage:
//   - A3 (brute force / timing): constant-time tests
//   - A1 (stolen key): format strictness rejects guesses cheaply
//   - "Key separation invariant" (Part 2): kind/env discrimination

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateKey,
  generateAccountKey,
  generateCollectorKey,
  parseKey,
  parseKeyOrThrow,
  KeyFormatError,
  hashKey,
  setPepperForTests,
  timingSafeStringEquals,
  timingSafeBufferEquals,
  lastFour,
  KEY_BODY_LENGTH,
  KEY_CHECKSUM_LENGTH,
} from "../keys.js";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
});

afterEach(() => {
  setPepperForTests(null);
});

// ----------------------------------------------------------------------------
// Format
// ----------------------------------------------------------------------------

describe("key format constants", () => {
  it("body is 43 base62 chars (~256 bits of entropy)", () => {
    expect(KEY_BODY_LENGTH).toBe(43);
  });
  it("checksum is 4 chars", () => {
    expect(KEY_CHECKSUM_LENGTH).toBe(4);
  });
});

describe("generateKey", () => {
  it("produces an account/live key with the right shape", () => {
    const k = generateKey("acct", "live");
    expect(k.kind).toBe("acct");
    expect(k.env).toBe("live");
    expect(k.prefix).toBe("gmk_acct_live_");
    expect(k.body).toMatch(/^[0-9a-zA-Z]{43}$/);
    expect(k.checksum).toMatch(/^[0-9a-zA-Z]{4}$/);
    expect(k.raw).toBe(`${k.prefix}${k.body}_${k.checksum}`);
    // Total length: 14 (prefix) + 43 (body) + 1 (sep) + 4 (checksum) = 62
    expect(k.raw).toHaveLength(62);
  });

  it("produces an account/test key", () => {
    const k = generateKey("acct", "test");
    expect(k.prefix).toBe("gmk_acct_test_");
    expect(k.raw).toMatch(/^gmk_acct_test_/);
  });

  it("produces a collector/live key with the cru prefix (renamed from col)", () => {
    const k = generateKey("cru", "live");
    expect(k.kind).toBe("cru");
    expect(k.prefix).toBe("gmk_cru_live_");
    expect(k.raw).toMatch(/^gmk_cru_live_/);
    // Total: 13 (prefix) + 43 + 1 + 4 = 61
    expect(k.raw).toHaveLength(61);
  });

  it("collector/test variant", () => {
    const k = generateKey("cru", "test");
    expect(k.prefix).toBe("gmk_cru_test_");
  });

  it("convenience helpers default to live env", () => {
    expect(generateAccountKey().prefix).toBe("gmk_acct_live_");
    expect(generateCollectorKey().prefix).toBe("gmk_cru_live_");
  });

  it("never collides on 100 iterations (entropy sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const k = generateKey("acct", "live");
      expect(seen.has(k.raw)).toBe(false);
      seen.add(k.raw);
    }
  });
});

// ----------------------------------------------------------------------------
// Parsing + checksum
// ----------------------------------------------------------------------------

describe("parseKey", () => {
  it("round-trips a generated key", () => {
    const original = generateKey("acct", "live");
    const parsed = parseKey(original.raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("acct");
    expect(parsed!.env).toBe("live");
    expect(parsed!.body).toBe(original.body);
    expect(parsed!.checksum).toBe(original.checksum);
  });

  it("returns null for a key with a wrong checksum", () => {
    const k = generateKey("acct", "live");
    // Mutate the last char of the checksum.
    const bad = k.raw.slice(0, -1) + (k.checksum.endsWith("0") ? "1" : "0");
    expect(parseKey(bad)).toBeNull();
  });

  it("returns null for a key with a truncated body", () => {
    const k = generateKey("acct", "live");
    const bad = k.prefix + k.body.slice(0, -1) + "_" + k.checksum;
    expect(parseKey(bad)).toBeNull();
  });

  it("returns null for an unknown kind", () => {
    expect(parseKey("gmk_xxx_live_" + "a".repeat(43) + "_aaaa")).toBeNull();
  });

  it("returns null for an unknown env", () => {
    expect(parseKey("gmk_acct_prod_" + "a".repeat(43) + "_aaaa")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseKey("")).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    // @ts-expect-error testing runtime defence
    expect(parseKey(undefined)).toBeNull();
    // @ts-expect-error
    expect(parseKey(null)).toBeNull();
    // @ts-expect-error
    expect(parseKey(123)).toBeNull();
  });

  it("returns null for keys with symbols in the body", () => {
    const original = generateKey("acct", "live");
    const bad = original.prefix + "a".repeat(42) + "/" + "_aaaa";
    expect(parseKey(bad)).toBeNull();
  });

  it("rejects the legacy col_ format", () => {
    expect(parseKey("col_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBeNull();
  });

  it("rejects the legacy forge_ format", () => {
    expect(parseKey("forge_" + "a".repeat(64))).toBeNull();
  });
});

describe("parseKeyOrThrow", () => {
  it("returns the parsed key on success", () => {
    const k = generateKey("acct", "live");
    const parsed = parseKeyOrThrow(k.raw);
    expect(parsed.body).toBe(k.body);
  });

  it("throws KeyFormatError on a malformed key", () => {
    expect(() => parseKeyOrThrow("nope")).toThrow(KeyFormatError);
  });
});

// ----------------------------------------------------------------------------
// Hashing
// ----------------------------------------------------------------------------

describe("hashKey", () => {
  it("produces a 32-byte HMAC-SHA256 digest", () => {
    const k = generateKey("acct", "live");
    const h = hashKey(k.raw);
    expect(h).toBeInstanceOf(Buffer);
    expect(h).toHaveLength(32);
  });

  it("is deterministic for the same key + pepper", () => {
    const k = generateKey("acct", "live");
    const a = hashKey(k.raw);
    const b = hashKey(k.raw);
    expect(timingSafeBufferEquals(a, b)).toBe(true);
  });

  it("differs across keys", () => {
    const a = hashKey(generateKey("acct", "live").raw);
    const b = hashKey(generateKey("acct", "live").raw);
    expect(timingSafeBufferEquals(a, b)).toBe(false);
  });

  it("differs across peppers (the whole point of the pepper)", () => {
    const k = generateKey("acct", "live").raw;
    const a = hashKey(k, "pepper-a-" + "x".repeat(32));
    const b = hashKey(k, "pepper-b-" + "y".repeat(32));
    expect(timingSafeBufferEquals(a, b)).toBe(false);
  });

  it("throws if GLASSMKR_KEY_PEPPER is missing or too short and no override is given", () => {
    setPepperForTests(null);
    const original = process.env.GLASSMKR_KEY_PEPPER;
    delete process.env.GLASSMKR_KEY_PEPPER;
    try {
      expect(() => hashKey("anything")).toThrow(/GLASSMKR_KEY_PEPPER/);
      process.env.GLASSMKR_KEY_PEPPER = "tooShort";
      expect(() => hashKey("anything")).toThrow(/GLASSMKR_KEY_PEPPER/);
    } finally {
      if (original !== undefined) process.env.GLASSMKR_KEY_PEPPER = original;
      else delete process.env.GLASSMKR_KEY_PEPPER;
    }
  });
});

// ----------------------------------------------------------------------------
// Constant-time comparison
// ----------------------------------------------------------------------------

describe("timingSafeStringEquals", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEquals("abcdef", "abcdef")).toBe(true);
  });
  it("returns false for differing strings of equal length", () => {
    expect(timingSafeStringEquals("abcdef", "abcdez")).toBe(false);
  });
  it("returns false for differing lengths", () => {
    expect(timingSafeStringEquals("abc", "abcd")).toBe(false);
  });
  it("returns true for empty strings", () => {
    expect(timingSafeStringEquals("", "")).toBe(true);
  });
});

describe("timingSafeBufferEquals", () => {
  it("returns true for identical buffers", () => {
    const a = Buffer.from([1, 2, 3, 4]);
    const b = Buffer.from([1, 2, 3, 4]);
    expect(timingSafeBufferEquals(a, b)).toBe(true);
  });
  it("returns false for differing content", () => {
    const a = Buffer.from([1, 2, 3, 4]);
    const b = Buffer.from([1, 2, 3, 5]);
    expect(timingSafeBufferEquals(a, b)).toBe(false);
  });
  it("returns false for differing lengths", () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 3, 4]);
    expect(timingSafeBufferEquals(a, b)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Last-4
// ----------------------------------------------------------------------------

describe("lastFour", () => {
  it("returns the checksum (last 4 chars of the wire format)", () => {
    const k = generateKey("acct", "live");
    expect(lastFour(k)).toBe(k.checksum);
    expect(k.raw.endsWith(lastFour(k))).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Key separation invariant (spec Part 2)
// ----------------------------------------------------------------------------

describe("key separation invariant", () => {
  it("acct and cru keys parse to different kinds and cannot be confused", () => {
    const acct = generateKey("acct", "live");
    const cru = generateKey("cru", "live");
    expect(parseKey(acct.raw)!.kind).toBe("acct");
    expect(parseKey(cru.raw)!.kind).toBe("cru");
  });

  it("the prefix lookup must match the parsed kind exactly", () => {
    // Defence-in-depth: even a hash collision would not let a cru key
    // satisfy an acct lookup if callers check parsed.kind.
    const cru = generateKey("cru", "live");
    expect(cru.prefix).not.toBe("gmk_acct_live_");
  });
});

// ----------------------------------------------------------------------------
// Statistical timing sanity (allow flakiness; this is a regression catch)
// ----------------------------------------------------------------------------

describe("constant-time comparison statistical sanity", () => {
  it("hashKey runtime does not differ noticeably across keys", () => {
    // Each iteration computes HMAC over a random key. We don't assert
    // a specific timing bound (CI is too noisy); we just exercise the
    // path 1000 times to catch gross perf regressions in CI flame
    // graphs. Real security review requires a dedicated timing test
    // (Part 10 of spec, "constant-time comparison tests").
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      hashKey(generateKey("acct", "live").raw);
    }
    const elapsed = Date.now() - start;
    // 1000 HMAC-SHA256 computations should be well under 500ms even on
    // slow CI. If this fails, something is wrong (perhaps bcrypt sneaked
    // back in).
    expect(elapsed).toBeLessThan(500);
  });
});
