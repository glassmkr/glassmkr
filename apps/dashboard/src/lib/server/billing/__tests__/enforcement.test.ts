// Tests for the billing-enforcement cron path. Mocks DB and Stripe so
// the test runs without real services. Covers:
//   - findEnforcementCandidates filtering (Pro + sub rolled over + no card)
//   - runEnforcementCycle flag-OFF (would-suspend log; no UPDATE)
//   - runEnforcementCycle flag-ON (delegates to suspendExcessServers)
//   - Stripe error handling (skip, don't false-positive)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const stripeRetrieve = vi.fn();
vi.mock("../stripe", () => ({
  stripe: { customers: { retrieve: (...args: unknown[]) => stripeRetrieve(...args) } },
  isStripeConfigured: () => true,
}));

const { runEnforcementCycle, findEnforcementCandidates } = await import("../enforcement");

let originalFlag: string | undefined;
beforeEach(() => {
  queryMock.mockReset();
  stripeRetrieve.mockReset();
  originalFlag = process.env.BILLING_ENFORCEMENT_ENABLED;
  delete process.env.BILLING_ENFORCEMENT_ENABLED;
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED;
  else process.env.BILLING_ENFORCEMENT_ENABLED = originalFlag;
});

function mockOneCandidate(opts: {
  customerId?: string;
  stripeCustomerId?: string;
  hasCard?: boolean;
  servers?: Array<{ id: string; name: string; created_at: Date }>;
}) {
  const customerId = opts.customerId ?? "cust-1";
  const stripeCustomerId = opts.stripeCustomerId ?? "cus_test";
  const hasCard = opts.hasCard ?? false;
  const servers = opts.servers ?? [
    { id: "s1", name: "alpha", created_at: new Date("2026-01-01") },
    { id: "s2", name: "beta", created_at: new Date("2026-02-01") },
    { id: "s3", name: "gamma", created_at: new Date("2026-03-01") },
    { id: "s4", name: "delta", created_at: new Date("2026-04-01") },
    { id: "s5", name: "epsilon", created_at: new Date("2026-05-01") },
  ];
  // 1) candidates SELECT (post #33: column renamed to grace_period_end)
  queryMock.mockResolvedValueOnce({
    rows: [{
      customer_id: customerId,
      stripe_customer_id: stripeCustomerId,
      grace_period_end: new Date(Date.now() - 30 * 60 * 1000),
    }],
  });
  // 2) Stripe lookup
  stripeRetrieve.mockResolvedValueOnce({
    deleted: false,
    invoice_settings: hasCard ? { default_payment_method: { id: "pm_x" } } : { default_payment_method: null },
  });
  // 3) Servers SELECT (only fires if !hasCard)
  if (!hasCard) {
    queryMock.mockResolvedValueOnce({ rows: servers });
  }
}

