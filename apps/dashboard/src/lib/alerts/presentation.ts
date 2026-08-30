// Shared alert presentation data used by dashboard, Telegram, and Slack notifications.
// Single source of truth for priority mapping, evidence links, fix commands, and formatting.

// =====================================================================
// Codex 2026-05-22B F1: this map was hand-maintained and drifted from
// the 61-rule YAML library. The values below are now mirrored from the
// YAML `priority:` field of every rule in `apps/dashboard/src/lib/server/
// alerts/rules/*.yaml`. Future drift is prevented by the sync test in
// `apps/dashboard/src/lib/server/alerts/fix-workflow/__tests__/priority-
// sync.test.ts`, which loads the YAML registry and fails CI if any rule's
// declared priority differs from this map (or if a rule is missing here
// entirely).
//
// Tiers (ordinal smaller = more urgent):
//   0 = P0 — page now, customer data corruption or imminent unrecoverable
//             loss (GPU ECC, GPU XID 79/...). Even more urgent than P1.
//   1 = P1 — urgent: redundancy lost, hardware failing, data loss imminent
//   2 = P2 — high: service-impacting, host degraded
//   3 = P3 — medium: degrading trend, soft warning
//   4 = P4: low, informational. NOT a rule/YAML priority (the enum stays
//           P0..P3); it is produced only by getPriority() when a specific
//           alert INSTANCE is severity=info, downgrading an otherwise
//           higher rule (e.g. a clean, intentional reboot on the P1
//           unexpected_reboot rule). P4 sits below the default channel
//           notify threshold (P0..P3), so such instances show on the
//           dashboard without paging.
//
// Dispatcher filter (apps/dashboard/src/lib/server/alerts/dispatcher.ts)
// treats a channel that opts into P1 as also opted into P0, so existing
// customer channel configurations (created before P0 existed) keep paging
// on P0 events without manual re-save.
// =====================================================================
export const ALERT_PRIORITIES: Record<string, number> = {
  // P0 — page now, customer data corruption / unrecoverable loss
  gpu_uncorrected_ecc: 0,
  gpu_xid_critical: 0,
  mce_uncorrected: 0,

  // P1 — urgent
  accept_backlog_or_syn_flood: 1,
  bond_slave_down: 1,
  conntrack_exhaustion: 1,
  cpu_temperature_high: 1,
  disk_fill_projection: 1,
  disk_io_errors: 1,
  ecc_errors: 1,
  fd_exhaustion: 1,
  filesystem_readonly: 1,
  gpu_thermal_critical: 1,
  gpu_driver_unsafe_reboot: 1,
  ipmi_fan_failure: 1,
  ipmi_sel_critical: 1,
  lacp_partner_lost: 1,
  lvm_thinpool_metadata_high: 1,
  mem_pressure_high: 1,
  no_firewall: 1,
  nvlink_link_down: 1,
  nvme_critical_warning: 1,
  oom_kills: 1,
  psu_redundancy_loss: 1,
  raid_degraded: 1,
  server_unreachable: 1,
  service_flapping: 1,
  smart_failing: 1,
  softnet_drops: 1,
  ssh_root_password: 1,
  systemd_service_failed: 1,
  systemd_service_oom_killed: 1,
  unexpected_reboot: 1,
  zfs_pool_unhealthy: 1,
  zfs_scrub_errors: 1,
  zfs_slog_faulted: 1,

  // P2 — high
  clock_drift: 2,
  cpu_high: 2,
  cpu_iowait_high: 2,
  cpu_pressure_high: 2,
  disk_space_high: 2,
  drive_smart_unreadable: 2,
  gpu_pcie_link_degraded: 2,
  gpu_power_cap_throttling: 2,
  inode_high: 2,
  interface_errors: 2,
  io_pressure_high: 2,
  kernel_needs_reboot: 2,
  kernel_vulnerabilities: 2,
  link_speed_mismatch: 2,
  listen_overflow: 2,
  ntp_not_synced: 2,
  nvme_wear_high: 2,
  os_end_of_life: 2,
  pending_security_updates: 2,
  ssh_config_unapplied: 2,
  swap_high: 2,
  tcp_retrans_high: 2,

  // P3 — medium
  bios_firmware_age: 3,
  cmos_battery_low: 3,
  disk_latency_high: 3,
  gpu_corrected_ecc_storm: 3,
  gpu_driver_or_firmware_drift: 3,
  interface_saturation: 3,
  ipmi_monitoring_unavailable: 3,
  ipmi_sel_full: 3,
  load_high: 3,
  memory_channels_underpopulated: 3,
  ram_high: 3,
  unattended_upgrades_disabled: 3,
};

