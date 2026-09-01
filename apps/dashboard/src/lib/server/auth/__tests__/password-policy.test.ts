// P-2 (Grok + Codex security review, 2026-09-01).

import { describe, it, expect } from "vitest";
import { validatePassword } from "../password-policy";

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePassword("short")).toMatch(/at least 8/);
    expect(validatePassword("")).toMatch(/at least 8/);
  });

  it("rejects non-strings", () => {
    expect(validatePassword(undefined)).toBeTruthy();
    expect(validatePassword(12345678 as unknown)).toBeTruthy();
  });

  it("rejects common passwords case-insensitively", () => {
    expect(validatePassword("password")).toMatch(/too common/);
    expect(validatePassword("Password")).toMatch(/too common/);
    expect(validatePassword("12345678")).toMatch(/too common/);
    expect(validatePassword("glassmkr1")).toMatch(/too common/);
  });

  it("rejects passwords over 72 bytes (bcrypt silently truncates there)", () => {
    expect(validatePassword("a".repeat(73))).toMatch(/at most 72 bytes/);
    // 37 two-byte characters = 74 bytes, though only 37 code points.
    expect(validatePassword("é".repeat(37))).toMatch(/at most 72 bytes/);
  });

  it("accepts a reasonable password", () => {
    expect(validatePassword("correct horse battery")).toBeNull();
    expect(validatePassword("Tr0ub4dour&3xtra")).toBeNull();
  });

  it("accepts exactly 72 bytes (the boundary is inclusive)", () => {
    expect(validatePassword("a".repeat(72))).toBeNull();
  });
});
