import { describe, expect, it } from "vitest";
import { applyCorrelationRules } from "../correlation";
import type { Finding } from "../types";
import { baseDrive, baseNvme, baseFeatures } from "./fixtures";

function smartFinding(serial = "ZCH0ABCD"): Finding {
  return {
    type: "smart_5_growing",
    severity: "medium",
    resource: { kind: "drive", name: "/dev/sda", serial, model: "ST12000NM0007", vendor: "Seagate" },
    contributing_metrics: [],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline: null,
    evidence_summary: "SMART 5 growing",
  };
}

describe("correlation rule 1 (storage + ZFS)", () => {
  it("escalates SMART + ZFS checksum errors on same device", () => {
    const finding = smartFinding();
    const features = baseFeatures({
      drives: [baseDrive({ serial: "ZCH0ABCD" })],
      zfs: [{ pool: "tank", device: "sda", device_serial: "ZCH0ABCD", cksum_errors: 7, read_errors: 0, write_errors: 0 }],
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("smart_plus_zfs");
    expect(escalated[0].severity).toBe("high");
  });

  it("does not correlate with ZFS errors on a different device", () => {
    const finding = smartFinding();
    const features = baseFeatures({
      drives: [baseDrive({ serial: "ZCH0ABCD" })],
      zfs: [{ pool: "tank", device: "sdb", device_serial: "OTHER", cksum_errors: 7, read_errors: 0, write_errors: 0 }],
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBeNull();
  });

  it("correlates SMART + elevated latency on the same drive", () => {
    const finding = smartFinding();
    const features = baseFeatures({
      drives: [baseDrive({ serial: "ZCH0ABCD", p99_read_latency_ms: 40, latency_baseline_30d: 10 })],
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("smart_plus_latency");
  });
});

describe("correlation rule 2 (nvme fail-slow)", () => {
  it("escalates nvme_fail_slow_candidate when health signal present", () => {
    const finding: Finding = {
      type: "nvme_fail_slow_candidate",
      severity: "medium",
      resource: { kind: "nvme", name: "/dev/nvme0n1", serial: "NVME0001", model: "X", vendor: "Y" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "",
    };
    const features = baseFeatures({
      drives: [baseNvme({ serial: "NVME0001", nvme_media_errors_delta_7d: 3 })],
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("nvme_fail_slow_confirmed");
    expect(escalated[0].severity).toBe("high");
  });
});

describe("correlation rule 3 (cooling failure)", () => {
  it("upgrades fan_rpm_decline when CPU/exhaust temp is rising", () => {
    const finding: Finding = {
      type: "fan_rpm_decline",
      severity: "medium",
      resource: { kind: "fan", name: "FAN1" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "Fan decline",
      requires_correlation: true,
    };
    const features = baseFeatures({
      ipmi: {
        fans: [], psu_rails: [],
        temps: [{ name: "CPU1 Temp", current_c: 70, delta_7d: 5 }],
      },
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("cooling_failure");
    expect(escalated[0].severity).toBe("high");
  });

  it("observes fan_rpm_decline without temp corroboration", () => {
    const finding: Finding = {
      type: "fan_rpm_decline",
      severity: "medium",
      resource: { kind: "fan", name: "FAN1" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "Fan decline",
      requires_correlation: true,
    };
    const features = baseFeatures();
    const { escalated, observations } = applyCorrelationRules([finding], features);
    expect(escalated).toHaveLength(0);
    expect(observations).toHaveLength(1);
  });
});

describe("correlation rule 4 (NIC hardware)", () => {
  it("escalates NIC errors + TCP retransmits", () => {
    const finding: Finding = {
      type: "nic_errors",
      severity: "medium",
      resource: { kind: "nic", name: "eth0" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "",
      requires_correlation: true,
    };
    const features = baseFeatures({
      network: [{ iface: "eth0", crc_errors_delta_7d: 20, frame_errors_delta_7d: 5, tcp_retransmits_delta_7d: 500 }],
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("nic_hardware");
    expect(escalated[0].severity).toBe("high");
  });

  it("observes NIC errors with no retransmits", () => {
    const finding: Finding = {
      type: "nic_errors",
      severity: "medium",
      resource: { kind: "nic", name: "eth0" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "",
      requires_correlation: true,
    };
    const features = baseFeatures({
      network: [{ iface: "eth0", crc_errors_delta_7d: 20, frame_errors_delta_7d: 5, tcp_retransmits_delta_7d: 10 }],
    });
    const { escalated, observations } = applyCorrelationRules([finding], features);
    expect(escalated).toHaveLength(0);
    expect(observations).toHaveLength(1);
  });
});

describe("correlation rule 6 (PSU pre-failure)", () => {
  it("adds correlation when PSU temp rising with rail out-of-spec", () => {
    const finding: Finding = {
      type: "psu_rail_out_of_spec",
      severity: "high",
      resource: { kind: "psu", name: "12V" },
      contributing_metrics: [],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: "Rail out of spec",
    };
    const features = baseFeatures({
      ipmi: {
        fans: [], psu_rails: [],
        temps: [{ name: "PSU1 Temp", current_c: 60, delta_7d: 8 }],
      },
    });
    const { escalated } = applyCorrelationRules([finding], features);
    expect(escalated[0].correlation_match).toBe("psu_prefailure");
  });
});
