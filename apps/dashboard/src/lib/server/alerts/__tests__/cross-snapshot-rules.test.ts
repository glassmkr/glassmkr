// Tests for the two cross-snapshot rules shipped in Phase 3:
//   disk_fill_projection
//   accept_backlog_or_syn_flood
//
// Both rules consume ctx.cross_snapshot, which the ingest path's
// pre-pass populates from runPrePass. Here we synthesise the payload
// directly and call evaluateAlerts with the crossSnapshotData map.

import { describe, expect, it } from "vitest";

import {
  evaluateAlerts,
  type CrossSnapshotPayload,
} from "../evaluator";
import { healthySnapshot } from "./helpers";

// Helper: build a payload map keyed by rule type.
function payloadMap(
  entries: Array<[string, CrossSnapshotPayload]>,
): Map<string, CrossSnapshotPayload> {
  return new Map(entries);
}

describe("disk_fill_projection", () => {
  it("emits P1 critical when projected full within 24h", () => {
    const snap = healthySnapshot();
    // Override the / mount to a small filesystem at high usage so the
    // projection has something to point at; current available 4 GB.
    snap.disks[0] = {
      ...snap.disks[0],
      total_gb: 100,
      used_gb: 96,
      available_gb: 4,
      percent_used: 96,
    };

    // Synthesise 6 snapshots over ~30 min, shrinking fast: 10 GB ->
    // 4 GB. That's 6 GB lost in 30 min = ~288 GB/day; at 4 GB free
    // the projection is essentially "any minute now".
    const now = Date.now();
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [
          {
            mount: "/",
            device: "/dev/sda1",
            available_gb: 4 + i * 1.2,
          },
        ],
      });
    }

    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    const fill = alerts.filter((a) => a.type === "disk_fill_projection");
    expect(fill.length).toBe(1);
    expect(fill[0]!.severity).toBe("critical");
    expect(fill[0]!.evidence.mount).toBe("/");
    expect(fill[0]!.evidence.hours_to_full).toBeLessThan(24);
  });

  it("emits P2 warning when projected full between 24h and 7d", () => {
    const snap = healthySnapshot();
    snap.disks[0] = {
      ...snap.disks[0],
      total_gb: 100,
      used_gb: 50,
      available_gb: 50,
      percent_used: 50,
    };

    // Shrink at ~10 GB/day across 6 snapshots (30 min) => available
    // drops from 52.5 -> 50. Projected zero in ~5 days.
    const now = Date.now();
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [
          {
            mount: "/",
            device: "/dev/sda1",
            available_gb: 50 + i * 0.05,
          },
        ],
      });
    }

    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    const fill = alerts.filter((a) => a.type === "disk_fill_projection");
    expect(fill.length).toBe(1);
    expect(fill[0]!.severity).toBe("warning");
    expect(fill[0]!.evidence.hours_to_full).toBeGreaterThan(24);
    expect(fill[0]!.evidence.hours_to_full).toBeLessThan(168);
  });

  it("does not emit when projection slope is non-negative (growing or flat)", () => {
    const snap = healthySnapshot();
    const now = Date.now();
    // Flat history.
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [
          {
            mount: "/",
            device: "/dev/sda1",
            available_gb: 400,
          },
        ],
      });
    }
    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    expect(alerts.filter((a) => a.type === "disk_fill_projection").length).toBe(0);
  });

  it("does not emit when payload absent (rules without ctx see no signal)", () => {
    const snap = healthySnapshot();
    const alerts = evaluateAlerts(snap, {});
    expect(alerts.filter((a) => a.type === "disk_fill_projection").length).toBe(0);
  });

  // Regression: campaign finding 2026-05-20 on val-mz62hd. Stress logs
  // briefly grew / at 82 GB/day, LR projected fill in 5.6d, alert fired
  // "Disk / projected full in 5.6d" but / was only 2% used with 458 GB
  // free. Title misleads. Rule requires current_percent_used >= 40 (raised
  // from 25 on 2026-07-15 after the services FP below) before firing.
  it("suppresses projections on near-empty disks (<40% used)", () => {
    const snap = healthySnapshot();
    // 458 GB free out of 466 GB = 2% used; matches the mz62hd snapshot.
    snap.disks[0] = {
      ...snap.disks[0],
      total_gb: 466,
      used_gb: 8,
      available_gb: 458,
      percent_used: 2,
    };
    const now = Date.now();
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      // Drop 0.3 GB per 5 min over 6 snapshots = ~86 GB/day — exactly
      // the rate that fired the bogus alert on mz62hd. Projected zero
      // in ~5-6 days but the disk is nowhere near full.
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [
          { mount: "/", device: "/dev/md127", available_gb: 458 + i * 0.3 },
        ],
      });
    }
    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    expect(alerts.filter((a) => a.type === "disk_fill_projection").length).toBe(0);
  });

  it("suppresses a low-usage disk with a short-window fill burst (services 2026-07-15 FP)", () => {
    // services /: ~28% used with ~330 GB free, but a transient write burst
    // (nightly job) briefly shrank available, so a 6-sample LR projected
    // "full in ~3 days". 27 such self-resolving events. Below the 40% floor,
    // so suppressed. (Would have fired under the old 25% floor.)
    const snap = healthySnapshot();
    snap.disks[0] = {
      ...snap.disks[0],
      total_gb: 460,
      used_gb: 129,
      available_gb: 331,
      percent_used: 28,
    };
    const now = Date.now();
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      // ~100 GB/day burst over 6 snapshots (30 min): available 331 down to 329.
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [{ mount: "/", device: "/dev/sda1", available_gb: 331 + i * 0.35 }],
      });
    }
    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(snap, {}, undefined, payloadMap([["disk_fill_projection", csd]]));
    expect(alerts.filter((a) => a.type === "disk_fill_projection").length).toBe(0);
  });

  it("title leads with growth rate, not time-to-full", () => {
    const snap = healthySnapshot();
    snap.disks[0] = {
      ...snap.disks[0],
      total_gb: 100,
      used_gb: 60,
      available_gb: 40,
      percent_used: 60,
    };
    const now = Date.now();
    const snapshots = [];
    for (let i = 5; i >= 0; i--) {
      // Drop 1 GB per 5 min = ~288 GB/day; projected full in <4 hours.
      snapshots.push({
        timestamp: now - i * 5 * 60_000,
        disks: [
          { mount: "/", device: "/dev/sda1", available_gb: 40 + i * 1 },
        ],
      });
    }
    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    const fill = alerts.filter((a) => a.type === "disk_fill_projection");
    expect(fill.length).toBe(1);
    expect(fill[0]!.title).toMatch(/filling at \d+(\.\d+)? GB\/day/);
    expect(fill[0]!.evidence.current_percent_used).toBeGreaterThan(50);
  });

  it("skips mounts with insufficient history (<4 points)", () => {
    const snap = healthySnapshot();
    snap.disks[0] = { ...snap.disks[0], available_gb: 2 };
    const now = Date.now();
    const snapshots = [
      {
        timestamp: now - 10_000,
        disks: [
          { mount: "/", device: "/dev/sda1", available_gb: 10 },
        ],
      },
      {
        timestamp: now,
        disks: [
          { mount: "/", device: "/dev/sda1", available_gb: 2 },
        ],
      },
    ];
    const csd: CrossSnapshotPayload = { snapshots, correlation: null };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["disk_fill_projection", csd]]),
    );
    expect(alerts.filter((a) => a.type === "disk_fill_projection").length).toBe(0);
  });
});

