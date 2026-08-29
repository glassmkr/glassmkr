// Hardened ingest parse tests (security audit 2026-05-22 §1.3 / catalog
// T-402 prototype pollution, T-403 ReDoS, T-205 parser exhaustion).
//
// safeJsonParse is the enforced JSON boundary on the ingest endpoint
// (independent of the log-mode Zod schema): it rejects prototype-
// pollution keys and oversize string fields before any parsing/storage.

import { describe, it, expect } from "vitest";
import {
  safeJsonParse,
  IngestRejectError,
  MAX_STRING_FIELD_BYTES,
} from "../snapshot-schema";

describe("safeJsonParse (ingest hardening)", () => {
  it("parses a normal snapshot payload unchanged", () => {
    const obj = { system: { hostname: "web-01", ip: "10.0.0.1" }, cpu: { load_1m: 0.4 } };
    expect(safeJsonParse(JSON.stringify(obj))).toEqual(obj);
  });

  it("rejects a __proto__ key (T-402)", () => {
    const payload = '{"system":{"hostname":"x"},"__proto__":{"isAdmin":true}}';
    expect(() => safeJsonParse(payload)).toThrow(IngestRejectError);
    try {
      safeJsonParse(payload);
    } catch (e) {
      expect((e as IngestRejectError).reason).toBe("prototype_pollution");
    }
  });

  it("rejects a constructor key (T-402)", () => {
    expect(() => safeJsonParse('{"constructor":{"x":1}}')).toThrow(IngestRejectError);
  });

  it("rejects a prototype key (T-402)", () => {
    expect(() => safeJsonParse('{"a":{"prototype":1}}')).toThrow(IngestRejectError);
  });

  it("does NOT pollute Object.prototype even on a crafted payload", () => {
    try {
      safeJsonParse('{"__proto__":{"polluted":true}}');
    } catch { /* expected reject */ }
    // @ts-expect-error probing for pollution
    expect(({}).polluted).toBeUndefined();
  });

  it("rejects an oversize string field (T-403 / T-205)", () => {
    const big = "A".repeat(MAX_STRING_FIELD_BYTES + 1);
    const payload = JSON.stringify({ system: { hostname: big } });
    expect(() => safeJsonParse(payload)).toThrow(IngestRejectError);
    try {
      safeJsonParse(payload);
    } catch (e) {
      expect((e as IngestRejectError).reason).toBe("oversize_field");
    }
  });

  it("accepts a string field at exactly the cap", () => {
    const atCap = "A".repeat(MAX_STRING_FIELD_BYTES);
    const payload = JSON.stringify({ system: { hostname: atCap } });
    expect(() => safeJsonParse(payload)).not.toThrow();
  });

  it("throws a SyntaxError (not IngestRejectError) on malformed JSON", () => {
    expect(() => safeJsonParse("{not json")).toThrow();
    expect(() => safeJsonParse("{not json")).not.toThrow(IngestRejectError);
  });

  it("oversize check applies to nested + array string values too", () => {
    const big = "A".repeat(MAX_STRING_FIELD_BYTES + 1);
    expect(() => safeJsonParse(JSON.stringify({ a: { b: [big] } }))).toThrow(IngestRejectError);
  });
});