export function getPriority(alertType: string, severity?: string): number {
  // Default for an unknown alert type is P3. A rule shipped before
  // ALERT_PRIORITIES is updated will silently default; the sync test
  // catches this in CI before it hits prod.
  let p = ALERT_PRIORITIES[alertType] ?? 3;
  // The map value is the rule's WORST-CASE priority. Modulate it by THIS
  // instance's severity so a benign instance of an otherwise-urgent rule
  // neither wears an urgent badge nor pages. Motivating bug: a clean,
  // intentional reboot on the P1 `unexpected_reboot` rule is severity=info
  // yet rendered "P1 URGENT" (and matched P1 pager channels) because only
  // the critical bump existed.
  //   critical: bump one tier up (clamp at P0). P2 -> P1, P1 -> P0.
  //   warning:  never paging-grade; floor at P2. A P1 warning -> P2.
  //   info:     lowest tier P4 (see legend), below the default P0..P3
  //             notify threshold, so it shows on the dashboard without paging.
  if (severity === "critical") {
    if (p > 0) p = p - 1;
  } else if (severity === "warning") {
    p = Math.max(p, 2);
  } else if (severity === "info" || severity === "informational") {
    p = Math.max(p, 4);
  }
  return p;
}

/**
 * Expand a channel's stored priority list to include P0 whenever P1 is
 * included.
 *
 * Codex 2026-05-22B F1: when the P0 tier was introduced for GPU ECC/XID
 * data-corruption alerts, customer channel rows already in Postgres still
 * carried the old default `["P1", "P2", "P3", "P4"]` (or similar). Without
 * this expansion, a paging channel opted into P1 would silently miss any
 * P0 alert because the filter is a literal allow-list match. Expanding P1
 * → also-receives-P0 preserves the operator-intuitive contract: "if you
 * opted into paging-grade, you definitely want the even-more-urgent tier."
 *
 * Idempotent: a channel that already explicitly lists P0 is unchanged.
 * A channel that has not opted into P1 is also unchanged (we don't force
 * non-paging channels to receive P0).
 */
export function expandChannelPriorities(
  channelPrios: readonly string[],
): readonly string[] {
  if (channelPrios.includes("P0")) return channelPrios;
  if (!channelPrios.includes("P1")) return channelPrios;
  return ["P0", ...channelPrios];
}

// Event-type rules fire once for something that already happened (a reboot, a
// SEL event) rather than for a condition that is currently true. They do NOT
// auto-resolve when the evaluator stops returning them; instead, the user
// resolves them manually after investigation. New occurrences stack into the
// same alert card rather than creating duplicates.
//
// Codex 2026-05-22B F2: added gpu_xid_critical + ipmi_sel_critical.
// - gpu_xid_critical: each NVIDIA XID is a discrete kernel-witnessed event;
//   multiple XIDs from the same (pci_bdf, xid_code) group while the alert is
//   already active need to stack occurrences (so the operator sees XID-79
//   firing twice in 20 min instead of one card silently overwriting its
//   own evidence + suppressing the second notification).
// - ipmi_sel_critical: BMC SEL critical events are discrete (each row in
//   the SEL is a moment-in-time event). The evaluator emits one alert per
//   batch of critical events in window, and a fresh batch arriving while
//   the alert is open should stack rather than overwrite.
export const EVENT_RULES: ReadonlySet<string> = new Set([
  "unexpected_reboot",
  "gpu_xid_critical",
  "ipmi_sel_critical",
]);

export function isEventRule(alertType: string): boolean {
  return EVENT_RULES.has(alertType);
}

// 2026-05-23 label fix: P0 was "PAGE NOW" (action verb) while P1-P3 used
// severity adjectives (URGENT / HIGH / MEDIUM). The asymmetry was intentional
// to differentiate P0 from P1 in notification feeds (both share the red
// color band; see PRIORITY_COLORS + SLACK_COLORS below), but "PAGE NOW"
// reads less emotionally urgent than "URGENT", inverting the perceived
// severity ladder. Switch P0 to "CRITICAL" — single severity word that
// outranks "URGENT" on the standard severity ladder, preserves the
// alphabetic color-band separation (both still red, but P0 darker via
// SLACK_COLORS).
export const PRIORITY_LABELS: Record<number, string> = {
  0: "P0 CRITICAL",
  1: "P1 URGENT",
  2: "P2 HIGH",
  3: "P3 MEDIUM",
  4: "P4 LOW",
};

// Priority pill colors, aligned to the canonical --g-priority-* scale
// (spec 4.4). No tier uses the brand: P2 is the warning band, P3 is info, P4
// is a muted low tier. Each name maps to a .tag-<name> class in base.css.
export const PRIORITY_COLORS: Record<number, string> = {
  0: "red", // critical
  1: "red", // critical
  2: "yellow", // warning (was the brand accent; decoupled per spec 4.4)
  3: "blue", // info
  4: "muted", // low, below the paging threshold
};

