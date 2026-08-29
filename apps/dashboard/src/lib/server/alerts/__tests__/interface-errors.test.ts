import { describe, expect, it } from "vitest";
import { evaluateInterfaceErrors, type Snapshot } from "../evaluator";

function baseSnap(overrides: { network: any[]; firewall?: boolean } = { network: [] }): Snapshot {
  return {
    system: { uptime_seconds: 100000 } as any,
    network: overrides.network,
    security: { firewall: { active: overrides.firewall ?? false } as any } as any,
  } as unknown as Snapshot;
}

function iface(name: string, o: Partial<{
  rx_errors: number; tx_errors: number;
  rx_crc_errors: number; rx_frame_errors: number; rx_length_errors: number;
  tx_carrier_errors: number;
  rx_drops: number; tx_drops: number;
  rx_packets: number; tx_packets: number;
  bond_master: string; is_bond_master: boolean;
}> = {}) {
  return {
    interface: name,
    rx_errors: 0, tx_errors: 0,
    rx_drops: 0, tx_drops: 0,
    rx_packets: 0, tx_packets: 0,
    ...o,
  };
}

describe("evaluateInterfaceErrors", () => {
  it("1. zero errors on all interfaces: no alerts", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_packets: 100_000, tx_packets: 100_000 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("none");
  });

  it("2. 1 error at high packet count (below 0.01%): yellow, no alert", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 1, rx_packets: 1_000_000, tx_packets: 1_000_000 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("yellow");
  });

  it("3. 1 error at very low packet count (<1,000): yellow, no alert via minimum-traffic gate", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 1, rx_packets: 200, tx_packets: 200 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("yellow");
  });

  it("4. 15 errors at 100k packets (0.015%), sustained across 2 intervals: orange alert", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 15, rx_packets: 100_000, tx_packets: 0 })] });
    const prev = [iface("eth0", { rx_errors: 12, rx_packets: 100_000 })];
    const { alerts, classifications } = evaluateInterfaceErrors(snap, prev);
    expect(classifications[0].tier).toBe("orange");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("Sustained across 2 consecutive intervals");
  });

  it("5. 15 errors at 100k packets (0.015%), previous interval clean: yellow, no page", () => {
    // A single-interval ratio blip must not page. Real case 2026-07-01
    // (datapacketvastlistings-17): 4 errors / 22,533 packets = 0.018% paged
    // orange from one interval, then auto-resolved 5 minutes later. The
    // ratio branch now requires errors in the previous interval too.
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 15, rx_packets: 100_000, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, []);
    expect(classifications[0].tier).toBe("yellow");
    expect(alerts).toHaveLength(0);
  });

  it("5c. 15 errors at 100k packets with errors in the previous interval: orange via ratio branch", () => {
    // Same ratio as case 5, but the previous interval also saw errors (any
    // nonzero count): a continuing physical-layer fault, so orange stands
    // even though the absolute branch (>=10 in both intervals) is not met.
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 15, rx_packets: 100_000, tx_packets: 0 })] });
    const prev = [iface("eth0", { rx_errors: 2, rx_packets: 100_000 })];
    const { alerts, classifications } = evaluateInterfaceErrors(snap, prev);
    expect(classifications[0].tier).toBe("orange");
    expect(alerts).toHaveLength(1);
  });

  it("5b. 15 errors at 500 packets (below ratio floor), previous 0 errors: yellow, no alert", () => {
    // Below MIN_PACKETS_FOR_RATIO (1,000) neither ratio branch applies, and the
    // sustained absolute-count branch requires prev >=10, so this stays yellow.
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 15, rx_packets: 500, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, [iface("eth0", { rx_errors: 0 })]);
    expect(classifications[0].tier).toBe("yellow");
    expect(alerts).toHaveLength(0);
  });

  it("6. 10 errors per interval sustained 2 intervals, idle interface (<1k packets): orange via absolute branch", () => {
    // Packets under MIN_PACKETS_FOR_RATIO bypass both ratio branches; the
    // absolute-count branch at >=10 errors sustained across 2 intervals is
    // the only path that can raise the tier past yellow here.
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 10, rx_packets: 400, tx_packets: 200 })] });
    const prev = [iface("eth0", { rx_errors: 10 })];
    const { alerts, classifications } = evaluateInterfaceErrors(snap, prev);
    expect(classifications[0].tier).toBe("orange");
    expect(alerts).toHaveLength(1);
  });

  it("7. 150 errors in one interval: red regardless of ratio or sustain", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 150, rx_packets: 0, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(classifications[0].tier).toBe("red");
    expect(alerts[0].severity).toBe("critical");
  });

  it("8. 3 errors at 2k packets (0.15%): yellow, not red (volume floors)", () => {
    // Old behavior: red critical page from 3 error ticks, because 0.15% >=
    // 0.1% cleared the bare 1,000-packet ratio floor (at that floor 0.1% is
    // literally ONE error). Red via ratio now requires >= 10,000 packets
    // AND >= 10 errors; tiny counts stay yellow (dashboard-only).
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 3, rx_packets: 2_000, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(classifications[0].tier).toBe("yellow");
    expect(alerts).toHaveLength(0);
  });

  it("8b. 25 errors at 20k packets (0.125%): red via ratio with real volume", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 25, rx_packets: 20_000, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(classifications[0].tier).toBe("red");
    expect(alerts[0].severity).toBe("critical");
  });

  it("8c. aggregate + subtype counters are not double-counted", () => {
    // datapacketvastlistings-17 2026-07-01: rx_errors=2 and rx_length_errors=2
    // (the driver folds subtypes into the aggregate) was reported as "4
    // hardware errors" for 2 bad frames.
    const snap = baseSnap({ network: [iface("eth0", { rx_errors: 2, rx_length_errors: 2, rx_packets: 20_609, tx_packets: 1_924 })] });
    const { classifications } = evaluateInterfaceErrors(snap, []);
    expect(classifications[0].errors).toBe(2);
    expect(classifications[0].tier).toBe("yellow");
  });

  it("9. bond slave with errors: alert names the slave, not the master", () => {
    const net = [
      iface("bond0", { is_bond_master: true }),
      iface("enp1s0f0", { bond_master: "bond0", rx_errors: 12, rx_packets: 66_412, tx_packets: 0 }),
    ];
    const snap = baseSnap({ network: net });
    const prev = [iface("enp1s0f0", { bond_master: "bond0", rx_errors: 10 })];
    const { alerts, classifications } = evaluateInterfaceErrors(snap, prev);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("enp1s0f0 (slave of bond0)");
    // Bond master classification is always "none" (we evaluate per-slave).
    const bondCls = classifications.find(c => c.interface === "bond0");
    expect(bondCls?.tier).toBe("none");
  });

  it("10. bond master with aggregated errors is ignored (per-slave only)", () => {
    const snap = baseSnap({ network: [iface("bond0", { is_bond_master: true, rx_errors: 99, rx_packets: 1_000_000 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("none");
  });

  it("11. drops on firewalled bond: suppressed", () => {
    const net = [iface("bond0", { is_bond_master: true, rx_drops: 5000, rx_packets: 100_000 })];
    const snap = baseSnap({ network: net, firewall: true });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("none");
  });

  it("11b. drops on any interface with firewall active: suppressed", () => {
    // Spec: "suppress drop alerts entirely on bond masters and interfaces
    // where a firewall is active". the GPU host hits this path.
    const snap = baseSnap({ network: [iface("enp2s0f0", { rx_drops: 120, rx_packets: 8_766, tx_packets: 0 })], firewall: true });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(alerts).toHaveLength(0);
    expect(classifications[0].tier).toBe("none");
  });

  it("12. drops on standalone interface above 1% ratio, no firewall: orange, message talks about drops", () => {
    const snap = baseSnap({ network: [iface("eth0", { rx_drops: 2_000, rx_packets: 100_000, tx_packets: 0 })] });
    const { alerts, classifications } = evaluateInterfaceErrors(snap, null);
    expect(classifications[0].tier).toBe("orange");
    expect(classifications[0].driver).toBe("drops");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].title).toContain("2000 packet drops");
    expect(alerts[0].title).not.toContain("hardware errors");
    expect(alerts[0].message).toContain("2000 drops over 5 min");
  });
});
