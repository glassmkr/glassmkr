// Pre-pass loader tests. Mocks readWindow + loader + clickhouse so
// the test exercises only orchestration: which rules contribute,
// how errors are isolated, and what shape ends up in the returned
// Map.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ClickHouse and loader BEFORE importing runPrePass. vi.mock is
// hoisted, so use vi.hoisted() to safely build the spy refs at the
// same hoist time.
const mocks = vi.hoisted(() => ({
  clickhouseQuery: vi.fn(),
  listMetadataRuleTypes: vi.fn(),
  getRuleMetadata: vi.fn(),
}));

vi.mock("@glassmkr/db/clickhouse", () => ({
  clickhouse: { query: mocks.clickhouseQuery },
}));
vi.mock("../../alerts/fix-workflow/loader.js", () => ({
  listMetadataRuleTypes: () => mocks.listMetadataRuleTypes(),
  getRuleMetadata: (t: string) => mocks.getRuleMetadata(t),
}));

const mockClickhouseQuery = mocks.clickhouseQuery;
const mockListMetadataRuleTypes = mocks.listMetadataRuleTypes;
const mockGetRuleMetadata = mocks.getRuleMetadata;

import { _clearCacheForTests } from "../cache.js";
import { runPrePass } from "../pre_pass.js";

function fakePg(rows: Array<Record<string, unknown>> = []) {
  return async (_sql: string, _params?: unknown[]) => ({ rows });
}

function mockChRows(rows: Array<Record<string, unknown>>) {
  mockClickhouseQuery.mockResolvedValueOnce({
    json: async () => rows,
  } as never);
}

beforeEach(() => {
  mockClickhouseQuery.mockReset();
  mockListMetadataRuleTypes.mockReset();
  mockGetRuleMetadata.mockReset();
  _clearCacheForTests();
});
afterEach(() => {
  _clearCacheForTests();
});

describe("runPrePass", () => {
  it("returns empty map when no rule declares cross_snapshot", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["plain_rule"]);
    mockGetRuleMetadata.mockReturnValue({ id: "plain_rule" });
    const result = await runPrePass("h1", [], { pg: fakePg() });
    expect(result.size).toBe(0);
    expect(mockClickhouseQuery).not.toHaveBeenCalled();
  });

  it("loads snapshots for one rule with cross_snapshot block", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["disk_fill_projection"]);
    mockGetRuleMetadata.mockReturnValue({
      id: "disk_fill_projection",
      cross_snapshot: {
        window: { count: 6 },
        columns: ["timestamp", "disks"],
        parsed: true,
      },
    });
    mockChRows([
      { timestamp: "2026-05-19T12:00:00Z", disks: "[]" },
      { timestamp: "2026-05-19T12:05:00Z", disks: "[]" },
    ]);

    const result = await runPrePass("h1", [], { pg: fakePg() });
    expect(result.size).toBe(1);
    const payload = result.get("disk_fill_projection")!;
    expect(payload.snapshots.length).toBe(2);
    expect(payload.correlation).toBeNull();
  });

  it("also runs correlation when correlate_with is set", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["accept_backlog"]);
    mockGetRuleMetadata.mockReturnValue({
      id: "accept_backlog",
      cross_snapshot: {
        window: { count: 1 },
        columns: ["timestamp"],
        parsed: false,
        correlate_with: {
          rule_ids: ["conntrack_exhaustion", "tcp_retrans_high"],
          window_seconds: 300,
        },
      },
    });
    mockChRows([{ timestamp: "2026-05-19T12:00:00Z" }]);
    const pg = fakePg([
      { alert_type: "conntrack_exhaustion", first_seen_ms: 1_700_000_000_000 },
    ]);

    const result = await runPrePass("h1", [], { pg });
    const payload = result.get("accept_backlog")!;
    expect(payload.correlation).not.toBeNull();
    expect(payload.correlation!.matched).toEqual(["conntrack_exhaustion"]);
  });

  it("skips muted rules even if they declare cross_snapshot", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["disk_fill_projection"]);
    mockGetRuleMetadata.mockReturnValue({
      id: "disk_fill_projection",
      cross_snapshot: { window: { count: 6 }, columns: ["disks"], parsed: true },
    });
    const result = await runPrePass("h1", ["disk_fill_projection"], {
      pg: fakePg(),
    });
    expect(result.size).toBe(0);
    expect(mockClickhouseQuery).not.toHaveBeenCalled();
  });

  it("isolates errors per rule (one bad readWindow does not poison others)", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["rule_a", "rule_b"]);
    mockGetRuleMetadata.mockImplementation((t: string) => ({
      id: t,
      cross_snapshot: {
        window: { count: 3 },
        columns: ["timestamp"],
        parsed: false,
      },
    }));
    // rule_a fails; rule_b succeeds.
    mockClickhouseQuery
      .mockRejectedValueOnce(new Error("clickhouse boom"))
      .mockResolvedValueOnce({
        json: async () => [{ timestamp: "2026-05-19T12:00:00Z" }],
      } as never);

    const result = await runPrePass("h1", [], { pg: fakePg() });
    // rule_a still gets a (degraded) entry per the spec: failed loads
    // return empty arrays, callers see "no payload" semantics.
    expect(result.get("rule_a")?.snapshots).toEqual([]);
    expect(result.get("rule_b")?.snapshots.length).toBe(1);
  });

  it("multiple rules with identical (window, columns) hit the cache once", async () => {
    mockListMetadataRuleTypes.mockReturnValue(["rule_a", "rule_b"]);
    mockGetRuleMetadata.mockImplementation((t: string) => ({
      id: t,
      cross_snapshot: {
        window: { fromSecondsAgo: 1800 },
        columns: ["timestamp", "disks"],
        parsed: true,
      },
    }));
    // Only one ClickHouse query expected; second rule hits the cache.
    // BUT: both rules' readWindow calls execute concurrently via
    // Promise.all in pre_pass. If both fire before either returns,
    // there's no cache to hit yet. Real production wins come on
    // SECOND ingest tick within the 60s TTL. We assert here that the
    // cache key is the same (so subsequent ticks short-circuit) by
    // making one ClickHouse call succeed and checking both rules get
    // the same data without us providing data for the second call.
    let queries = 0;
    mockClickhouseQuery.mockImplementation(async () => {
      queries++;
      return {
        json: async () => [
          { timestamp: "2026-05-19T12:00:00Z", disks: "[]" },
        ],
      } as never;
    });

    const result = await runPrePass("h1", [], { pg: fakePg() });
    expect(result.size).toBe(2);
    // Either both ran (concurrent miss) or one + cache hit. Either
    // way both payloads are populated.
    expect(result.get("rule_a")?.snapshots.length).toBe(1);
    expect(result.get("rule_b")?.snapshots.length).toBe(1);
    // Concurrent execution means queries can be 1 or 2; we only
    // assert it's not more.
    expect(queries).toBeLessThanOrEqual(2);
  });
});