export const PRIORITY_EMOJI: Record<number, string> = {
  0: "\u{1F6A8}", // rotating police light — page now
  1: "\u{1F534}", // red circle
  2: "\u{1F7E0}", // orange circle
  3: "\u{1F7E1}", // yellow circle
  4: "\u{1F535}", // blue circle: informational
};

export const SLACK_COLORS: Record<number, string> = {
  0: "#b91c1c", // darker red so P0 reads more urgent than P1 in Slack
  1: "#f85149",
  2: "#d4820a",
  3: "#d29a22",
  4: "#3b82f6", // blue: informational, below the paging threshold
};

export const RESOLVED_COLOR = "#3fb950";

export interface EvidenceLink {
  label: string;
  anchor: string;
}

export const EVIDENCE_MAP: Record<string, EvidenceLink[]> = {
  // Hardware/IPMI
  cpu_temperature_high: [
    { label: "IPMI sensor readings", anchor: "#ipmi" },
    { label: "CPU chart", anchor: "#vitals" },
  ],
  ipmi_fan_failure: [{ label: "IPMI sensor readings", anchor: "#ipmi" }],
  ipmi_sel_critical: [{ label: "IPMI sensor readings", anchor: "#ipmi" }],
  psu_redundancy_loss: [{ label: "IPMI sensor readings", anchor: "#ipmi" }],
  ecc_errors: [{ label: "IPMI sensor readings", anchor: "#ipmi" }],

  // Storage
  smart_failing: [
    { label: "SMART health data", anchor: "#smart" },
    { label: "Storage overview", anchor: "#storage" },
  ],
  disk_space_high: [{ label: "Storage overview", anchor: "#storage" }],
  nvme_wear_high: [{ label: "SMART health data", anchor: "#smart" }],
  drive_smart_unreadable: [
    { label: "SMART health data", anchor: "#smart" },
    { label: "Storage overview", anchor: "#storage" },
  ],
  disk_io_errors: [{ label: "Storage overview", anchor: "#storage" }],
  disk_latency_high: [{ label: "Storage overview", anchor: "#storage" }],
  raid_degraded: [{ label: "Storage overview", anchor: "#storage" }],
  zfs_pool_unhealthy: [{ label: "Storage overview", anchor: "#storage" }],
  zfs_scrub_errors: [{ label: "Storage overview", anchor: "#storage" }],
  filesystem_readonly: [
    { label: "Storage overview", anchor: "#storage" },
    { label: "SMART health data", anchor: "#smart" },
  ],
  inode_high: [{ label: "Storage overview", anchor: "#storage" }],

  // OS/resource
  cpu_high: [{ label: "CPU chart", anchor: "#vitals" }],
  cpu_iowait_high: [{ label: "CPU chart", anchor: "#vitals" }],
  ram_high: [{ label: "Memory chart", anchor: "#vitals" }],
  oom_kills: [{ label: "Memory chart", anchor: "#vitals" }],
  load_high: [{ label: "CPU chart", anchor: "#vitals" }],

  // Network
  interface_errors: [
    { label: "Network interfaces", anchor: "#network" },
  ],
  link_speed_mismatch: [{ label: "Network interfaces", anchor: "#network" }],
  interface_saturation: [
    { label: "Network interfaces", anchor: "#network" },
  ],

  // Security
  ssh_root_password: [{ label: "Security posture", anchor: "#security" }],
  ssh_config_unapplied: [{ label: "Security posture", anchor: "#security" }],
  no_firewall: [{ label: "Security posture", anchor: "#security" }],
  kernel_needs_reboot: [{ label: "Security posture", anchor: "#security" }],
  pending_security_updates: [{ label: "Security posture", anchor: "#security" }],
  kernel_vulnerabilities: [{ label: "Security posture", anchor: "#security" }],
  unattended_upgrades_disabled: [{ label: "Security posture", anchor: "#security" }],
  os_end_of_life: [{ label: "Security posture", anchor: "#security" }],

  // Clock
  clock_drift: [],

  // New rules
  conntrack_exhaustion: [{ label: "Network overview", anchor: "#network" }],
  systemd_service_failed: [],
  ntp_not_synced: [],
  swap_high: [{ label: "Memory chart", anchor: "#vitals" }],
  fd_exhaustion: [],
  unexpected_reboot: [],

  // GPU rules (PR #166, consuming Crucible v0.13.0 snap.gpu).
  // All eight point at #gpu so a customer clicking an alert lands on
  // the per-GPU sub-card grid + XID event log.
  gpu_xid_critical: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_uncorrected_ecc: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_thermal_critical: [{ label: "GPU panel", anchor: "#gpu" }],
  nvlink_link_down: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_pcie_link_degraded: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_power_cap_throttling: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_driver_or_firmware_drift: [{ label: "GPU panel", anchor: "#gpu" }],
  gpu_corrected_ecc_storm: [{ label: "GPU panel", anchor: "#gpu" }],
};


export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  return `${hours}h ${rem}m`;
}

export function formatTimestamp(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
