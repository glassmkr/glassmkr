// Codex F2 review 2026-05-22 regression tests.
//
// Pins the shape that extractIpmiFeatures + extractNetworkFeatures expect
// from the JSON columns. Before this fix:
//
//   - IPMI extractor treated rows.ipmi as `IpmiSensor[]`, but Crucible's
//     snapshot schema (ingest/snapshot-schema.ts:139) wraps the array in
//     `{ available, sensors: [...] }`. safeParse returned `[]`; fan/PSU/temp
//     trend warnings were dead fleet-wide.
//
//   - Network extractor read `entry.iface`, but the schema field is
//     `interface`. The 7-day lookup always missed and every delta was 0.
//
// These tests construct two synthetic snapshots and assert the extractors
// produce the expected derived metrics. They also cover the legacy bare-array
// IPMI shape (older ClickHouse rows pre-0.8.0) and the legacy `iface` network
// key, since the production ClickHouse history holds both shapes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractDriveFeatures,
  extractIpmiFeatures,
  extractNetworkFeatures,
  guessNominalVoltage,
  type TwSnapshotRow,
} from "../features";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function row(
  tsOffsetMs: number,
  patch: Partial<Record<"ipmi" | "network" | "smart" | "disks" | "zfs" | "io_latency", string>> = {},
): TwSnapshotRow {
  return {
    timestamp: NOW + tsOffsetMs,
    smart: patch.smart ?? "[]",
    disks: patch.disks ?? "[]",
    ipmi: patch.ipmi ?? "{}",
    network: patch.network ?? "[]",
    zfs: patch.zfs ?? "[]",
    io_latency: patch.io_latency,
  } as TwSnapshotRow;
}

describe("extractDriveFeatures — recurrence counting (flaky SMART)", () => {
  const driveSmart = (pending: number) =>
    JSON.stringify([{ device: "/dev/sdb", serial: "SN123", model: "CT500MX500SSD1", pending_sectors: pending }]);

  it("counts distinct 0->nonzero pending-sector episodes; raw reflects the latest snapshot", () => {
    // Flickers 0,1,0,1,0,1,0 across the window: three rising edges, currently clear.
    const rows = [0, 1, 0, 1, 0, 1, 0].map((p, i) => row(i * DAY, { smart: driveSmart(p) }));
    const [d] = extractDriveFeatures(rows);
    expect(d.smart_197_recurrence_count).toBe(3);
    expect(d.smart_197_raw).toBe(0);
  });

  it("counts a single held episode (nonzero across consecutive snapshots) once", () => {
    const rows = [0, 1, 1, 1, 0].map((p, i) => row(i * DAY, { smart: driveSmart(p) }));
    expect(extractDriveFeatures(rows)[0].smart_197_recurrence_count).toBe(1);
  });

  it("is zero for an always-healthy drive", () => {
    const rows = [0, 0, 0].map((p, i) => row(i * DAY, { smart: driveSmart(p) }));
    expect(extractDriveFeatures(rows)[0].smart_197_recurrence_count).toBe(0);
  });
});