describe("accept_backlog_or_syn_flood", () => {
  it("fires P1 when 2+ subordinates active", () => {
    const snap = healthySnapshot();
    const csd: CrossSnapshotPayload = {
      snapshots: [],
      correlation: {
        matched: ["conntrack_exhaustion", "tcp_retrans_high"],
        oldest_first_seen_ms: Date.now() - 120_000,
      },
    };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["accept_backlog_or_syn_flood", csd]]),
    );
    const fired = alerts.filter((a) => a.type === "accept_backlog_or_syn_flood");
    expect(fired.length).toBe(1);
    expect(fired[0]!.severity).toBe("critical");
    expect(fired[0]!.evidence.rules_matched_count).toBe(2);
  });

  it("does not fire with only 1 subordinate active", () => {
    const snap = healthySnapshot();
    const csd: CrossSnapshotPayload = {
      snapshots: [],
      correlation: {
        matched: ["conntrack_exhaustion"],
        oldest_first_seen_ms: Date.now(),
      },
    };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["accept_backlog_or_syn_flood", csd]]),
    );
    expect(
      alerts.filter((a) => a.type === "accept_backlog_or_syn_flood").length,
    ).toBe(0);
  });

  it("does not fire when no payload supplied", () => {
    const snap = healthySnapshot();
    const alerts = evaluateAlerts(snap, {});
    expect(
      alerts.filter((a) => a.type === "accept_backlog_or_syn_flood").length,
    ).toBe(0);
  });

  it("fires when all 3 subordinates active and lists them in evidence", () => {
    const snap = healthySnapshot();
    const matched = ["conntrack_exhaustion", "listen_overflow", "tcp_retrans_high"];
    const csd: CrossSnapshotPayload = {
      snapshots: [],
      correlation: {
        matched,
        oldest_first_seen_ms: Date.now() - 60_000,
      },
    };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["accept_backlog_or_syn_flood", csd]]),
    );
    const fired = alerts.filter((a) => a.type === "accept_backlog_or_syn_flood");
    expect(fired.length).toBe(1);
    expect(fired[0]!.evidence.matched_rules).toEqual(matched);
    expect(fired[0]!.evidence.rules_matched_count).toBe(3);
  });

  // Codex 2026-05-22B F5 regression: classifier rules must observe
  // SAME-SNAPSHOT subordinate emissions, not just previous-snapshot
  // active alerts from Postgres. Without the evaluator's phase-split,
  // the classifier ran before its subordinates in declaration order
  // and missed first-time co-fires.
  it("fires from same-snapshot subordinate emissions with no pre-pass payload (Codex B F5)", () => {
    const snap = healthySnapshot();
    // Drive two subordinates from the snapshot itself:
    snap.conntrack = {
      available: true,
      count: 245_000,
      max: 262_144,
      percent: 93,
    };
    (snap as unknown as { tcp_stats: Record<string, unknown> }).tcp_stats = {
      available: true,
      listen_overflows_rate_per_sec: 2.5,
      listen_overflows_total: 100,
      listen_drops_rate_per_sec: 0,
      listen_drops_total: 0,
    };
    // No crossSnapshotData payload — the only way accept_backlog_or_syn_flood
    // fires is if the evaluator merges same-snapshot phase-1 emissions
    // into its correlation context.
    const alerts = evaluateAlerts(snap, {});
    const fired = alerts.filter((a) => a.type === "accept_backlog_or_syn_flood");
    expect(fired.length).toBe(1);
    expect(fired[0]!.evidence.rules_matched_count).toBe(2);
    expect(
      (fired[0]!.evidence.matched_rules as string[]).sort(),
    ).toEqual(["conntrack_exhaustion", "listen_overflow"].sort());
  });

  it("does NOT fire from a same-snapshot SINGLE subordinate (Codex B F5 — boundary)", () => {
    const snap = healthySnapshot();
    snap.conntrack = {
      available: true,
      count: 245_000,
      max: 262_144,
      percent: 93,
    };
    // tcp_stats absent → listen_overflow + tcp_retrans_high cannot fire
    const alerts = evaluateAlerts(snap, {});
    expect(
      alerts.filter((a) => a.type === "accept_backlog_or_syn_flood").length,
    ).toBe(0);
    // conntrack_exhaustion itself still fires.
    expect(
      alerts.filter((a) => a.type === "conntrack_exhaustion").length,
    ).toBeGreaterThan(0);
  });

  it("merges previous-snapshot (Postgres) + same-snapshot signals (Codex B F5)", () => {
    const snap = healthySnapshot();
    // One subordinate fires same-snapshot:
    snap.conntrack = {
      available: true,
      count: 245_000,
      max: 262_144,
      percent: 93,
    };
    // One subordinate is "already active" per the pre-pass:
    const csd: CrossSnapshotPayload = {
      snapshots: [],
      correlation: {
        matched: ["listen_overflow"],
        oldest_first_seen_ms: Date.now() - 120_000,
      },
    };
    const alerts = evaluateAlerts(
      snap,
      {},
      undefined,
      payloadMap([["accept_backlog_or_syn_flood", csd]]),
    );
    const fired = alerts.filter((a) => a.type === "accept_backlog_or_syn_flood");
    expect(fired.length).toBe(1);
    expect(
      (fired[0]!.evidence.matched_rules as string[]).sort(),
    ).toEqual(["conntrack_exhaustion", "listen_overflow"].sort());
  });
});