describe("findEnforcementCandidates", () => {
  it("filters out customers WITH a default payment method", async () => {
    mockOneCandidate({ hasCard: true });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toEqual([]);
  });

  it("includes Pro customers with no card and >3 active servers", async () => {
    mockOneCandidate({ hasCard: false });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].customer_id).toBe("cust-1");
    expect(candidates[0].active_server_count).toBe(5);
    expect(candidates[0].servers_to_suspend.map((s) => s.id)).toEqual(["s4", "s5"]);
  });

  it("excludes customers with <=3 active servers (nothing to suspend)", async () => {
    mockOneCandidate({
      hasCard: false,
      servers: [
        { id: "a", name: "a", created_at: new Date("2026-01-01") },
        { id: "b", name: "b", created_at: new Date("2026-02-01") },
        { id: "c", name: "c", created_at: new Date("2026-03-01") },
      ],
    });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toEqual([]);
  });

  it("skips on Stripe error (conservative — under-suspend rather than over)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ customer_id: "cust-1", stripe_customer_id: "cus_x", grace_period_end: new Date(Date.now() - 1000) }],
    });
    stripeRetrieve.mockRejectedValueOnce(new Error("stripe down"));
    const candidates = await findEnforcementCandidates();
    expect(candidates).toEqual([]);
  });

  // Coverage gap regression-locks (Phase 7 P1, glassmkr#33). The cron
  // SQL must catch all three categories: A (active sub, period_end in
  // future — NOT caught), B (cancelled sub, period_end past — caught),
  // C (no sub at all, account >30d old — caught via COALESCE fallback).

  it("Category A: active sub with future period_end is NOT caught", async () => {
    // The candidate query filters server-side with grace_period_end <= NOW().
    // We simulate that by returning zero rows from the candidate SELECT —
    // a customer with future period_end wouldn't pass the SQL predicate.
    queryMock.mockResolvedValueOnce({ rows: [] });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toEqual([]);
  });

  // Note: Category-B test fixture wraps a candidate query the cron
  // post-PR-D filters with NOT billing_enforcement_exempt. The mocks
  // here pre-filter on the test side (rows returned == rows the
  // production SQL would return), so the predicate is exercised by
  // the SQL-contract test below, not by every fixture-driven test.

  it("Category B: cancelled sub with past period_end IS caught", async () => {
    // The cancelled customer's row arrives with grace_period_end in the
    // past (sub's last current_period_end). Same downstream path as
    // Category C for the consumer; assert that the candidate is included.
    queryMock.mockResolvedValueOnce({
      rows: [{ customer_id: "cust-cancelled", stripe_customer_id: "cus_b", grace_period_end: new Date("2026-03-01") }],
    });
    stripeRetrieve.mockResolvedValueOnce({ deleted: false, invoice_settings: { default_payment_method: null } });
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "s1", name: "a", created_at: new Date("2026-01-01") },
      { id: "s2", name: "b", created_at: new Date("2026-02-01") },
      { id: "s3", name: "c", created_at: new Date("2026-03-01") },
      { id: "s4", name: "d", created_at: new Date("2026-04-01") },
    ] });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].customer_id).toBe("cust-cancelled");
    expect(candidates[0].grace_period_end).toEqual(new Date("2026-03-01"));
  });

  it("Category C: no subscription at all + account >30d old IS caught (Simon's case)", async () => {
    // Account created 60 days ago; no stripe_subscriptions row; the SQL
    // COALESCE evaluates grace_period_end = created_at + 30d, which is
    // 30 days ago — past, so the row is included.
    const accountCreated = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const computedGraceEnd = new Date(accountCreated.getTime() + 30 * 24 * 60 * 60 * 1000);
    queryMock.mockResolvedValueOnce({
      rows: [{ customer_id: "cust-simon", stripe_customer_id: "cus_simon", grace_period_end: computedGraceEnd }],
    });
    stripeRetrieve.mockResolvedValueOnce({ deleted: false, invoice_settings: { default_payment_method: null } });
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "s1", name: "alpha", created_at: new Date("2026-04-05") },
      { id: "s2", name: "beta", created_at: new Date("2026-04-06") },
      { id: "s3", name: "gamma", created_at: new Date("2026-04-07") },
      { id: "s4", name: "delta", created_at: new Date("2026-04-08") },
    ] });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].customer_id).toBe("cust-simon");
    expect(candidates[0].active_server_count).toBe(4);
    expect(candidates[0].servers_to_suspend.map((s) => s.id)).toEqual(["s4"]);
    expect(candidates[0].grace_period_end).toEqual(computedGraceEnd);
  });

  it("Category C: brand-new Pro signup within first 30 days NOT caught", async () => {
    // Account created 5 days ago; no sub. created_at + 30d is 25 days
    // in the future, so grace_period_end > NOW() and the SQL filter
    // excludes the row. Assert the SQL predicate filters server-side
    // (we don't even see the row here).
    queryMock.mockResolvedValueOnce({ rows: [] });
    const candidates = await findEnforcementCandidates();
    expect(candidates).toEqual([]);
  });

  it("excludes exempt customers via NOT c.billing_enforcement_exempt predicate", async () => {
    // SQL contract regression-lock for PR D: the candidate query must
    // include the exempt filter. If anyone removes it, this test fails.
    queryMock.mockResolvedValueOnce({ rows: [] });
    await findEnforcementCandidates();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("NOT c.billing_enforcement_exempt");
  });

  it("uses LEFT JOIN to stripe_subscriptions (catches Category C)", async () => {
    // SQL contract regression-lock: the query MUST be a LEFT JOIN with
    // a DISTINCT ON subquery, NOT an INNER JOIN. If anyone reverts to
    // INNER JOIN, this test fails.
    queryMock.mockResolvedValueOnce({ rows: [] });
    await findEnforcementCandidates();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN");
    expect(sql).toContain("DISTINCT ON (glassmkr_customer_id)");
    expect(sql).toContain("COALESCE(latest_sub.current_period_end");
    expect(sql).toContain("c.created_at + INTERVAL '30 days'");
    expect(sql).toContain("<= NOW()");
    // Locks against the prior INNER JOIN shape:
    expect(sql).not.toMatch(/^\s*JOIN stripe_subscriptions/m);
    expect(sql).not.toContain("ss.current_period_end >= $1");
  });
});