describe("extractDriveFeatures — pre-expansion snapshots are not a zero baseline (2026-07-16)", () => {
  // The Crucible 0.13.25 roll adds 187/188/189/198 (and more) to smart[].
  // Rows written by an older agent LACK those keys. They must read as "not
  // collected" (no reference point, no series point), never as 0: a drive
  // with a longstanding nonzero 187 would otherwise compute delta = raw and
  // burst = raw on roll day, firing a fleet-wide wave of false
  // first-appearance / step-change / burst trend warnings for a full window.
  //
  // burstMax anchors its 7-day window to Date.now() (via
  // largestPositiveStepInWindow), so the fixtures MUST sit relative to a
  // pinned clock at NOW, or every point falls outside the window and the
  // burst assertions pass vacuously (Codex P3, 2026-07-16). Pin the clock.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const preRoll = JSON.stringify([
    { device: "/dev/sda", serial: "SN9", model: "ST12000NM0007" },
  ]);
  const postRoll = (v: number) =>
    JSON.stringify([
      {
        device: "/dev/sda",
        serial: "SN9",
        model: "ST12000NM0007",
        reported_uncorrectable: v,
        command_timeout: v,
        high_fly_writes: v,
        offline_uncorrectable: v,
      },
    ]);

  it("computes zero deltas and zero burst when every reference predates collection", () => {
    // -3d and -1d are inside the 7-day burst window. Without the guard they
    // read as 187=0, so 0 -> 60 at t=0 would produce burst 60; the guard skips
    // the field-less pre-roll entries, leaving one 187 point and burst 0.
    const rows = [
      row(-14 * DAY, { smart: preRoll }),
      row(-3 * DAY, { smart: preRoll }),
      row(-1 * DAY, { smart: preRoll }),
      row(0, { smart: postRoll(60) }),
    ];
    const [d] = extractDriveFeatures(rows);
    expect(d.smart_187_raw).toBe(60);
    expect(d.smart_187_delta_1d).toBe(0);
    expect(d.smart_187_delta_7d).toBe(0);
    expect(d.smart_187_delta_30d).toBe(0);
    expect(d.smart_187_burst_max_7d).toBe(0);
    expect(d.smart_188_delta_7d).toBe(0);
    expect(d.smart_188_burst_max_7d).toBe(0);
    expect(d.smart_189_burst_max_7d).toBe(0);
    expect(d.smart_198_delta_7d).toBe(0);
  });

  it("still measures a genuine post-roll increase (delta AND burst) against a post-roll reference", () => {
    // -7d gives ref7d; -5d and 0d are both in the burst window so the 60 -> 64
    // step is measured (not masked by a boundary or the guard).
    const rows = [
      row(-14 * DAY, { smart: preRoll }),
      row(-7 * DAY, { smart: postRoll(60) }),
      row(-5 * DAY, { smart: postRoll(60) }),
      row(0, { smart: postRoll(64) }),
    ];
    const [d] = extractDriveFeatures(rows);
    expect(d.smart_187_raw).toBe(64);
    expect(d.smart_187_delta_7d).toBe(4);
    expect(d.smart_187_burst_max_7d).toBe(4);
    expect(d.smart_198_delta_7d).toBe(4);
  });
});

describe("extractDriveFeatures — NVMe fields use the collector contract names (Codex P1, 2026-07-16)", () => {
  // The trend engine previously read `critical_warning`, `available_spare`,
  // and `available_spare_threshold`, but the collector emits (and ClickHouse
  // stores verbatim) `critical_warning_raw`, `nvme_available_spare`, and
  // `nvme_available_spare_threshold`. The mismatch zeroed every value and left
  // the NVMe critical-warning + spare triggers dead. This uses a real
  // collector-shaped entry to prove the names now line up.
  it("extracts critical_warning and spare from the collector-emitted field names", () => {
    const collectorShaped = JSON.stringify([
      {
        device: "/dev/nvme0n1",
        serial: "NVME1",
        model: "Samsung PM9A3",
        health: "PASSED",
        percentage_used: 4,
        critical_warning_raw: 8, // bit 3 = read-only mode
        nvme_available_spare: 7,
        nvme_available_spare_threshold: 10,
        media_errors: 0,
      },
    ]);
    const rows = [row(-7 * DAY, { smart: collectorShaped }), row(0, { smart: collectorShaped })];
    const [d] = extractDriveFeatures(rows);
    expect(d.nvme_critical_warning).toBe(8);
    expect(d.nvme_available_spare).toBe(7);
    expect(d.nvme_available_spare_threshold).toBe(10);
  });
});

