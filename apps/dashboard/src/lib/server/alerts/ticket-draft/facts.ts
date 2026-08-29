// Fact extraction for ticket drafts. Builds the server-owned, verbatim
// { label, value } list the assembler prints. Nothing here is model-generated;
// the model only writes connective prose around these facts.
//
// A per-alert-type registry mirrors the EXTRACTORS pattern in event-stacking.ts.
// Common facts (server identity + alert meta) apply to every type. Per-type
// component facts add the identifiers a provider needs (drive serial, etc.)
// for the types where the evidence shape is known; other gated types fall back
// to the common facts plus the alert title, which already names the component.

import type { DraftAlert, DraftFacts, DraftServer, Fact } from "./types";

function humanizeAge(deltaMs: number): string {
  if (deltaMs < 0) deltaMs = 0;
  const min = Math.floor(deltaMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function isoOf(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** Short, human noun phrase per gated alert type, for the subject line. */
const FAULT_LABELS: Record<string, string> = {
  smart_failing: "failing drive (SMART)",
  nvme_critical_warning: "NVMe critical warning",
  nvme_wear_high: "drive at end of rated write endurance",
  raid_degraded: "degraded RAID array",
  ecc_errors: "memory ECC errors",
  mce_uncorrected: "uncorrected memory error",
  psu_redundancy_loss: "PSU redundancy loss",
  ipmi_fan_failure: "fan failure",
  cpu_temperature_high: "high CPU temperature",
  disk_io_errors: "disk I/O errors",
};

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/**
 * Per-type component facts + optional diagnostic command. Returns the extra
 * facts (beyond the common set) and, for drive-class faults, the device path
 * for the "full report on request" command. Unknown evidence keys are simply
 * omitted; nothing is fabricated.
 */
function componentFacts(alert: DraftAlert): { facts: Fact[]; appendixCommand?: string } {
  const ev = alert.evidence ?? {};
  const out: Fact[] = [];
  const push = (label: string, v: unknown) => {
    const s = str(v);
    if (s !== null) out.push({ label, value: s });
  };

  switch (alert.alert_type) {
    case "smart_failing": {
      push("Device", ev.device);
      push("Drive model", ev.model);
      out.push({ label: "Serial number", value: str(ev.serial) ?? "not reported (run smartctl -a to obtain)" });
      push("Firmware", ev.firmware);
      push("SMART health", ev.health);
      push("Reallocated sectors", ev.reallocated_sectors);
      push("Pending sectors", ev.pending_sectors);
      const dev = str(ev.device);
      return { facts: out, appendixCommand: dev ? `smartctl -a ${dev}` : undefined };
    }
    case "nvme_critical_warning": {
      push("Device", ev.device);
      push("Drive model", ev.model);
      out.push({ label: "Serial number", value: str(ev.serial) ?? "not reported (run smartctl -a to obtain)" });
      push("Firmware", ev.firmware);
      if (Array.isArray(ev.flags_active)) push("Active critical-warning flags", (ev.flags_active as unknown[]).join(", "));
      push("Available spare", ev.available_spare_percent != null ? `${ev.available_spare_percent}%` : null);
      const dev = str(ev.device);
      return { facts: out, appendixCommand: dev ? `smartctl -a ${dev}` : undefined };
    }
    case "nvme_wear_high": {
      // Wear-out swap request: the provider will not pull a drive on a bare
      // "endurance high" claim, so quote the exact unit (model, serial,
      // firmware) plus the SMART numbers that prove wear rather than errors.
      push("Device", ev.device);
      push("Drive model", ev.model);
      out.push({ label: "Serial number", value: str(ev.serial) ?? "not reported (run smartctl -a to obtain)" });
      push("Firmware", ev.firmware);
      push(
        "Rated write endurance used",
        ev.percentage_used != null ? `${ev.percentage_used}% (SMART percentage-used / vendor wear attribute)` : null,
      );
      push("Power-on hours", ev.power_on_hours);
      push("SMART health", ev.health);
      push("Reallocated sectors", ev.reallocated_sectors);
      push("Pending sectors", ev.pending_sectors);
      const dev = str(ev.device);
      return { facts: out, appendixCommand: dev ? `smartctl -a ${dev}` : undefined };
    }
    case "disk_io_errors": {
      const dev = str(ev.device) ?? (Array.isArray(ev.devices) ? (ev.devices as unknown[]).join(", ") : null);
      push("Device", dev);
      push("Sense key", ev.sense_key);
      push("Error count", ev.count);
      // affected_drives: [{device, model, serial, firmware}], joined from the
      // SMART inventory by the evaluator so the provider can identify the
      // physical unit, not just the kernel node name.
      const drives = Array.isArray(ev.affected_drives)
        ? (ev.affected_drives as Array<Record<string, unknown>>)
        : [];
      for (const d of drives) {
        const id = [str(d.model), str(d.serial) ? `serial ${str(d.serial)}` : null].filter((x): x is string => x !== null);
        if (id.length) out.push({ label: "Affected drive", value: `${str(d.device) ?? "unknown"} (${id.join(", ")})` });
      }
      if (drives.length === 0 && dev) {
        out.push({ label: "Drive identity", value: "not resolved from SMART (run smartctl -a on the device to obtain model and serial)" });
      }
      const one = str(ev.device) ?? (Array.isArray(ev.devices) && ev.devices.length ? String((ev.devices as unknown[])[0]) : null);
      return { facts: out, appendixCommand: one ? `smartctl -a /dev/${one.replace(/^\/dev\//, "")}` : undefined };
    }
    case "mce_uncorrected": {
      push("Uncorrected error count", ev.edac_uncorrected_total);
      if (Array.isArray(ev.affected_dimms) && ev.affected_dimms.length) {
        const labels = (ev.affected_dimms as Array<Record<string, unknown>>)
          .map((d) => str(d.label) ?? str(d.location) ?? "unknown")
          .join(", ");
        push("Affected DIMM(s)", labels);
      }
      return { facts: out, appendixCommand: "ras-mc-ctl --error-count" };
    }
    case "raid_degraded": {
      // mdadm: name the failed member disk(s), with model + serial when the
      // evaluator resolved them from SMART, so the provider knows which drive to
      // pull, not just which array. Hardware RAID has no per-disk serial here (it
      // is behind the controller), so surface the controller identity + state and
      // let the on-site tech read the slot off the controller CLI.
      const members = Array.isArray(ev.failed_members)
        ? (ev.failed_members as Array<Record<string, unknown>>)
        : [];
      let appendixDevice: string | null = null;
      for (const m of members) {
        const dev = str(m.device) ?? str(m.member);
        if (!dev) continue;
        const model = str(m.model);
        const serial = str(m.serial);
        const id = [model, serial ? `serial ${serial}` : null].filter((x): x is string => x !== null);
        out.push({ label: "Failed member", value: id.length ? `${dev} (${id.join(", ")})` : dev });
        if (appendixDevice === null) appendixDevice = str(m.device);
      }
      if (members.length === 0 && Array.isArray(ev.failed_disks) && (ev.failed_disks as unknown[]).length) {
        push("Failed member(s)", (ev.failed_disks as unknown[]).join(", "));
      }
      push(
        "Controller",
        ev.controller_id != null ? `${str(ev.controller_vendor) ?? "RAID"} controller ${str(ev.controller_id)}` : null,
      );
      push("Controller state", ev.controller_state);
      push("Degraded disks", ev.degraded_disks);
      return { facts: out, appendixCommand: appendixDevice ? `smartctl -a ${appendixDevice}` : undefined };
    }
    case "ipmi_fan_failure": {
      // Name each failed fan with its RPM (evidence.failed_fans = [{name, rpm}]),
      // so the provider knows which fan position to replace.
      const fans = Array.isArray(ev.failed_fans) ? (ev.failed_fans as Array<Record<string, unknown>>) : [];
      const named = fans
        .map((f) => {
          const n = str(f.name);
          if (!n) return null;
          return typeof f.rpm === "number" ? `${n} (${f.rpm} RPM)` : n;
        })
        .filter((x): x is string => x !== null);
      if (named.length) push("Failed fan(s)", named.join(", "));
      push("Total fans", ev.total_fans);
      return { facts: out };
    }
    case "psu_redundancy_loss": {
      // Per-PSU fault path names the failed supply (evidence.failed = [{name,
      // status}]); the Dell aggregate path only has a redundancy state.
      const failed = Array.isArray(ev.failed) ? (ev.failed as Array<Record<string, unknown>>) : [];
      const named = failed
        .map((p) => {
          const n = str(p.name);
          if (!n) return null;
          const st = str(p.status);
          return st ? `${n} (${st})` : n;
        })
        .filter((x): x is string => x !== null);
      if (named.length) {
        push("Failed PSU(s)", named.join(", "));
        push("Total PSUs", ev.total_psus);
      } else {
        const agg = str(ev.aggregate_state);
        if (agg) push("Redundancy state", agg.replace(/_/g, " "));
      }
      return { facts: out };
    }
    case "cpu_temperature_high": {
      // Name the sensor (IPMI) or hwmon source and the reading, so a cooling
      // fault is tied to a specific sensor. Normalize the unit to °C.
      push("Sensor", str(ev.sensor) ?? str(ev.source));
      if (typeof ev.value === "number") {
        const rawUnit = str(ev.unit) ?? "°C";
        const unit = /degrees\s*c/i.test(rawUnit) || rawUnit.trim() === "C" ? "°C" : rawUnit;
        out.push({ label: "Temperature", value: `${ev.value} ${unit}` });
      }
      return { facts: out };
    }
    case "ecc_errors": {
      // The EDAC path carries per-DIMM detail (evidence.edac.dimms_with_errors =
      // [{label, location}]); name the affected module(s). The IPMI/SEL-only path
      // (most BMCs) has no per-DIMM data, so the title carries the count instead.
      const edac = ev.edac && typeof ev.edac === "object" ? (ev.edac as Record<string, unknown>) : null;
      const dimms = edac && Array.isArray(edac.dimms_with_errors)
        ? (edac.dimms_with_errors as Array<Record<string, unknown>>)
        : [];
      const named = dimms
        .map((d) => {
          const label = str(d.label);
          const loc = str(d.location);
          if (label && loc) return `${label} (${loc})`;
          return label ?? loc;
        })
        .filter((x): x is string => x !== null);
      if (named.length) push("Affected DIMM(s)", named.join(", "));
      if (typeof ev.max_uncorrectable === "number" && ev.max_uncorrectable > 0) {
        push("Uncorrectable error count", ev.max_uncorrectable);
      }
      return { facts: out };
    }
    default:
      // Any future gated type without a dedicated extractor: the common facts
      // plus the alert title (which names the component) are the floor.
      return { facts: out };
  }
}

/**
 * Build the verbatim fact set for a ticket draft. `nowMs` is injectable for
 * deterministic tests; defaults to the current time.
 */
export function buildDraftFacts(server: DraftServer, alert: DraftAlert, nowMs: number = Date.now()): DraftFacts {
  const iso = isoOf(alert.first_seen);
  const firstSeenMs = new Date(iso).getTime();
  const ageStr = Number.isNaN(firstSeenMs) ? "" : ` (${humanizeAge(nowMs - firstSeenMs)})`;
  const hardwareModel = server.dmi_product || "unknown model";

  const common: Fact[] = [
    { label: "Server name", value: server.name },
    { label: "Server IP", value: server.ip || "unknown" },
    { label: "Hardware vendor", value: server.dmi_vendor || "unknown" },
    { label: "Hardware model", value: hardwareModel },
    { label: "Operating system", value: [server.os_type, server.os_version].filter(Boolean).join(" ") || "unknown" },
    { label: "Alert", value: alert.title },
    { label: "Severity", value: alert.severity },
    { label: "First detected", value: `${iso}${ageStr}` },
  ];

  const { facts: component, appendixCommand } = componentFacts(alert);

  return {
    serverName: server.name,
    hardwareModel,
    faultLabel: FAULT_LABELS[alert.alert_type] ?? "hardware fault",
    facts: [...common, ...component],
    appendixCommand,
  };
}
