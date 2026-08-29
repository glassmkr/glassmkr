// Regression tests for the P1.3 cache revalidation contract:
// rotated/revoked keys must NOT continue to authenticate via the
// in-memory key cache. The cache only saves the HMAC compute / bcrypt
// scan; it does not bypass the revoked/active gate.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("bcrypt", () => ({
  default: { compare: vi.fn(async () => true) },
}));

import { query } from "@glassmkr/db/pg";
import {
  authenticateCollector,
  clearCollectorAuthCacheForTests,
  peekCollectorAuthCacheForTests,
} from "../ingest-auth";
import { setPepperForTests, generateCollectorKey } from "../keys";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
  clearCollectorAuthCacheForTests();
  (query as any).mockReset();
});

describe("authenticateCollector cache revalidation (gmk path)", () => {
  it("populates cache on first lookup, then requires revalidation on subsequent hits", async () => {
    const cru = generateCollectorKey("live");
    // First call: full gmk lookup hits, auth succeeds, cache populated.
    (query as any)
      .mockResolvedValueOnce({
        rows: [{
          key_id: "k1", server_id: "srv_1", prefix: cru.prefix,
          expires_at: null, revoked_at: null,
          customer_id: "cust_1", status: "active",
        }],
      })
      // last_used_at update (fire-and-forget, but mocked to resolve)
      .mockResolvedValueOnce({ rows: [] });

    const first = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(first).toEqual({ id: "srv_1", customerId: "cust_1" });
    expect(peekCollectorAuthCacheForTests().size).toBe(1);

    // Second call: cache hit; should issue a revalidation SELECT (1 query),
    // then return without re-running the HMAC lookup or last_used_at update.
    (query as any).mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const calls0 = (query as any).mock.calls.length;
    const second = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(second).toEqual({ id: "srv_1", customerId: "cust_1" });
    const calls1 = (query as any).mock.calls.length;
    expect(calls1 - calls0).toBe(1);
    const revalSql = String((query as any).mock.calls[calls1 - 1][0]);
    expect(revalSql).toMatch(/account_api_keys/);
    expect(revalSql).toMatch(/revoked_at IS NULL/);
  });

  it("rejects cached principal when row is now revoked", async () => {
    const cru = generateCollectorKey("live");
    // Seed the cache via a valid lookup.
    (query as any)
      .mockResolvedValueOnce({
        rows: [{
          key_id: "k1", server_id: "srv_1", prefix: cru.prefix,
          expires_at: null, revoked_at: null,
          customer_id: "cust_1", status: "active",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await authenticateCollector(`Bearer ${cru.raw}`);
    expect(peekCollectorAuthCacheForTests().size).toBe(1);

    // Now: revalidation returns no row (row was revoked). Then the
    // fall-through full lookup also misses (key_hash now unknown to the
    // DB after rotation cleared its row). Should return null.
    (query as any)
      .mockResolvedValueOnce({ rows: [] }) // revalidation: no live row
      .mockResolvedValueOnce({ rows: [] }); // full gmk lookup: also miss
    const second = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(second).toBeNull();
    // Cache evicted on stale revalidation.
    expect(peekCollectorAuthCacheForTests().size).toBe(0);
  });

  it("rejects cached principal when server status flips to non-active", async () => {
    const cru = generateCollectorKey("live");
    (query as any)
      .mockResolvedValueOnce({
        rows: [{
          key_id: "k1", server_id: "srv_1", prefix: cru.prefix,
          expires_at: null, revoked_at: null,
          customer_id: "cust_1", status: "active",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await authenticateCollector(`Bearer ${cru.raw}`);

    // status='suspended': revalidation returns no row.
    (query as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const second = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(second).toBeNull();
  });
});

describe("authenticateCollector cache revalidation (legacy col_* path)", () => {
  it("revalidation checks api_key_hash IS NOT NULL on cache hit", async () => {
    const legacyKey = "col_" + "a".repeat(32);
    // First call: legacy bcrypt path. The handler does a SELECT then
    // bcrypt.compare; bcrypt is mocked to always match.
    (query as any).mockResolvedValueOnce({
      rows: [{ id: "srv_1", customer_id: "cust_1", api_key_hash: "$$$bcrypt$$$" }],
    });
    const first = await authenticateCollector(`Bearer ${legacyKey}`);
    expect(first).toEqual({ id: "srv_1", customerId: "cust_1" });

    // Second call: cache hit. Revalidation SELECT against servers.
    (query as any).mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const callsBefore = (query as any).mock.calls.length;
    const second = await authenticateCollector(`Bearer ${legacyKey}`);
    expect(second).toEqual({ id: "srv_1", customerId: "cust_1" });
    const revalSql = String((query as any).mock.calls[callsBefore][0]);
    expect(revalSql).toMatch(/FROM servers/);
    expect(revalSql).toMatch(/api_key_hash IS NOT NULL/);
  });

  it("rejects cached legacy principal once api_key_hash is cleared by cutover", async () => {
    const legacyKey = "col_" + "a".repeat(32);
    (query as any).mockResolvedValueOnce({
      rows: [{ id: "srv_1", customer_id: "cust_1", api_key_hash: "$$$bcrypt$$$" }],
    });
    await authenticateCollector(`Bearer ${legacyKey}`);

    // Rotation has run: api_key_hash is NULL on the server. Revalidation
    // returns nothing. Fall-through then also returns no rows.
    (query as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const second = await authenticateCollector(`Bearer ${legacyKey}`);
    expect(second).toBeNull();
  });
});

// Codex review 2026-06-06 finding B: the gmk_cru_ grace check (ingest-auth.ts
// `row.grace_period_ends_at <= new Date()`) had no coverage because every mock
// row omitted the column, so the branch was never taken. A refactor could
// drop the gate undetected. These pin it.
describe("authenticateCollector grace-period enforcement (gmk path)", () => {
  it("rejects a gmk_cru_ key whose rotation grace has ended", async () => {
    const cru = generateCollectorKey("live");
    const graceEnded = new Date(Date.now() - 60_000); // grace lapsed a minute ago
    (query as any).mockResolvedValueOnce({
      rows: [{
        key_id: "k1", server_id: "srv_1", prefix: cru.prefix,
        expires_at: null, revoked_at: null,
        grace_period_ends_at: graceEnded,
        customer_id: "cust_1", status: "active",
      }],
    });
    const result = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(result).toBeNull();
  });

  it("accepts a gmk_cru_ key still inside its rotation grace window", async () => {
    const cru = generateCollectorKey("live");
    const graceActive = new Date(Date.now() + 3_600_000); // grace ends in an hour
    (query as any)
      .mockResolvedValueOnce({
        rows: [{
          key_id: "k1", server_id: "srv_1", prefix: cru.prefix,
          expires_at: null, revoked_at: null,
          grace_period_ends_at: graceActive,
          customer_id: "cust_1", status: "active",
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // last_used_at update (fire-and-forget)
    const result = await authenticateCollector(`Bearer ${cru.raw}`);
    expect(result).toEqual({ id: "srv_1", customerId: "cust_1" });
  });
});