describe("extractIpmiFeatures — Codex F2 shape regression", () => {
  it("reads sensors from the current {available, sensors} object shape", () => {
    const oldSensors = JSON.stringify({
      available: true,
      sensors: [
        { name: "FAN1", value: 6000, unit: "RPM", status: "ok" },
        { name: "12V", value: 12.1, unit: "Volts", status: "ok" },
        { name: "CPU Temp", value: 60, unit: "degrees C", status: "ok" },
      ],
    });
    const newSensors = JSON.stringify({
      available: true,
      sensors: [
        { name: "FAN1", value: 5400, unit: "RPM", status: "ok" }, // dropped 600 RPM
        { name: "12V", value: 11.8, unit: "Volts", status: "ok" }, // drift
        { name: "CPU Temp", value: 72, unit: "degrees C", status: "ok" }, // up 12C
      ],
    });
    const rows = [
      row(-14 * DAY, { ipmi: oldSensors }),
      row(-7 * DAY, { ipmi: oldSensors }),
      row(0, { ipmi: newSensors }),
    ];

    const out = extractIpmiFeatures(rows);

    expect(out.fans.length).toBe(1);
    expect(out.fans[0]!.name).toBe("FAN1");
    expect(out.fans[0]!.rpm).toBe(5400);
    expect(out.fans[0]!.rpm_delta_14d).toBe(-600);

    expect(out.psu_rails.length).toBe(1);
    expect(out.psu_rails[0]!.nominal_v).toBe(12);
    expect(out.psu_rails[0]!.current_v).toBe(11.8);

    expect(out.temps.length).toBe(1);
    expect(out.temps[0]!.name).toBe("CPU Temp");
    expect(out.temps[0]!.delta_7d).toBe(12);
  });

  it("falls back to the legacy bare-array shape (pre-Crucible 0.8.0 snapshots)", () => {
    const sensors = JSON.stringify([
      { name: "FAN1", value: 4800, unit: "RPM", status: "ok" },
    ]);
    const rows = [row(-14 * DAY, { ipmi: sensors }), row(0, { ipmi: sensors })];

    const out = extractIpmiFeatures(rows);

    expect(out.fans.length).toBe(1);
    expect(out.fans[0]!.rpm).toBe(4800);
  });

  it("excludes battery sensors (VBAT, CMOS) from psu_rails — 2026-05-23 noise-fix", () => {
    // mz62hd was paging psu_rail_drift on P_VBAT=3.095V because
    // `guessNominalVoltage` assigned a 3.3V "rail" nominal to the CMOS
    // coin-cell. CR2032 batteries sit at 2.7-3.3V healthy and use an
    // entirely different remediation. They should never appear in
    // psu_rails.
    const sensors = JSON.stringify({
      available: true,
      sensors: [
        { name: "P_VBAT", value: 3.095, unit: "Volts", status: "ok" },
        { name: "VBAT", value: 3.0, unit: "Volts", status: "ok" },
        { name: "CMOS_BAT", value: 3.1, unit: "Volts", status: "ok" },
        { name: "VCC_BAT", value: 3.1, unit: "Volts", status: "ok" },
        // Real PSU rail should still pass through.
        { name: "P_12V", value: 12.05, unit: "Volts", status: "ok" },
      ],
    });
    const rows = [row(-14 * DAY, { ipmi: sensors }), row(0, { ipmi: sensors })];

    const out = extractIpmiFeatures(rows);

    expect(out.psu_rails.length).toBe(1);
    expect(out.psu_rails[0]!.rail).toBe("P_12V");
  });

  it("assigns BMC-internal rails their parsed nominal so drift stays near zero — 2026-05-29 name-parse fix", () => {
    // gpu-1 and the production host (prod) were paging psu_rail_drift HIGH
    // on "BMC 2.5V" / "2.5V BMC" sensors, and val-RTXA4000 re-confirmed it
    // live on a healthy 2.51V rail. Root cause: `guessNominalVoltage` only
    // knew 12V / 5V / 3.3V by name and guessed everything else by value
    // range, so a 2.5V rail landed in the 2.5-4V band and was assigned
    // nominal=3.3, producing a fake ~24% drift HIGH. The 2026-05-29 fix
    // parses the explicit voltage out of the sensor name, so these BMC
    // rails now get their correct nominal and a near-zero drift; they no
    // longer page. (They are real, in-spec rails: capture them honestly
    // rather than dropping them.)
    const sensors = JSON.stringify({
      available: true,
      sensors: [
        // The reported false-positive shapes, now correctly nominal'd.
        { name: "BMC 2.5V", value: 2.428, unit: "Volts", status: "ok" },
        { name: "2.5V BMC", value: 2.485, unit: "Volts", status: "ok" },
        { name: "BMC 1.8V", value: 1.79, unit: "Volts", status: "ok" },
        { name: "BMC 1.2V", value: 1.20, unit: "Volts", status: "ok" },
        { name: "BMC 1.0V", value: 1.00, unit: "Volts", status: "ok" },
        { name: "VBMC 1.2V", value: 1.21, unit: "Volts", status: "ok" },
        // Real ATX PSU rails should still pass through unchanged.
        { name: "P_12V", value: 12.05, unit: "Volts", status: "ok" },
        { name: "P_5V", value: 5.02, unit: "Volts", status: "ok" },
        { name: "P_3V3", value: 3.31, unit: "Volts", status: "ok" },
        { name: "+5V_STBY", value: 5.12, unit: "Volts", status: "ok" },
      ],
    });
    const rows = [row(-14 * DAY, { ipmi: sensors }), row(0, { ipmi: sensors })];

    const out = extractIpmiFeatures(rows);
    const byRail = new Map(out.psu_rails.map((r) => [r.rail, r]));

    // The previously-misclassified BMC rails now carry their correct
    // nominal and a near-zero drift, so they sit far below the 5%/8%
    // paging thresholds.
    expect(byRail.get("BMC 2.5V")!.nominal_v).toBe(2.5);
    expect(byRail.get("2.5V BMC")!.nominal_v).toBe(2.5);
    expect(byRail.get("BMC 1.8V")!.nominal_v).toBe(1.8);
    expect(byRail.get("BMC 1.2V")!.nominal_v).toBe(1.2);
    expect(byRail.get("VBMC 1.2V")!.nominal_v).toBe(1.2);
    for (const r of out.psu_rails) {
      expect(r.deviation_pct).toBeLessThan(0.05);
    }

    // Real ATX rails keep their expected nominals.
    expect(byRail.get("P_12V")!.nominal_v).toBe(12);
    expect(byRail.get("P_5V")!.nominal_v).toBe(5);
    expect(byRail.get("P_3V3")!.nominal_v).toBe(3.3);
    expect(byRail.get("+5V_STBY")!.nominal_v).toBe(5);
  });

  it("does not produce a psu_rail_out_of_spec-grade deviation for a healthy 2.5V BMC rail at 2.51V — val-RTXA4000 regression", () => {
    // The exact live false-positive: "2.5V BMC" reading 2.51V, status ok,
    // was paging SOON/HIGH because nominal was guessed as 3.3 (deviation =
    // |2.51 - 3.3| / 3.3 = ~24%). With name-parsing the nominal is 2.5, so
    // deviation = |2.51 - 2.5| / 2.5 = ~0.4%, well under both the 5%
    // (medium) and 8% (high) thresholds in triggers.ts.
    const sensors = JSON.stringify({
      available: true,
      sensors: [{ name: "2.5V BMC", value: 2.51, unit: "Volts", status: "ok" }],
    });
    const rows = [row(-14 * DAY, { ipmi: sensors }), row(-7 * DAY, { ipmi: sensors }), row(0, { ipmi: sensors })];

    const out = extractIpmiFeatures(rows);
    expect(out.psu_rails).toHaveLength(1);
    const rail = out.psu_rails[0]!;
    expect(rail.nominal_v).toBe(2.5);
    expect(rail.deviation_pct).toBeCloseTo(0.004, 3);
    expect(rail.deviation_pct).toBeLessThan(0.05);
  });

  it("returns empty when ipmi is unavailable or malformed", () => {
    expect(extractIpmiFeatures([])).toEqual({ fans: [], psu_rails: [], temps: [] });
    expect(
      extractIpmiFeatures([row(0, { ipmi: JSON.stringify({ available: false, sensors: [] }) })]),
    ).toEqual({ fans: [], psu_rails: [], temps: [] });
    expect(extractIpmiFeatures([row(0, { ipmi: "not-json" })])).toEqual({
      fans: [],
      psu_rails: [],
      temps: [],
    });
  });
});

