// memory_channels_underpopulated (DIMM topology Tier 1,
// CC_SPEC_DIMM_POPULATION_2026-07-04). Fixtures mirror the live validation
// fleet: the Gigabyte dual EPYC 7302 (4 of 8 channels per socket) and ASUS
// EPYC 9754 (8 of 12) must fire; the fully-populated EPYC 7443 (8/8) and
// 9355P (12/12) plus the 2-channel Xeon E boxes must stay silent.

import { describe, expect, it } from "vitest";
import { evaluateAlerts, type Snapshot } from "../evaluator";
import { healthySnapshot } from "./helpers";

type Topology = NonNullable<Snapshot["memory_topology"]>;
type Dimm = Topology["dimms"][number];

function dimm(overrides: Partial<Dimm> & { locator: string; channel: string | null; populated: boolean }): Dimm {
  return {
    bank_locator: null, socket: 0, slot: 1,
    size_mb: overrides.populated ? 32768 : null,
    rank: overrides.populated ? 2 : null,
    type: overrides.populated ? "DDR4" : null,
    speed_mts: overrides.populated ? 3200 : null,
    configured_mts: overrides.populated ? 3200 : null,
    manufacturer: null, part_number: overrides.populated ? "TESTPART" : null,
    ...overrides,
  };
}

function topology(dimms: Dimm[], extra: Partial<Topology> = {}): Topology {
  const populated = dimms.filter((d) => d.populated);
  const chans = (list: Dimm[]) => new Set(list.map((d) => d.channel).filter((c) => c !== null)).size;
  return {
    source: "dmidecode",
    total_slots: dimms.length,
    populated_slots: populated.length,
    available_channels: chans(dimms),
    populated_channels: chans(populated),
    downclocked: populated.some((d) => d.configured_mts !== null && d.speed_mts !== null && d.configured_mts < d.speed_mts),
    mixed_parts: false,
    dimms,
    ...extra,
  };
}

// Named alertsOf so the B-F8 rule-coverage-table test recognizes each call
// site as a positive/negative case for this rule.
function alertsOf(type: string, snap: Snapshot) {
  return evaluateAlerts(snap).filter((a) => a.type === type);
}

