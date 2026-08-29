// Correlation primitive tests. The function takes a structural
// QueryExec; we hand-roll a fake to avoid pulling pg/pg-mock.

import { describe, expect, it } from "vitest";

import { correlatedRulesActive, type QueryExec } from "../correlation.js";

interface FakeExec extends QueryExec {
  calls: Array<{ sql: string; params: unknown[] }>;
  callCount: number;
}

function fakeExec(rows: Array<Record<string, unknown>>): FakeExec {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn = (async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    return { rows };
  }) as FakeExec;
  Object.defineProperty(fn, "calls", { get: () => calls });
  Object.defineProperty(fn, "callCount", { get: () => calls.length });
  return fn;
}

describe("correlatedRulesActive", () => {
  it("returns empty when ruleTypes is empty (no DB call)", async () => {
    const exec = fakeExec([]);
    const res = await correlatedRulesActive(exec, "h1", [], 300);
    expect(res.matched).toEqual([]);
    expect(res.oldest_first_seen_ms).toBeNull();
    expect(exec.callCount).toBe(0);
  });

  it("returns empty when DB returns no rows", async () => {
    const exec = fakeExec([]);
    const res = await correlatedRulesActive(exec, "h1", ["a", "b"], 300);
    expect(res.matched).toEqual([]);
    expect(res.oldest_first_seen_ms).toBeNull();
    expect(exec.callCount).toBe(1);
  });

  it("returns matched set and oldest first_seen", async () => {
    const exec = fakeExec([
      { alert_type: "conntrack_exhaustion", first_seen_ms: 1_700_000_000_000 },
      { alert_type: "tcp_retrans_high", first_seen_ms: 1_700_000_030_000 },
    ]);
    const res = await correlatedRulesActive(
      exec,
      "h1",
      ["conntrack_exhaustion", "tcp_retrans_high", "listen_overflow"],
      300,
    );
    expect(res.matched.sort()).toEqual([
      "conntrack_exhaustion",
      "tcp_retrans_high",
    ]);
    expect(res.oldest_first_seen_ms).toBe(1_700_000_000_000);
  });

  it("dedupes alert_type when same rule has multiple rows", async () => {
    const exec = fakeExec([
      { alert_type: "smart_failing", first_seen_ms: 1000 },
      { alert_type: "smart_failing", first_seen_ms: 2000 },
    ]);
    const res = await correlatedRulesActive(
      exec,
      "h1",
      ["smart_failing"],
      300,
    );
    expect(res.matched).toEqual(["smart_failing"]);
    expect(res.oldest_first_seen_ms).toBe(1000);
  });

  it("passes server_id, ruleTypes, and cutoff in params", async () => {
    const exec = fakeExec([]);
    await correlatedRulesActive(exec, "host-42", ["x", "y"], 60);
    const params = exec.calls[0]!.params;
    expect(params[0]).toBe("host-42");
    expect(params[1]).toEqual(["x", "y"]);
    // Cutoff = now() - 60s; cannot pin exactly but must be < now.
    expect(typeof params[2]).toBe("number");
    expect(params[2] as number).toBeLessThanOrEqual(Date.now());
  });
});
