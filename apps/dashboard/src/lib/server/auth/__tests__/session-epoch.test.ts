// Session invalidation on password reset (audit finding #11). Covers the pure
// staleness rule the auth handle uses, plus a round-trip through the real JWT
// mint/verify to confirm verifyToken now exposes `iat` for that check. The DB
// layer is mocked because generateToken / verifyToken are pure (no query), we
// only need to stop @glassmkr/auth's transitive import of the pg pool.

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { isSessionStale } from "../session-epoch";
import { generateToken, verifyToken } from "@glassmkr/auth";
import type { CustomerPayload } from "@glassmkr/db/types";

const customer: CustomerPayload = {
  id: "cust_1",
  email: "a@b.com",
  displayName: "Ann",
  emailVerified: true,
  status: "active",
  plan: "free",
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-session-epoch";
});

describe("isSessionStale", () => {
  it("accepts when session_epoch is null or absent (fail-safe default)", () => {
    expect(isSessionStale(1_000_000, null)).toBe(false);
    expect(isSessionStale(1_000_000, undefined)).toBe(false);
  });

  it("accepts when iat is missing (older token shape, fail-safe)", () => {
    expect(isSessionStale(undefined, new Date())).toBe(false);
    expect(isSessionStale(null, new Date())).toBe(false);
  });

  it("rejects a token minted before session_epoch", () => {
    const iat = 1_000_000;
    const epoch = new Date((iat + 60) * 1000); // reset 60s after the token was minted
    expect(isSessionStale(iat, epoch)).toBe(true);
  });

  it("accepts a token minted after session_epoch", () => {
    const iat = 1_000_000;
    const epoch = new Date((iat - 60) * 1000); // reset 60s before the token was minted
    expect(isSessionStale(iat, epoch)).toBe(false);
  });

  it("REJECTS a token minted in the same second as the epoch (round-2 #6)", () => {
    const iat = 1_000_000;
    // A token whose iat equals the epoch's second was almost certainly minted
    // before the sub-second epoch instant, so it must be treated as stale.
    expect(isSessionStale(iat, new Date(iat * 1000))).toBe(true);
    // Epoch 800ms into that same second: also stale (the captured-just-before case).
    expect(isSessionStale(iat, new Date(iat * 1000 + 800))).toBe(true);
  });
});

describe("verifyToken exposes iat for the staleness check", () => {
  it("a real minted token carries a numeric iat and drives the reset comparison", () => {
    const token = generateToken(customer);
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(typeof payload!.iat).toBe("number");

    // A reset that happened AFTER this token was minted invalidates it...
    const afterMint = new Date((payload!.iat! + 3600) * 1000);
    expect(isSessionStale(payload!.iat, afterMint)).toBe(true);
    // ...but a reset that predates the token leaves it valid.
    const beforeMint = new Date((payload!.iat! - 3600) * 1000);
    expect(isSessionStale(payload!.iat, beforeMint)).toBe(false);
  });
});