describe("memory_channels_underpopulated", () => {
  it("does not evaluate without memory_topology (VM / old agent)", () => {
    const s = healthySnapshot();
    delete s.memory_topology;
    expect(alertsOf("memory_channels_underpopulated", s)).toHaveLength(0);
  });

  it("stays silent on a fully-populated box (EPYC 7443, 8/8)", () => {
    const s = healthySnapshot();
    s.memory_topology = topology(
      ["A", "B", "C", "D", "E", "F", "G", "H"].map((c) => dimm({ locator: `DIMM${c}1`, channel: c, populated: true })),
    );
    expect(alertsOf("memory_channels_underpopulated", s)).toHaveLength(0);
  });

  it("stays silent on a 2-channel Xeon E with both channels populated", () => {
    const s = healthySnapshot();
    s.memory_topology = topology([
      dimm({ locator: "DIMMA1", channel: "0", populated: false }),
      dimm({ locator: "DIMMA2", channel: "0", populated: true }),
      dimm({ locator: "DIMMB1", channel: "1", populated: false }),
      dimm({ locator: "DIMMB2", channel: "1", populated: true }),
    ]);
    expect(alertsOf("memory_channels_underpopulated", s)).toHaveLength(0);
  });

  it("fires on the dual EPYC 7302 layout (4 of 8 channels per socket) with a per-socket split", () => {
    const s = healthySnapshot();
    const p0 = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const p1 = ["I", "J", "K", "L", "M", "N", "O", "P"];
    const pop = new Set(["A", "B", "E", "F", "I", "J", "M", "N"]);
    s.memory_topology = topology([
      ...p0.map((c) => dimm({ locator: `DIMM_P0_${c}0`, channel: c, socket: 0, populated: pop.has(c) })),
      ...p1.map((c) => dimm({ locator: `DIMM_P1_${c}0`, channel: c, socket: 1, populated: pop.has(c) })),
    ]);
    const out = alertsOf("memory_channels_underpopulated", s);
    expect(out).toHaveLength(1);
    // Under-population is a deliberate config tradeoff, and the rule's own
    // copy calls itself "advisory, not a fault" -> info, not a paging warning
    // (val campaign gigabyte + asus). Downclock-only stays warning (see below).
    expect(out[0].severity).toBe("info");
    expect(out[0].title).toBe("Memory channels under-populated: 8 of 16");
    expect(out[0].message).toContain("50% below");
    expect(out[0].message).toContain("socket 0: 4/8");
    const ev = out[0].evidence as Record<string, any>;
    expect(ev.per_socket).toHaveLength(2);
    expect(ev.per_socket[0].empty_channels).toEqual(["C", "D", "G", "H"]);
    expect(ev.per_socket[1].empty_channels).toEqual(["K", "L", "O", "P"]);
    // Tier 2: A,B,E,F doubles up on adjacent-pair controller groups (AB, EF)
    // while CD and GH sit idle - the "wrong 4" placement, flagged in both
    // message and evidence.
    expect(out[0].message).toContain("Placement compounds it");
    expect(ev.controller_clustering).toHaveLength(2);
    expect(ev.controller_clustering[0]).toMatchObject({ socket: 0, controller_groups: 4, groups_used: 2 });
    expect(ev.controller_clustering[0].idle_groups).toEqual(["CD", "GH"]);
  });

  it("does not flag placement when the same 4 DIMMs are spread one per controller group (A,C,E,G)", () => {
    const s = healthySnapshot();
    const chans = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const pop = new Set(["A", "C", "E", "G"]);
    s.memory_topology = topology(
      chans.map((c) => dimm({ locator: `DIMM_P0_${c}0`, channel: c, socket: 0, populated: pop.has(c) })),
    );
    const out = alertsOf("memory_channels_underpopulated", s);
    expect(out).toHaveLength(1); // still under-populated (4 of 8)...
    expect(out[0].message).not.toContain("Placement compounds it"); // ...but placed correctly
    expect((out[0].evidence as Record<string, any>).controller_clustering).toBeUndefined();
  });

  it("fires on the EPYC 9754 layout (8 of 12 channels, empty slots present)", () => {
    const s = healthySnapshot();
    const chans = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const pop = new Set(["A", "B", "C", "E", "G", "H", "I", "K"]);
    s.memory_topology = topology(
      chans.flatMap((c) => [
        dimm({ locator: `CPU1_DIMM_${c}1`, channel: c, populated: false }),
        dimm({ locator: `CPU1_DIMM_${c}2`, channel: c, populated: pop.has(c) }),
      ]),
    );
    const out = alertsOf("memory_channels_underpopulated", s);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Memory channels under-populated: 8 of 12");
    expect(out[0].message).toContain("33% below");
    // single socket: no per-socket breakdown in the message
    expect(out[0].message).not.toContain("socket 0:");
    // 12-channel triplet groups ABC/DEF/GHI/JKL all have at least one DIMM
    // here, so this is a count problem, not a placement problem.
    expect(out[0].message).not.toContain("Placement compounds it");
    expect((out[0].evidence as Record<string, any>).controller_clustering).toBeUndefined();
  });

  it("does NOT fire on a uniform 1DPC downclock (CPU/controller cap, not actionable) - EPYC 4004 val 2026-07-15", () => {
    // One DIMM per channel, matched parts, running below rated: this is the CPU
    // memory-controller's max supported speed (EPYC 4004/AM5 caps DDR5 at 5200
    // while the modules are rated 5600). No rebalance can raise it, so it is
    // benign and must stay silent.
    const s = healthySnapshot();
    const dimms = ["A", "B"].map((c) =>
      dimm({ locator: `DIMM${c}1`, channel: c, populated: true, speed_mts: 5600, configured_mts: 5200 }),
    );
    s.memory_topology = topology(dimms);
    expect(alertsOf("memory_channels_underpopulated", s)).toHaveLength(0);
  });

  it("fires on an actionable 2-DIMMs-per-channel downclock (rebalanceable)", () => {
    const s = healthySnapshot();
    // Channel A carries 2 DIMMs (2DPC), channel B carries 1: all channels are
    // populated (missing = 0), so the alert fires purely on the actionable
    // downclock. Rebalancing toward 1DPC can restore the rated speed.
    s.memory_topology = topology([
      dimm({ locator: "DIMMA1", channel: "A", slot: 1, populated: true, speed_mts: 3200, configured_mts: 2933 }),
      dimm({ locator: "DIMMA2", channel: "A", slot: 2, populated: true, speed_mts: 3200, configured_mts: 2933 }),
      dimm({ locator: "DIMMB1", channel: "B", slot: 1, populated: true, speed_mts: 3200, configured_mts: 2933 }),
    ]);
    const out = alertsOf("memory_channels_underpopulated", s);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Memory running below rated speed");
    expect(out[0].severity).toBe("warning");
    expect(out[0].message).toContain("rated 3200 MT/s are running at 2933 MT/s");
    expect(out[0].message).toContain("2-DIMMs-per-channel");
    const ev = out[0].evidence as Record<string, any>;
    expect(ev.downclock_actionable).toBe(true);
    expect(ev.downclock_worst.configured_mts).toBe(2933);
  });

  it("fires on a mixed-parts downclock at 1DPC (replaceable)", () => {
    const s = healthySnapshot();
    // One DIMM per channel but mismatched parts force the slowest common speed;
    // installing matched DIMMs can restore it, so this is actionable.
    s.memory_topology = topology(
      ["A", "B"].map((c) =>
        dimm({ locator: `DIMM${c}1`, channel: c, populated: true, speed_mts: 3200, configured_mts: 2933 }),
      ),
      { mixed_parts: true },
    );
    const out = alertsOf("memory_channels_underpopulated", s);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Memory running below rated speed");
    expect(out[0].message).toContain("mixed DIMM parts");
    const ev = out[0].evidence as Record<string, any>;
    expect(ev.downclock_actionable).toBe(true);
  });

  it("skips degenerate reads (zero populated slots)", () => {
    const s = healthySnapshot();
    s.memory_topology = topology([dimm({ locator: "DIMMA1", channel: "A", populated: false })]);
    expect(alertsOf("memory_channels_underpopulated", s)).toHaveLength(0);
  });
});