describe("runEnforcementCycle", () => {
  // The cleanup pass for exempt customers runs at the start of every
  // cycle (PR D). For test ergonomics, every runEnforcementCycle test
  // first consumes a cleanup-UPDATE mock returning zero rows. Using a
  // helper to keep the test assertions readable.
  function mockEmptyCleanup() {
    queryMock.mockResolvedValueOnce({ rows: [] });
  }

  it("flag OFF: emits would-suspend log and does NOT issue an UPDATE", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    mockEmptyCleanup();
    mockOneCandidate({ hasCard: false });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await runEnforcementCycle();
      expect(r.flag_enabled).toBe(false);
      expect(r.candidates).toHaveLength(1);
      expect(r.suspended_count).toBe(0);
      const logs = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logs.some((m) => m.includes("would-suspend") && m.includes("server_ids=s4,s5"))).toBe(true);
      // DB calls: cleanup UPDATE (mocked empty), candidates SELECT,
      // servers SELECT. No suspension UPDATE since flag is off.
      expect(queryMock).toHaveBeenCalledTimes(3);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("flag ON: delegates to suspendExcessServers (which UPDATEs with reason=no_card_on_file)", async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = "true";
    mockEmptyCleanup();
    mockOneCandidate({ hasCard: false });
    // suspendExcessServers re-fetches active servers + UPDATEs.
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await runEnforcementCycle();
    expect(r.flag_enabled).toBe(true);
    expect(r.suspended_count).toBe(2);
    // Two UPDATEs may match: the cleanup-pass UPDATE (status='active'),
    // and the suspension UPDATE (status='suspended'). Find the
    // suspension one specifically.
    // Two UPDATEs may match SQL-fragment "UPDATE servers": the cleanup-
    // pass (sets status='active') and the suspension (sets
    // status='suspended' + suspended_reason via COALESCE). Match on
    // the COALESCE clause that's unique to the suspension UPDATE.
    const updateCall = queryMock.mock.calls.find((c) => {
      const sql = String(c[0]);
      return sql.includes("UPDATE servers") && sql.includes("COALESCE(suspended_reason");
    });
    expect(updateCall).toBeTruthy();
    expect((updateCall as unknown[])[1]).toEqual([["s4", "s5"], "no_card_on_file", "cust-1"]);
  });

  it("cleanup pass: auto-restores suspended servers belonging to exempt customers", async () => {
    // Cleanup UPDATE returns 2 rows for one customer.
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "s4", customer_id: "cust-exempt-1" },
      { id: "s5", customer_id: "cust-exempt-1" },
    ]});
    queryMock.mockResolvedValueOnce({ rows: [] }); // candidate SELECT
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runEnforcementCycle();
      const sql = String(queryMock.mock.calls[0][0]);
      expect(sql).toContain("UPDATE servers");
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain("billing_enforcement_exempt = TRUE");
      const logs = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logs.some((m) => m.includes("cleanup-exempt customer=cust-exempt-1") && m.includes("s4,s5"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("emits cycle-complete log on every run (zero candidates)", async () => {
    mockEmptyCleanup();
    queryMock.mockResolvedValueOnce({ rows: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await runEnforcementCycle();
      expect(r.candidates).toEqual([]);
      const logs = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logs.some((m) => m.includes("cycle complete") && m.includes("candidates=0"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
