// Correlation rules (Stage 3).
//
// A finding alone becomes a dashboard-only observation unless it matches a
// correlation rule here. Each rule requires two independent signals tied by a
// causal mechanism. Findings that pass correlation are escalated to notifications.
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 3

import type { Finding, ServerFeatures } from "./types";

function upgradeSeverity(current: "high" | "medium"): "high" {
  return "high";
}

/**
 * Apply correlation rules to all findings for a server. Findings that match
 * a rule get their correlation_match field set and may have their severity
 * upgraded. Findings that require correlation but don't match are dropped
 * (returned separately as observations).
 */
export function applyCorrelationRules(
  findings: Finding[],
  features: ServerFeatures
): { escalated: Finding[]; observations: Finding[] } {
  const escalated: Finding[] = [];
  const observations: Finding[] = [];

  for (const finding of findings) {
    let matched = false;

    // Rule 1: Storage device degradation (SMART + ZFS or SMART + latency)
    if (finding.type.startsWith("smart_") || finding.type.startsWith("nvme_")) {
      const serial = finding.resource.serial;

      // Check for ZFS checksum errors on the same device. Prefer the
      // serial-based join; fall back to exact-basename match against the
      // resource path so "/dev/sdb" doesn't falsely correlate with a
      // ZFS row naming "sdba" (substring collisions in previous impl).
      if (serial) {
        const basename = finding.resource.name.replace(/^\/dev\//, "");
        const zfsMatch = features.zfs.find((z) => {
          if (z.device_serial && z.device_serial === serial) return true;
          const zBase = z.device.replace(/^\/dev\//, "").replace(/\d+$/, "");
          const findingBase = basename.replace(/\d+$/, "");
          return zBase === findingBase || z.device === basename || z.device === finding.resource.name;
        });
        if (zfsMatch && zfsMatch.cksum_errors > 0) {
          finding.correlation_match = "smart_plus_zfs";
          finding.severity = upgradeSeverity(finding.severity);
          finding.evidence_summary += ` Corroborated by ${zfsMatch.cksum_errors} ZFS checksum error(s) on the same device in pool ${zfsMatch.pool}.`;
          matched = true;
        }
      }

      // Check for elevated latency on the same device
      if (!matched && serial) {
        const driveFeatures = features.drives.find(d => d.serial === serial);
        if (driveFeatures?.p99_read_latency_ms != null && driveFeatures.latency_baseline_30d != null) {
          if (driveFeatures.p99_read_latency_ms > driveFeatures.latency_baseline_30d * 2) {
            finding.correlation_match = "smart_plus_latency";
            finding.evidence_summary += ` Latency on this device is ${driveFeatures.p99_read_latency_ms.toFixed(0)}ms (baseline: ${driveFeatures.latency_baseline_30d.toFixed(0)}ms).`;
            matched = true;
          }
        }
      }
    }

    // Rule 2: NVMe fail-slow confirmation (latency + any NVMe health signal)
    if (finding.type === "nvme_fail_slow_candidate") {
      const driveFeatures = features.drives.find(d => d.serial === finding.resource.serial);
      if (driveFeatures && (
        (driveFeatures.nvme_critical_warning ?? 0) > 0 ||
        (driveFeatures.nvme_media_errors_delta_7d ?? 0) > 0 ||
        (driveFeatures.nvme_available_spare != null && driveFeatures.nvme_available_spare_threshold != null &&
         driveFeatures.nvme_available_spare < driveFeatures.nvme_available_spare_threshold + 10)
      )) {
        finding.correlation_match = "nvme_fail_slow_confirmed";
        finding.severity = "high";
        finding.evidence_summary += " Latency anomaly corroborated by NVMe health signals.";
        matched = true;
      }
    }

    // Rule 3: Cooling failure (fan RPM decline + temp rise in same chassis zone)
    if (finding.type === "fan_rpm_decline") {
      const tempRising = features.ipmi.temps.some(t => {
        // Match temps in the same zone or any CPU/exhaust temp rising
        const n = t.name.toLowerCase();
        const isCpuOrExhaust = n.includes("cpu") || n.includes("exhaust") || n.includes("outlet");
        return isCpuOrExhaust && t.delta_7d > 3; // 3C+ rise over 7 days
      });
      if (tempRising) {
        finding.correlation_match = "cooling_failure";
        finding.severity = "high";
        finding.evidence_summary += " Fan decline coincides with rising CPU/exhaust temperatures.";
        matched = true;
      }
    }

    // Rule 4: NIC hardware failure (NIC errors + TCP retransmits, single-host scope)
    if (finding.type === "nic_errors") {
      const ifaceData = features.network.find(n => n.iface === finding.resource.name);
      if (ifaceData && ifaceData.tcp_retransmits_delta_7d > 100) {
        // TODO(fast-follow): fleet-wide check (count_hosts_with_same_issue > 3 = switch problem, not NIC)
        // For v1, assume single-host since we process per-server
        finding.correlation_match = "nic_hardware";
        finding.severity = "high";
        finding.evidence_summary += ` TCP retransmits also elevated (${ifaceData.tcp_retransmits_delta_7d} in 7 days), suggesting hardware-level NIC issue.`;
        matched = true;
      }
    }

    // Rule 5: Memory DIMM pre-failure (CE burst + MCE entries)
    // TODO(fast-follow): requires MCE collection, which Crucible deliberately does not do (it needs a new privileged wrapper action; see the collectd parity ship-list). Stub.
    // if (finding.type === "ecc_ce_burst") { ... }

    // Rule 6: PSU pre-failure (rail out-of-spec + temp/status/redundancy)
    if (finding.type === "psu_rail_out_of_spec") {
      const psuTempElevated = features.ipmi.temps.some(t =>
        t.name.toLowerCase().includes("psu") && t.delta_7d > 5
      );
      // Check if any PSU discrete status is degraded (would have fired as an existing alert)
      // For v1, correlate with temp only
      if (psuTempElevated) {
        finding.correlation_match = "psu_prefailure";
        finding.evidence_summary += " PSU temperature is also rising, consistent with component degradation.";
        matched = true;
      }
    }

    // Classify findings
    if (finding.requires_correlation && !matched) {
      // Requires correlation but didn't match: dashboard-only observation
      observations.push(finding);
    } else if (matched || !finding.requires_correlation) {
      // Either matched a correlation rule or doesn't require one
      escalated.push(finding);
    } else {
      observations.push(finding);
    }
  }

  return { escalated, observations };
}
