import { describe, expect, it, vi, beforeEach } from "vitest";

// upsertAndCheckPersistence hits Postgres via @glassmkr/db/pg `query`; mock it
// so we can assert which statements it issues. Hoisted so the mock is in place
// before persistence.ts is imported.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@glassmkr/db/pg", () => ({ query: queryMock }));

import { computeUrgencyTier, upsertAndCheckPersistence } from "../persistence";
import type { Finding } from "../types";

function f(severity: Finding["severity"], projected_timeline: string | null): Finding {
  return {
    type: "smart_5_growing",
    severity,
    resource: { kind: "drive", name: "/dev/sda", serial: "X", model: "M", vendor: "V" },
    contributing_metrics: [],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline,
    evidence_summary: "",
  };
}

function driveFinding(opts: { serial?: string; name: string }): Finding {
  return {
    type: "smart_5_growing",
    severity: "medium",
    resource: { kind: "drive", name: opts.name, serial: opts.serial, model: "M", vendor: "V" },
    contributing_metrics: [],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline: null,
    evidence_summary: "",
  };
}

describe("computeUrgencyTier", () => {
  it("returns imminent for high severity with <=7 day projection", () => {
    expect(computeUrgencyTier(f("high", "within 5 days"))).toBe("imminent");
  });

  it("returns imminent for high severity with 'immediate' timeline", () => {
    expect(computeUrgencyTier(f("high", "immediate"))).toBe("imminent");
  });

  it("returns soon for high severity with no specific timeline", () => {
    expect(computeUrgencyTier(f("high", null))).toBe("soon");
  });

  it("returns soon for medium severity with projection <=30 days", () => {
    expect(computeUrgencyTier(f("medium", "within 21 days"))).toBe("soon");
  });

  it("returns scheduled for medium severity without tight projection", () => {
    expect(computeUrgencyTier(f("medium", null))).toBe("scheduled");
  });

  it("returns scheduled for medium severity with 45 day projection", () => {
    expect(computeUrgencyTier(f("medium", "within 45 days"))).toBe("scheduled");
  });
});

describe("upsertAndCheckPersistence: serial supersedes the path-keyed sibling", () => {
  beforeEach(() => {
    queryMock.mockReset();
    // Route each statement to a plausible result by matching its SQL: the
    // existing-warning SELECT returns none (so we hit the INSERT path); the
    // INSERT returns a row id; the supersede UPDATE result is unused.
    queryMock.mockImplementation((sql: string) => {
      if (/UPDATE trend_warnings SET resolved_at/.test(sql)) return Promise.resolve({ rows: [], rowCount: 1 });
      if (/SELECT id, consecutive_batches_seen/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO trend_warnings/.test(sql)) return Promise.resolve({ rows: [{ id: 42 }] });
      return Promise.resolve({ rows: [] });
    });
  });

  it("resolves the path-keyed warning when the finding now has a serial", async () => {
    await upsertAndCheckPersistence("srv1", driveFinding({ serial: "21052CB96746", name: "/dev/sdb" }), "scheduled", null);
    const supersede = queryMock.mock.calls.find(([sql]: any[]) =>
      /UPDATE trend_warnings SET resolved_at = now\(\), resolution_reason = 'superseded_by_serial'/.test(sql),
    );
    expect(supersede, "expected a supersede UPDATE to be issued").toBeTruthy();
    // It must target the device-path key, scoped to this server + warning type.
    expect(supersede![1]).toEqual(["srv1", "smart_5_growing", "drive:/dev/sdb"]);
    // And the canonical (serial-keyed) row is the one inserted/looked up.
    const insert = queryMock.mock.calls.find(([sql]: any[]) => /INSERT INTO trend_warnings/.test(sql));
    expect(insert![1][2]).toBe("drive:21052CB96746");
  });

  it("does NOT supersede when there is no serial (the path is the only identity)", async () => {
    await upsertAndCheckPersistence("srv1", driveFinding({ name: "/dev/sdb" }), "scheduled", null);
    const supersede = queryMock.mock.calls.find(([sql]: any[]) => /superseded_by_serial/.test(sql));
    expect(supersede, "no serial means no supersede").toBeFalsy();
  });
});