describe("guessNominalVoltage — parse explicit voltage from sensor name (2026-05-29)", () => {
  // THE regression case: a healthy 2.5V BMC rail at 2.51V must resolve to a
  // 2.5 nominal, not 3.3 (which would fake a ~24% drift HIGH on val-RTXA4000).
  it("parses 2.5 from '2.5V BMC' (was: 3.3 from the value-range heuristic)", () => {
    expect(guessNominalVoltage("2.5V BMC", 2.51)).toBe(2.5);
  });

  it("parses the 5V rail across its common name shapes", () => {
    expect(guessNominalVoltage("+5V", 5.02)).toBe(5);
    expect(guessNominalVoltage("P_5V", 4.98)).toBe(5);
    expect(guessNominalVoltage("5V_STBY", 5.12)).toBe(5);
    expect(guessNominalVoltage("5VSB", 5.10)).toBe(5);
  });

  it("parses the 12V rail across its common name shapes", () => {
    expect(guessNominalVoltage("P_12V", 12.1)).toBe(12);
    expect(guessNominalVoltage("+12V", 11.9)).toBe(12);
  });

  it("parses 3.3V including the 3V3 alt spelling", () => {
    expect(guessNominalVoltage("P_3V3", 3.31)).toBe(3.3);
    expect(guessNominalVoltage("+3V3", 3.28)).toBe(3.3);
    expect(guessNominalVoltage("3.3V", 3.31)).toBe(3.3);
  });

  it("treats bare '3V'/'3VSB' as the 3.3V rail, not 3.0 (2026-07-14 asrock FP)", () => {
    // A rail named "3V" reading ~3.34 is the 3.3V rail; scoring it against a
    // 3.0 nominal faked ~11% out-of-spec. 3.0V is not a standard PSU rail.
    expect(guessNominalVoltage("3V", 3.34)).toBe(3.3);
    expect(guessNominalVoltage("3VSB", 3.30)).toBe(3.3);
    expect(guessNominalVoltage("+3V", 3.31)).toBe(3.3);
    // An explicit "3.0V" (with the decimal) is left as 3.0.
    expect(guessNominalVoltage("3.0V", 3.02)).toBe(3.0);
  });

  it("parses low-voltage VRM/PCH rails by name", () => {
    expect(guessNominalVoltage("1.8V VRM", 1.79)).toBe(1.8);
    expect(guessNominalVoltage("1.05V PCH", 1.04)).toBe(1.05);
  });

  it("falls back to the value-range heuristic when the name has no voltage token", () => {
    expect(guessNominalVoltage("VR_OUT", 11.9)).toBe(12);
    expect(guessNominalVoltage("VOLT_SENSOR", 5.1)).toBe(5);
  });

  it("returns 0 (unknown/skip) for a name-less rail whose value is outside every heuristic band", () => {
    expect(guessNominalVoltage("VCORE", 0.95)).toBe(0);
  });
});

