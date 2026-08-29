// Runtime subordination + incident grouping unit tests.
// Per CC_SPEC_RUNTIME_SUBORDINATION_2026-05-19.md §2.4 + §3.4.
//
// These tests exercise the pure routing decision function. The
// SQL-write side (attachEvidenceToParent) is integration-tested
// via the ingest path's behavior tests; here we cover the decision
// logic in isolation by passing a synthetic rule override + a
// synthetic ActiveAlertRow list.

import { describe, it, expect } from "vitest";
import {
  routeAlertEmission,
  attachEvidenceToParent,
  pruneToSurvivingActiveAlerts,
  type ActiveAlertRow,
  type RoutingRule,
  _internal,
} from "../subordination.js";
import type { AlertResult } from "../evaluator.js";

function mkAlert(type: string, severity: AlertResult["severity"] = "warning"): AlertResult {
  return {
    type,
    severity,
    title: "x",
    message: "x",
    evidence: { sample: 1 },
    recommendation: "x",
  };
}

function mkActive(opts: {
  id: number;
  alert_type: string;
  ageSeconds: number;
  now: Date;
  incident_group_key?: string;
}): ActiveAlertRow {
  return {
    id: opts.id,
    alert_type: opts.alert_type,
    first_seen: new Date(opts.now.getTime() - opts.ageSeconds * 1000),
    incident_group_key: opts.incident_group_key ?? null,
    parent_alert_id: null,
    evidence: null,
  };
}

describe("routeAlertEmission — subordinate_to (parent-child)", () => {
  const now = new Date("2026-05-19T12:00:00Z");
  const childRule: RoutingRule = { subordinate_to: "oom_kills" };

  it("emits independent when no parent active on host", () => {
    const decision = routeAlertEmission(
      mkAlert("ram_high"),
      "srv_x",
      [],
      now,
      childRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });

  it("attaches to parent when parent fires within 5 min on same host", () => {
    const active = [
      mkActive({ id: 42, alert_type: "oom_kills", ageSeconds: 60, now }),
    ];
    const decision = routeAlertEmission(
      mkAlert("ram_high"),
      "srv_x",
      active,
      now,
      childRule,
    );
    expect(decision.kind).toBe("attach_to_parent");
    if (decision.kind === "attach_to_parent") {
      expect(decision.parent_alert_id).toBe(42);
      expect(decision.relationship).toBe("subordinate");
      expect(decision.reason).toBe("subordinate_to");
    }
  });

  it("emits independent when parent fired more than 5 min ago", () => {
    const active = [
      mkActive({ id: 42, alert_type: "oom_kills", ageSeconds: 400, now }),
    ];
    const decision = routeAlertEmission(
      mkAlert("ram_high"),
      "srv_x",
      active,
      now,
      childRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });

  it("emits independent when parent is for a different host (not in active list)", () => {
    // hostActiveAlerts is already pre-filtered by host; an empty list
    // means no parent on THIS host even if it fires elsewhere.
    const decision = routeAlertEmission(
      mkAlert("ram_high"),
      "srv_x",
      [],
      now,
      childRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });

  it("two children of the same parent both attach to the same parent", () => {
    const active = [
      mkActive({ id: 42, alert_type: "oom_kills", ageSeconds: 60, now }),
    ];
    const d1 = routeAlertEmission(mkAlert("ram_high"), "srv_x", active, now, childRule);
    const d2 = routeAlertEmission(mkAlert("swap_high"), "srv_x", active, now, {
      subordinate_to: "oom_kills",
    });
    if (d1.kind !== "attach_to_parent" || d2.kind !== "attach_to_parent") {
      throw new Error("expected both to attach");
    }
    expect(d1.parent_alert_id).toBe(42);
    expect(d2.parent_alert_id).toBe(42);
  });

  it("rule without subordinate_to or incident_group emits independent", () => {
    const active = [
      mkActive({ id: 42, alert_type: "oom_kills", ageSeconds: 60, now }),
    ];
    const decision = routeAlertEmission(
      mkAlert("disk_space_high"),
      "srv_x",
      active,
      now,
      {} as RoutingRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });
});

describe("routeAlertEmission — incident_group (symmetric)", () => {
  const now = new Date("2026-05-19T12:00:00Z");
  const groupRule: RoutingRule = {
    incident_group: { group_id: "memory_hardware_fault", correlation_window_seconds: 300 },
  };

  it("starts a new incident when no sibling active in group", () => {
    const decision = routeAlertEmission(
      mkAlert("ecc_errors"),
      "srv_x",
      [],
      now,
      groupRule,
    );
    expect(decision.kind).toBe("emit_independent");
    if (decision.kind === "emit_independent") {
      expect(decision.incident_group_key).toBeDefined();
      expect(decision.incident_group_key).toMatch(/^srv_x:memory_hardware_fault:/);
    }
  });

  it("joins an existing incident when a sibling fired within window on same host", () => {
    const existingKey = _internal.makeIncidentGroupKey("srv_x", "memory_hardware_fault", now);
    const active = [
      mkActive({
        id: 99,
        alert_type: "ecc_errors",
        ageSeconds: 30,
        now,
        incident_group_key: existingKey,
      }),
    ];
    const decision = routeAlertEmission(
      mkAlert("mce_uncorrected"),
      "srv_x",
      active,
      now,
      groupRule,
    );
    expect(decision.kind).toBe("attach_to_parent");
    if (decision.kind === "attach_to_parent") {
      expect(decision.parent_alert_id).toBe(99);
      expect(decision.relationship).toBe("sibling");
      expect(decision.reason).toBe("incident_group");
    }
  });

  it("starts a NEW incident when the previous one is outside the window", () => {
    const oldKey = `srv_x:memory_hardware_fault:2026-05-19T11:50:00.000Z`;
    const active = [
      mkActive({
        id: 99,
        alert_type: "ecc_errors",
        ageSeconds: 600, // 10 minutes old
        now,
        incident_group_key: oldKey,
      }),
    ];
    const decision = routeAlertEmission(
      mkAlert("mce_uncorrected"),
      "srv_x",
      active,
      now,
      groupRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });

  it("three rules in same group within window: first starts, second + third join", () => {
    const decision1 = routeAlertEmission(
      mkAlert("ecc_errors"),
      "srv_x",
      [],
      now,
      groupRule,
    );
    expect(decision1.kind).toBe("emit_independent");
    if (decision1.kind !== "emit_independent" || !decision1.incident_group_key) {
      throw new Error("expected new incident with key");
    }

    // Simulate row appended to active list after the first INSERT.
    const activeAfter1: ActiveAlertRow[] = [
      mkActive({
        id: 100,
        alert_type: "ecc_errors",
        ageSeconds: 5,
        now,
        incident_group_key: decision1.incident_group_key,
      }),
    ];

    const decision2 = routeAlertEmission(
      mkAlert("mce_uncorrected"),
      "srv_x",
      activeAfter1,
      now,
      groupRule,
    );
    expect(decision2.kind).toBe("attach_to_parent");
    if (decision2.kind === "attach_to_parent") {
      expect(decision2.parent_alert_id).toBe(100);
    }

    const decision3 = routeAlertEmission(
      mkAlert("ecc_correctable_storm"),
      "srv_x",
      activeAfter1,
      now,
      groupRule,
    );
    expect(decision3.kind).toBe("attach_to_parent");
    if (decision3.kind === "attach_to_parent") {
      expect(decision3.parent_alert_id).toBe(100);
    }
  });

  it("uses the rule's correlation_window_seconds when present (not default)", () => {
    const longWindowRule: RoutingRule = {
      incident_group: { group_id: "g", correlation_window_seconds: 1800 }, // 30 min
    };
    const oldKey = `srv_x:g:2026-05-19T11:35:00.000Z`;
    const active = [
      mkActive({
        id: 100,
        alert_type: "rule_a",
        ageSeconds: 1500, // 25 min — within 30-min window
        now,
        incident_group_key: oldKey,
      }),
    ];
    const decision = routeAlertEmission(
      mkAlert("rule_b"),
      "srv_x",
      active,
      now,
      longWindowRule,
    );
    expect(decision.kind).toBe("attach_to_parent");
  });

  it("hostActiveAlerts is pre-filtered by host: an empty list yields a new incident", () => {
    // The caller (ingest endpoint) loads only active alerts for the
    // specific host. We don't need to test inter-host isolation in
    // this routing function — it's a precondition.
    const decision = routeAlertEmission(
      mkAlert("rule_a"),
      "srv_other",
      [],
      now,
      groupRule,
    );
    expect(decision.kind).toBe("emit_independent");
  });
});

describe("attachEvidenceToParent", () => {
  function mkExec(initial: { rows: any[] }) {
    const writes: Array<{ sql: string; params: unknown[] }> = [];
    const exec = async (sql: string, params?: unknown[]) => {
      writes.push({ sql, params: params ?? [] });
      if (sql.startsWith("SELECT")) return initial;
      return { rows: [] };
    };
    return { exec, writes };
  }

  const now = new Date("2026-05-19T12:00:00Z");

  it("wraps an existing flat evidence into {primary, attached} on first attach", async () => {
    const { exec, writes } = mkExec({
      rows: [{ evidence: { used_mb: 32000, total_mb: 32768 } }],
    });
    await attachEvidenceToParent(
      exec,
      100,
      { rule_id: "swap_high", severity: "warning" },
      { swap_used_mb: 8000 },
      "subordinate",
      now,
    );
    const updateCall = writes.find((w) => w.sql.startsWith("UPDATE"));
    expect(updateCall).toBeDefined();
    const evidenceParam = JSON.parse(updateCall!.params[1] as string);
    expect(evidenceParam.primary).toEqual({ used_mb: 32000, total_mb: 32768 });
    expect(evidenceParam.attached).toHaveLength(1);
    expect(evidenceParam.attached[0]).toMatchObject({
      rule_id: "swap_high",
      relationship: "subordinate",
      severity: "warning",
    });
  });

  it("appends to existing attached[] without re-wrapping primary", async () => {
    const { exec, writes } = mkExec({
      rows: [{
        evidence: {
          primary: { used_mb: 32000 },
          attached: [{ rule_id: "swap_high", relationship: "subordinate", evidence: {}, attached_at: "2026-05-19T11:59:00Z" }],
        },
      }],
    });
    await attachEvidenceToParent(
      exec,
      100,
      { rule_id: "ram_high", severity: "warning" },
      { available_mb: 100 },
      "subordinate",
      now,
    );
    const updateCall = writes.find((w) => w.sql.startsWith("UPDATE"));
    const evidenceParam = JSON.parse(updateCall!.params[1] as string);
    expect(evidenceParam.primary).toEqual({ used_mb: 32000 });
    expect(evidenceParam.attached).toHaveLength(2);
    expect(evidenceParam.attached[1].rule_id).toBe("ram_high");
  });

  it("no-ops on a non-existent parent alert", async () => {
    const { exec, writes } = mkExec({ rows: [] });
    await attachEvidenceToParent(
      exec,
      999,
      { rule_id: "x" },
      {},
      "subordinate",
      now,
    );
    const updateCall = writes.find((w) => w.sql.startsWith("UPDATE"));
    expect(updateCall).toBeUndefined();
  });
});

// =====================================================================
// Codex F1 (2026-05-22): route-after-resolve race regression.
//
// hostActiveAlerts is loaded BEFORE the routing loop runs. The resolver
// runs AFTER and sets resolved_at on any row whose alert_type is missing
// from currentTypes (and not in eventExclusions). If we don't prune the
// active-alerts snapshot to "types that will survive this ingest" before
// routing, a child rule firing this snapshot can attach as evidence to a
// parent that this same snapshot is about to resolve. Net outcome: parent
// disappears, child never emits standalone, the operator sees neither.
//
// These tests pin the prune helper's behavior so a future refactor can't
// silently re-introduce the race.
// =====================================================================

describe("pruneToSurvivingActiveAlerts — Codex F1 regression", () => {
  const now = new Date("2026-05-22T12:00:00Z");

  it("drops rows whose alert_type is missing from currentTypes (parent about to resolve)", () => {
    const rows: ActiveAlertRow[] = [
      mkActive({ id: 1, alert_type: "oom_kills", ageSeconds: 30, now }),
      mkActive({ id: 2, alert_type: "ram_high", ageSeconds: 30, now }),
    ];
    // Snapshot only emitted ram_high; oom_kills will get auto-resolved.
    const survivors = pruneToSurvivingActiveAlerts(
      rows,
      new Set(["ram_high"]),
      ["unexpected_reboot"],
    );
    expect(survivors.map((r) => r.alert_type)).toEqual(["ram_high"]);
  });

  it("keeps event-exclusion rows even when their type is missing from currentTypes", () => {
    // unexpected_reboot is always in eventExclusions; service_failed is in
    // eventExclusions only because the caller passed it through (event-rule
    // types observed this snapshot in real ingest, here we simulate a row
    // surviving because it's flagged as event-type).
    const rows: ActiveAlertRow[] = [
      mkActive({ id: 1, alert_type: "unexpected_reboot", ageSeconds: 30, now }),
      mkActive({ id: 2, alert_type: "service_failed", ageSeconds: 30, now }),
      mkActive({ id: 3, alert_type: "kernel_panic_dead_type", ageSeconds: 30, now }),
    ];
    const survivors = pruneToSurvivingActiveAlerts(
      rows,
      new Set<string>(), // no state-rule emissions this snapshot
      ["unexpected_reboot", "service_failed"],
    );
    expect(survivors.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("returns the empty list when nothing is going to survive", () => {
    const rows: ActiveAlertRow[] = [
      mkActive({ id: 1, alert_type: "x", ageSeconds: 30, now }),
      mkActive({ id: 2, alert_type: "y", ageSeconds: 30, now }),
    ];
    expect(pruneToSurvivingActiveAlerts(rows, new Set(), [])).toEqual([]);
  });

  it("preserves all rows when every type is present in currentTypes", () => {
    const rows: ActiveAlertRow[] = [
      mkActive({ id: 1, alert_type: "oom_kills", ageSeconds: 30, now }),
      mkActive({ id: 2, alert_type: "ram_high", ageSeconds: 30, now }),
    ];
    const survivors = pruneToSurvivingActiveAlerts(
      rows,
      new Set(["oom_kills", "ram_high"]),
      [],
    );
    expect(survivors).toHaveLength(2);
  });

  it("end-to-end: child does NOT attach to a parent missing from currentTypes", () => {
    // Re-enacts the failure mode end-to-end. Parent (oom_kills) is in the
    // DB snapshot but evaluator did not emit it this round; child (ram_high)
    // declares subordinate_to: oom_kills. Without the prune, child attaches
    // and parent gets resolved next — both invisible. With the prune, child
    // routes independently and gets its own active_alerts row.
    const rawHostActive: ActiveAlertRow[] = [
      mkActive({ id: 7, alert_type: "oom_kills", ageSeconds: 60, now }),
    ];
    const currentTypes = new Set(["ram_high"]); // parent missing
    const hostActive = pruneToSurvivingActiveAlerts(
      rawHostActive,
      currentTypes,
      ["unexpected_reboot"],
    );

    const decision = routeAlertEmission(
      mkAlert("ram_high"),
      "host-1",
      hostActive,
      now,
      { subordinate_to: "oom_kills" },
    );

    expect(decision.kind).toBe("emit_independent");
  });
});