describe("extractNetworkFeatures — Codex F2 field-name regression", () => {
  it("reads the schema-canonical `interface` field and computes the 7-day delta", () => {
    const oldNet = JSON.stringify([
      { interface: "eth0", rx_errors: 100, tx_errors: 5 },
    ]);
    const newNet = JSON.stringify([
      { interface: "eth0", rx_errors: 130, tx_errors: 8 },
    ]);
    const rows = [row(-7 * DAY, { network: oldNet }), row(0, { network: newNet })];

    const out = extractNetworkFeatures(rows);

    expect(out.length).toBe(1);
    expect(out[0]!.iface).toBe("eth0");
    expect(out[0]!.crc_errors_delta_7d).toBe(30);
    expect(out[0]!.frame_errors_delta_7d).toBe(3);
  });

  it("falls back to the legacy `iface` key for pre-rename snapshots", () => {
    const oldNet = JSON.stringify([{ iface: "eth0", rx_errors: 100, tx_errors: 5 }]);
    const newNet = JSON.stringify([{ iface: "eth0", rx_errors: 120, tx_errors: 5 }]);
    const rows = [row(-7 * DAY, { network: oldNet }), row(0, { network: newNet })];

    const out = extractNetworkFeatures(rows);

    expect(out.length).toBe(1);
    expect(out[0]!.iface).toBe("eth0");
    expect(out[0]!.crc_errors_delta_7d).toBe(20);
  });

  it("skips entries with no interface name and never emits iface === undefined", () => {
    const net = JSON.stringify([
      { rx_errors: 50, tx_errors: 1 }, // no name -> skip
      { interface: "eth1", rx_errors: 7, tx_errors: 0 },
    ]);
    const rows = [row(-7 * DAY, { network: net }), row(0, { network: net })];

    const out = extractNetworkFeatures(rows);

    expect(out.length).toBe(1);
    expect(out[0]!.iface).toBe("eth1");
    for (const e of out) {
      expect(typeof e.iface).toBe("string");
      expect(e.iface.length).toBeGreaterThan(0);
    }
  });
});
