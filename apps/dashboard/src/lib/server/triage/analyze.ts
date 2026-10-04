// Paste triage core: run the parsers whose detect() matches, merge their
// snapshot slices, evaluate Glassmkr's own alert rules on the result, resolve
// the fix workflows, and shape a model-visible answer.
//
// Pure and synchronous: no database, no network, no clock except what the
// evaluator itself reads. Nothing here stores or logs the pasted text.
//
// What leaves this module is deliberately narrow. Titles and summaries are the
// static rule YAML metadata, never the evaluator's dynamic titles (those embed
// paste-derived strings). Evidence is reduced to scalars, every string is
// re-sanitized, and free-text fields (raw log lines, messages, error text) are
// dropped, so a line like "ignore previous instructions" inside a matched log
// entry never reaches the model.

import { z } from "zod";
import {
  evaluateAlerts,
  type AlertResult,
  type ServerConfig,
  type Snapshot,
} from "$lib/server/alerts/evaluator.js";
import { getRuleMetadata, listMetadataRuleTypes } from "$lib/server/alerts/fix-workflow/loader.js";
import {
  interpolateEvidence,
  resolveFix,
  type ResolvedFix,
  type ServerLocator,
} from "$lib/server/alerts/fix-workflow/resolve.js";
import { TRIAGE_PARSERS } from "./registry.js";
import { safeIdent, safeLabel } from "./sanitize.js";
import {
  DOMAIN_SNAPSHOT_KEYS,
  type ParserResult,
  type TriageDomain,
  type TriageFormat,
  type TriageParser,
} from "./types.js";
import { captureCommandText, captureWhy, type CaptureGoal } from "./capture.js";

/**
 * collector_version stamped on the synthetic snapshot. The parsers emulate the
 * field set of Crucible 1.2.4 (FALLBACK_LATEST in $lib/server/version.ts when
 * they were written), so agentAtLeast() gates in the evaluator see a current
 * agent. Today the only gate is the filesystem_readonly mount-options path,
 * which reads `disks`, a key no parser writes. Kept as its own constant rather
 * than imported, so bumping the fallback for a release cannot silently change
 * what the paste parsers claim to emulate.
 */
export const TRIAGE_COLLECTOR_VERSION = "1.2.4";

/**
 * SEL events in a paste count regardless of age. The evaluator defaults to a
 * 30-day window measured from the server clock, which would silently drop a
 * real event from an older paste. Ten years was not enough: a BMC whose clock
 * was never set dates its events 01/01/2000 (or 1970), and a failed PSU logged
 * that way came back as "no matching signal" (R1-9). A hundred years covers
 * every date ipmitool prints; the answer reports how old the events are
 * instead (selTiming below).
 */
export const SEL_WINDOW_DAYS = 36_500;

const MAX_FINDINGS = 30;
const MAX_OBSERVED_KEYS = 24;
const MAX_ARRAY_ITEMS = 16;
export const MAX_NOTE_LENGTH = 240;

export const TRIAGE_FORMATS = [
  "smartctl_json",
  "smartctl_text",
  "zpool_status",
  "proc_mdstat",
  "mdadm_detail",
  "dmesg",
  "journalctl_kernel",
  "syslog_kernel",
  "ipmitool_sel_elist",
  "ipmitool_sel_list",
  "ipmitool_sel_info",
  "ipmitool_sdr",
  "ipmitool_sensor",
  "nvidia_smi_query",
  "nvidia_smi_nvlink_status",
] as const satisfies readonly TriageFormat[];

// Compile-time guard: TRIAGE_FORMATS must list every TriageFormat in types.ts.
type MissingFormat = Exclude<TriageFormat, (typeof TRIAGE_FORMATS)[number]>;
const _allFormatsListed: MissingFormat extends never ? true : never = true;
void _allFormatsListed;

const FORMAT_DOMAIN: Record<TriageFormat, TriageDomain> = {
  smartctl_json: "smart",
  smartctl_text: "smart",
  zpool_status: "zfs",
  proc_mdstat: "mdraid",
  mdadm_detail: "mdraid",
  dmesg: "kernel_log",
  journalctl_kernel: "kernel_log",
  syslog_kernel: "kernel_log",
  ipmitool_sel_elist: "ipmi_sel",
  ipmitool_sel_list: "ipmi_sel",
  ipmitool_sel_info: "ipmi_sel",
  ipmitool_sdr: "ipmi_sel",
  ipmitool_sensor: "ipmi_sel",
  nvidia_smi_query: "nvidia_gpu",
  nvidia_smi_nvlink_status: "nvidia_gpu",
};

const DOMAIN_GOAL: Record<TriageDomain, CaptureGoal> = {
  smart: "all_disks",
  zfs: "zfs",
  mdraid: "raid_md",
  kernel_log: "kernel_errors",
  ipmi_sel: "bmc_events",
  nvidia_gpu: "gpu",
};

const SUBJECT_KINDS = ["drive", "md_array", "zfs_pool", "gpu", "bmc", "kernel"] as const;
type SubjectKind = (typeof SUBJECT_KINDS)[number];

const DOMAIN_KIND: Record<TriageDomain, SubjectKind> = {
  smart: "drive",
  zfs: "zfs_pool",
  mdraid: "md_array",
  kernel_log: "kernel",
  ipmi_sel: "bmc",
  nvidia_gpu: "gpu",
};

// What a finding is about, when that differs from the domain that fed the rule
// (disk_io_errors comes from the kernel log but is about a drive).
const RULE_KIND: Record<string, SubjectKind> = {
  smart_failing: "drive",
  drive_smart_unreadable: "drive",
  nvme_wear_high: "drive",
  nvme_critical_warning: "drive",
  disk_io_errors: "drive",
  raid_degraded: "md_array",
  zfs_pool_unhealthy: "zfs_pool",
  zfs_scrub_errors: "zfs_pool",
  zfs_slog_faulted: "zfs_pool",
  gpu_xid_critical: "gpu",
  nvlink_link_down: "gpu",
  ipmi_sel_critical: "bmc",
  ipmi_sel_full: "bmc",
  ipmi_fan_failure: "bmc",
  psu_redundancy_loss: "bmc",
  filesystem_readonly: "kernel",
  mce_uncorrected: "kernel",
};

const SEVERITY_RANK: Record<AlertResult["severity"], number> = { critical: 0, warning: 1, info: 2 };

// Triage wording for rules whose YAML summary speaks for the live dashboard: a
// time window, boot grace, "acknowledge this advisory", a branch a paste never
// feeds, or a prediction. The YAML stays the dashboard's source; a paste answer
// is read by someone with one paste and no dashboard (R1-29, R1-10).
const TRIAGE_SUMMARY: Record<string, string> = {
  // The SEL names the sensor an event was logged against, not a cause: a
  // watchdog reset, a lost AC feed or an OS critical stop was blamed on
  // DIMM, PSU, fan, voltage or temperature hardware (R5-5).
  ipmi_sel_critical:
    "The pasted BMC System Event Log contains one or more critical-severity asserted events. sensor_types and affected_components under observed name the sensor each event was logged against; the event names the sensor, not a cause. This check counts events of any age: the dates are under observed, and an event that is old or was later deasserted records a past fault, not necessarily a current one.",
  ecc_errors:
    "The memory controller or the BMC reported one or more uncorrectable ECC errors in this output. An uncorrectable error is a hardware fault in memory; check when it happened (the dates in the paste), then identify the DIMM and plan its replacement.",
  zfs_scrub_errors:
    "The pool's most recent scrub found checksum or repair errors. They point at failing disks or silent corruption; zpool status -v lists the affected files.",
  // The rule fires at a fixed 92 C and never reads the card's own slowdown
  // temperature; "at or above the HW slowdown threshold" was false for an
  // A6000 at 93 C against its printed 95 C (R4-3).
  gpu_thermal_critical:
    "nvidia-smi reports a hardware thermal slowdown (HW Thermal Slowdown, or HW Slowdown with no power brake), or the GPU die reads 92 C or more. 92 C is a fixed backstop, not this card's own slowdown temperature, which nvidia-smi -q prints as GPU Slowdown Temp. A software thermal slowdown alone does not fire. Sustained operation at thermal limits accelerates wear and reduces throughput.",
  gpu_corrected_ecc_storm:
    "The GPU's corrected-ECC counter is high, or single-bit retired pages are non-zero. Corrected errors were repaired by the GPU; one paste shows the counters, not how fast they are rising, so compare with a reading taken later.",
  // The YAML names the agent version that added per-vdev classes and says
  // which severities page (R2-22). A spare demotes a raidz2 only while it
  // covers the vdev's one failed member (R3-4).
  zfs_pool_unhealthy:
    "A ZFS pool in this output is SUSPENDED or has a vdev that is not ONLINE. Severity follows the vdev's redundancy: a SUSPENDED pool, a FAULTED top-level vdev, or a DEGRADED single-disk, raidz1, two-way mirror or raidz2 vdev is critical; a DEGRADED raidz2 whose only failed member is resilvering onto a hot spare, a raidz3 or a wider mirror is a warning; an OFFLINE vdev or a failed L2ARC cache device is info. A failed log (SLOG) device is reported by zfs_slog_faulted.",
  drive_smart_unreadable:
    "One or more fixed disks are present but their SMART health cannot be read, so a failure on them would go unseen. This is NOT a drive fault: it is a coverage gap. The usual cause is that smartmontools (the `smartctl` binary) is not installed, or a disk sits behind a RAID/HBA controller that needs a specific `smartctl -d` device type (`smartctl --scan-open` finds it). Some virtual or enclosure devices genuinely expose no SMART.",
  // ecc_errors always fires on the same EDAC UE count, so one event read as
  // two separate critical problems (R2b-16).
  mce_uncorrected:
    "EDAC reports an uncorrected memory error. It is the same event as the ECC memory errors finding in this answer, which reads the same EDAC count: identify the DIMM and replace it.",
  // The YAML speaks of a configured threshold, Crucible's mapping, the rule
  // id's history and when the drive turns read-only (R2b-4).
  nvme_wear_high:
    "A solid-state drive's wear indicator shows how much of its rated write endurance is used: percentage used on NVMe, or a life-remaining attribute such as Percent_Lifetime_Remain or Wear_Leveling_Count on a SATA SSD. 75% used is reported at info, 85% at warning and 95% at critical. Identify the drive by its serial before replacing anything.",
  // The YAML calls every critical code a hardware-witnessed fault; Xid 119
  // and 120 (GSP) are often driver or firmware (R2b-4). NVIDIA's Xid catalog
  // has no severity column, so the class is the agent's, not NVIDIA's (R3-2).
  gpu_xid_critical:
    "The kernel log has an NVIDIA Xid event with a code Glassmkr's agent classes as critical. The code names the event, not its cause: capture nvidia-bug-report.sh before resetting or reseating the GPU, and look the code up in NVIDIA's Xid catalog for its resolution.",
  // The YAML describes the mount-options branch too, which a paste never
  // feeds: here the finding always comes from the kernel's remount line
  // (R2b-14).
  filesystem_readonly:
    "The kernel logged that it remounted a filesystem read-only, which it does when the filesystem fails, usually after I/O errors. Anything that writes to it fails; data already on it stays readable. Check the kernel log lines before the remount for the device's errors.",
  // The YAML names causes the paste does not show ("typically indicates a
  // failed firmware update") and leaves out the common one, a GPU replaced
  // under RMA (R4-12).
  gpu_driver_or_firmware_drift:
    "GPUs of the same model on this host report different VBIOS versions. The output does not say why: a replaced GPU, a partial firmware update and a mixed batch all look like this.",
  // The YAML calls the cap "catastrophic for training-style workloads", an
  // impact the paste does not show (R4-12). The width-only branch has its own
  // text (shapeFinding).
  gpu_pcie_link_degraded:
    "The GPU's PCIe link is running below the card's maximum generation or width, so host-to-GPU bandwidth is capped below what the card supports.",
  // The YAML says sync-write durability is compromised; ZFS writes the intent
  // log to the main pool while a log device is out, so sync writes slow down
  // but stay durable (R5-10).
  zfs_slog_faulted:
    "A separate log (SLOG) device in this pool is FAULTED or REMOVED. ZFS writes the intent log to the main pool devices while it is out, so sync writes stay durable but lose the SLOG's latency benefit. The device is named under observed.",
  // The YAML names hardware RAID controllers no paste feeds and says one more
  // failure may cause data loss, which is false for a degraded RAID6 or 3-way
  // RAID1 (R6-6).
  raid_degraded:
    "An mdadm software RAID array in this output is running with fewer active members than it has slots, so it has less redundancy than it was built with. How many more failures it can survive depends on its RAID level, shown under observed, and how many members it has.",
  // Shorter than the YAML so the text block carries it whole (R2b-14).
  nvme_critical_warning:
    "An NVMe drive's Critical Warning byte is non-zero. Each set bit is a condition the NVMe specification flags for immediate attention: available spare below threshold, temperature threshold exceeded, reliability degraded, read-only mode, or a failed volatile memory backup.",
};

/**
 * grep -iE pattern for the kernel lines disk_io_errors reads. The YAML quick
 * check filters dmesg to err and crit, but SCSI sense data is logged at info
 * and NVMe timeouts at warn, and its grep misses "critical medium error": it
 * printed nothing for the very line that fired, then blamed the empty output
 * on a controller fault (R2-10). Tested against every line the kernel log
 * reader counts.
 */
export const DISK_IO_GREP =
  "I/O error|critical (medium|target) error|device offline error|Sense Key|Add\\. Sense|nvme[0-9]+: .*(timeout|reset|abort|disabl|remov)|sct 0x2|end_request";

// Quick checks that tell the reader to open the dashboard, or describe it, or
// call a result healthy (R2b-4).
export const TRIAGE_QUICK_CHECK: Record<string, { command: string; explanation: string }> = {
  zfs_scrub_errors: {
    command: "sudo zpool status | grep -E '(pool:|scan:|errors:)' | head -40",
    explanation: "Per-pool scan recency and error count. `errors: No known data errors` means the scrub found nothing; any other phrasing is the signal. `scan: scrub in progress` means a scrub is running now.",
  },
  disk_io_errors: {
    command: `sudo env LC_ALL=C dmesg -T | grep -iE '${DISK_IO_GREP}' | tail -40`,
    explanation: "Kernel lines for block-device errors, SCSI sense data and NVMe timeouts, resets and aborts, from every log level: SCSI sense data is logged at info, so the log is not filtered by level.",
  },
  gpu_corrected_ecc_storm: {
    command: "nvidia-smi --query-gpu=index,uuid,ecc.errors.corrected.aggregate.total,ecc.errors.corrected.volatile.total --format=csv",
    explanation: "Per-GPU corrected ECC counters, lifetime and since the last driver reload. Run it again later and compare: a counter that keeps climbing is the storm signal.",
  },
  gpu_driver_or_firmware_drift: {
    command: "nvidia-smi --query-gpu=index,uuid,name,driver_version,vbios_version --format=csv",
    explanation: "Per-GPU driver and VBIOS version. GPUs of the same model on one host are expected to run the same VBIOS.",
  },
  // The YAML also lists MegaCLI, storcli and perccli for hardware RAID, which
  // no paste reader feeds (R6-6).
  raid_degraded: {
    command:
      "cat /proc/mdstat\n# Triage the FAILED member before deciding re-add vs replace:\nsudo smartctl -H /dev/sdX 2>/dev/null | grep -i result\nsudo dmesg -T 2>/dev/null | grep -iE 'sdX.*(error|fail|reset)' | tail -5",
    explanation:
      "Print the array state, then triage the failed member itself: SMART health and the kernel log for that device (sdX = the failed member's disk). A member can be marked faulty by a transient (a link reset, a controller hiccup, an administrative action) with no fault on the drive: if SMART passes and the kernel log shows no I/O errors for it, `mdadm --manage /dev/<array> --re-add /dev/<member>` restores redundancy, quickly when the array has a write-intent bitmap, with no replacement drive. If it drops out again, or SMART or the kernel log show real errors, take the replacement path below instead.",
  },
};

/**
 * Passages of the YAML fix text that speak about Glassmkr's roadmap, an
 * internal incident, or a forecast, rewritten for a paste answer; the YAML
 * stays the dashboard's source (R2-22). Exact text: a test fails when the YAML
 * changes under one of these.
 */
export const TRIAGE_TEXT_REPLACE: Record<string, ReadonlyArray<readonly [string, string]>> = {
  // A `smartctl -H -A` paste carries no serial to match (R3-19).
  smart_failing: [
    ["Match the SERIAL from the alert evidence before acting", "Match the serial this answer names (or, with none, its counters) before acting"],
  ],
  nvme_wear_high: [
    ["Match the SERIAL from the alert evidence, not the device letter", "Match the serial this answer names, not the device letter"],
    [" (a validation session compared the wrong twin of an MX500 pair and wrongly concluded the alert overstated wear 25x; the alerted twin really was at 80%)", ""],
    // Lifetime predictions (R2b-4).
    [
      "# Imminent-replacement workflow (wear >= 95%; critical band).\n# Drive may enter read-only protection mode at 100%. Treat\n# as if failure is hours-to-days away.",
      "# Replacement workflow (wear >= 95%; critical band).\n# Replace the drive as soon as a maintenance window allows.",
    ],
    [
      "# Planned-replacement workflow (wear 85-94%; warning band).\n# Drive has months-to-quarters of life left; schedule\n# replacement during the next regular maintenance window.",
      "# Planned-replacement workflow (wear 75-94%; info and warning bands).\n# Schedule replacement during a regular maintenance window.",
    ],
    [
      "# 1. Check projected end-of-life: divide remaining wear\n#    headroom by recent wear rate.",
      "# 1. Read the current wear and the data written so far.",
    ],
  ],
  // Causes the code alone does not establish, and a VBIOS reflash (R2b-4).
  gpu_xid_critical: [
    [
      "# XID 79 (most severe): GPU fell off the PCIe bus. Reseat the\n# card; if it recurs, RMA.\n# XID 48 / 95: Double-bit ECC / uncontained ECC. VRAM end-of-\n# life; plan replacement.\n# XID 94: contained ECC. Memory region blocked but data is\n# safe; preventive replacement.\n# XID 119 / 120: GSP RPC timeout. Driver/firmware version\n# mismatch; verify and reflash vbios.",
      "# XID 79: the GPU has fallen off the PCIe bus.\n# XID 48 / 95: double-bit ECC error / uncontained ECC error.\n# XID 94: contained ECC error.\n# XID 119 / 120: GSP RPC timeout / GSP error.\n# The code names the event, not its cause: capture\n# nvidia-bug-report.sh before any reset, reseat or reboot.",
    ],
  ],
  // The SEL names the sensor an event was logged against; a threshold
  // crossing or an event deasserted years ago is not a failed part the BMC
  // has identified (R3-9).
  // The sensor list is paste text and stays out of the command: a label keeps
  // "(", ")" and ":", and `/(e:id:) x` in a comment line is a zsh glob
  // qualifier that runs `id` when the block is pasted (R4-2). commandEvidence
  // never passes the list, so the token renders as a placeholder here.
  ipmi_sel_critical: [
    [
      "# This SEL alert names the failed component(s): <affected_components>.",
      "# The sensors these critical SEL events name are listed in this answer as affected_components.",
    ],
    [
      "# The BMC has already identified the part; the commands below just\n# confirm it and point at the focused workflow",
      "# Check each event's date and whether a Deasserted row follows it;\n# ipmitool sdr elist shows each sensor's current reading.\n# Focused workflows",
    ],
    ["Leads with the failed component the SEL already named", "Leads with the sensors the critical SEL events name"],
    // No paste rule is named cpu_temperature_high, and nothing in the answer
    // runs it (R5-10).
    ["#    Temperature -> see cpu_temperature_high workflow", "#    Temperature -> check every temperature sensor\n#               sudo ipmitool sdr type Temperature"],
    ["#               often correlates with cpu_temperature_high.", "#               check CPU temperatures too\n#               (sudo ipmitool sdr type Temperature)."],
    // "The clear is safe" before a live `sel clear`: the clear cannot be
    // undone, and for a paste-only reader the SEL may be the only record of
    // the event (R5-2). Export first, as ipmi_sel_full does.
    [
      "# 4. After acting on each event type, clear the SEL so\n#    future critical events stand out. The clear is safe;\n#    SEL is per-host log only.\nsudo ipmitool sel clear",
      "# 4. Export the SEL before any clear: clearing it cannot be\n#    undone, and vendor support may ask for these events.\nsudo ipmitool sel elist > /root/sel-$(date +%F).txt\n#    Then, once each event type has been acted on, clear it so\n#    future critical events stand out:\n# sudo ipmitool sel clear",
    ],
  ],
  ipmi_fan_failure: [
    [
      "check cpu_temperature_high before / during this fix",
      "check CPU temperatures (sudo ipmitool sdr type Temperature) before / during this fix",
    ],
    [
      "# If CPU temps are above warning -> cpu_temperature_high\n# workflow runs in parallel; prioritise fan swap.",
      "# If CPU temps are above warning, keep watching them while\n# you work; prioritise fan swap.",
    ],
  ],
  // A roadmap note (R5-10).
  gpu_thermal_critical: [["# On HGX hosts, baseboard temp via Redfish (tier 3 once that\n# ships):", "# On HGX hosts, baseboard temp via Redfish:"]],
  // An internal roadmap tier and agent version (R6-7).
  nvlink_link_down: [["#   - Check NVSwitch port faults via DCGM (tier 2 not full\n#     in v0.13.0; use dcgmi directly).", "#   - Check NVSwitch port faults with dcgmi."]],
  // The dashboard's acknowledge action, and a cause the output does not show:
  // a power brake is asserted from outside the GPU, but nothing in a paste
  // says the PSU is too small (R6-7).
  gpu_power_cap_throttling: [
    ["This is expected behaviour and ack-as-\n#    benign is the right call.", "This is expected behaviour and needs\n#    no action."],
    [
      "#    chassis PSU is under-sized for the workload thermal +\n#    electrical load. Check IPMI dcmi power reading vs PSU\n#    rated capacity.",
      "#    the brake is asserted from outside the GPU (a PSU or\n#    chassis power event); this output does not show which.\n#    Check IPMI dcmi power reading vs PSU rated capacity.",
    ],
  ],
  // The dashboard's ingest snapshot (R6-7).
  gpu_uncorrected_ecc: [["# Confirm ECC mode is on (rule won't fire if disabled but\n# verify the snapshot wasn't stale):", "# Confirm ECC mode is on (the rule does not fire if it is off):"]],
  // `zpool status -x` prints a one-line message when no pool has a problem;
  // it is not silent (R5-10).
  zfs_pool_unhealthy: [["prints only pools that are not healthy (silent when all good)", "prints only the pools that have a problem, or one line saying there are none"]],
  // Clearing the pool's error counters cannot be undone (R5-2).
  zfs_scrub_errors: [
    [
      "# 4. After replacement, clear pool errors + re-scrub",
      "# 4. After replacement, note the error counts (clearing them\n#    cannot be undone), then clear pool errors + re-scrub",
    ],
  ],
  psu_redundancy_loss: [
    [
      "# 4. Plan replacement at next maintenance window; no\n#    emergency. Degraded means \"watch this PSU, it's\n#    likely the next to fail\".",
      "# 4. Plan replacement at next maintenance window; no\n#    emergency. Degraded means the BMC reports this\n#    PSU's redundancy as reduced.",
    ],
    // The per-PSU path pointed at the Dell variant's sections 3-6, which a
    // paste answer never carries (R5-10).
    [
      "# 4. Physical check + replacement (same as Dell critical\n#    path, sections 3-6).",
      "# 4. Physical check of each supply that is not ok:\n#    - Status LED (typically amber/red for fault)\n#    - Both power cords seated and AC present on its feed\n#    An AC failure on one feed is a facility issue, not a\n#    hardware swap.\n\n# 5. Hot-swap the failed PSU (enterprise chassis), wait for\n#    its status LED to turn green, then re-check:\nsudo ipmitool sdr type 'Power Supply' 2>/dev/null",
    ],
  ],
  nvme_critical_warning: [
    ["Reserved blocks below threshold; SSD nearing end of life.", "Reserved blocks below the drive's spare threshold."],
    ["Plan replacement; data may still be readable but failure\n#   is forecast.", "Plan replacement; data may still be readable."],
  ],
  disk_io_errors: [
    ["Recent backup verified (the affected drive may be on the verge of total failure)", "Recent backup verified before working on a drive that reports errors"],
    // `dmesg -C` empties the whole kernel ring buffer, the output the reader
    // would paste next; it is not an error counter (R5-2).
    [
      "# 5. Once root cause is addressed, clear the kernel error\n#    counter (informational; the underlying issue must be\n#    fixed first):\nsudo dmesg -C",
      "# 5. Keep the kernel log: it is the record of these errors.\n#    dmesg -C empties the whole ring buffer (it is not a\n#    counter) and cannot be undone; save it first if you\n#    ever clear it:\n#    sudo dmesg -T > /root/dmesg-$(date +%F).txt",
    ],
  ],
  gpu_corrected_ecc_storm: [
    [
      '#    (cross-snapshot signal; future rule), plan preventive\n#    replacement. Per-snapshot the threshold is "level is\n#    unusually high"; cross-snapshot rate-based detection\n#    is a follow-up.',
      "#    between readings taken some time apart, plan preventive\n#    replacement. One reading shows only whether the level is\n#    unusually high.",
    ],
  ],
};

// The aggregate PS Redundancy sensor (Dell) reports that redundancy is gone,
// not why: a failed supply or feed, or total draw above what the remaining
// supplies carry. The YAML summary says a PSU is in fault, a cause the
// evaluator itself declines to state (R3-8).
const PSU_AGGREGATE_SUMMARY =
  "The BMC's aggregate PS Redundancy sensor reports redundancy lost or degraded. It does not say why: a supply or its feed has failed, or total draw is above what the remaining supplies can carry. Check each supply's status row before replacing anything.";

// Branches of a rule whose YAML title says something the finding does not:
// "ZFS scrub found errors" on a pool that was never scrubbed (R2-11). Constant
// text keyed on sanitized evidence, never built from the paste.
const NEVER_SCRUBBED = {
  title: "ZFS pool has never been scrubbed",
  summary:
    "The pool shows no record of a scrub. A scrub reads every block and finds silent corruption; a just-created pool simply needs its first one. This is a maintenance gap reported at info, not a fault.",
};

// raid_degraded on an md array the reader saw rebuilding with no failed
// member: a fresh build, or recovery onto a replacement already added. The
// YAML says disks have failed and walks through triaging the failed member
// and adding a replacement (R5-3).
const REBUILDING_TITLE = "RAID array degraded while it rebuilds";
const REBUILDING_SUMMARY =
  "The array is degraded while it rebuilds onto a member that is attached but not yet in sync; this output names no failed member. Until the rebuild finishes, the array has less redundancy than it was built with. Check /proc/mdstat again later for the rebuild's progress.";
const REBUILDING_QUICK_CHECK = {
  command: "cat /proc/mdstat",
  explanation:
    "The recovery line shows the rebuild's progress and estimated finish. Run it again later: the rebuild is done when the array's slot map shows every member as U (for example [UU] or [UUUU]) and no recovery line is left.",
};

const PCIE_WIDTH_ONLY_EXPLANATION =
  "nvidia-smi reports the negotiated PCIe generation and width against the card's maximum; the sysfs walk shows the kernel's view, including max_link_width. At the same generation, a narrower link is expected in a slot wired for fewer lanes; check the slot's electrical width (chassis or board manual) before reseating.";

const RECOVERABLE_SENSE_KEYS = new Set(["Recovered Error", "Not Ready", "Unit Attention"]);

// Sense keys the kernel maps to a target failure and does not retry
// (scsi_check_sense). Constant text keyed on the sanitized sense key (R4-4).
const TARGET_FAILURE_SUMMARY =
  "The kernel treats this sense key as a target failure and does not retry the command. The key is under observed; cross-check SMART for the drive and the kernel lines around this one.";
const TARGET_FAILURE_SENSE: Record<string, { title: string; summary: string }> = {
  "Data Protect": {
    title: "Drive refused a command (Data Protect)",
    summary:
      "The kernel reported a Data Protect sense key on this drive: the drive or LUN refused the command as write-protected or access-denied, and the kernel does not retry it. A read-only end-of-life SSD, a locked self-encrypting drive and a read-only LUN all report this; the Add. Sense line says which. Check SMART for the drive.",
  },
  "Blank Check": { title: "SCSI target-failure sense key", summary: TARGET_FAILURE_SUMMARY },
  "Copy Aborted": { title: "SCSI target-failure sense key", summary: TARGET_FAILURE_SUMMARY },
  "Volume Overflow": { title: "SCSI target-failure sense key", summary: TARGET_FAILURE_SUMMARY },
  Miscompare: { title: "SCSI target-failure sense key", summary: TARGET_FAILURE_SUMMARY },
};

// YAML titles that name a source the answer did not read: mce_uncorrected
// reads the EDAC UE count only, and was titled a machine check beside a note
// saying machine-check lines were not decoded (R2b-16).
const TRIAGE_TITLE: Record<string, string> = {
  mce_uncorrected: "Uncorrected memory error reported by EDAC",
};

// Evidence that misleads in a paste answer: ipmi_sel_critical's
// total_events_in_sel counts only critical asserted rows, not the SEL.
const TRIAGE_DROP_OBSERVED: Record<string, readonly string[]> = {
  ipmi_sel_critical: ["total_events_in_sel"],
};

// gpu_xid_critical's count is named for the live agent's 24 h dmesg window; a
// paste has no window, and the count covers every event in it of any age,
// undated ones included (R4-13).
const TRIAGE_RENAME_OBSERVED: Record<string, Readonly<Record<string, string>>> = {
  gpu_xid_critical: { events_in_window: "events_in_paste" },
};

// The evaluator's stand-in for a value it could not find, not a reading.
// smartctl's reader writes "unknown" for a paste with no model line (R5-15).
const PLACEHOLDER_OBSERVED = new Set(["gpu_uuid", "gpu_name", "model"]);

// ---------------------------------------------------------------------------
// Output contract (also the MCP tool's outputSchema)
// ---------------------------------------------------------------------------

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const analysisOutputShape = {
  input: z.object({
    formats: z.array(z.enum(TRIAGE_FORMATS)),
    bytes: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    subjects: z.number().int().nonnegative(),
  }).strict(),
  findings: z.array(
    z.object({
      rule_id: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
      title: z.string(),
      subject: z.object({
        kind: z.enum(SUBJECT_KINDS),
        id: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
      }).strict(),
      summary: z.string(),
      observed: z.record(scalar),
      fix: z.object({
        quick_check: z.object({ command: z.string(), explanation: z.string() }).strict().optional(),
        steps: z.array(z.object({ title: z.string(), command: z.string().optional() }).strict()).optional(),
        verdict_prior: z
          .enum(["recoverable", "investigation", "vendor-side"])
          .optional()
          .describe("Static ownership prior for this rule from Glassmkr's fix workflow (recoverable: a host-side fix; investigation: needs diagnosis; vendor-side: usually hardware or vendor escalation). A prior for the rule, not a conclusion drawn from this paste."),
      }).strict().nullable(),
    }).strict(),
  ),
  checked_no_signal: z.array(z.object({ rule_id: z.string(), title: z.string() }).strict()),
  not_determinable: z.array(z.object({ signal: z.string(), reason: z.string() }).strict()),
  next_capture: z.array(z.object({ goal: z.string(), command: z.string(), why: z.string() }).strict()),
  notes: z.array(z.string()),
  // Only when the paste held something the rules read (R1-22).
  continuous_monitoring: z.object({
    docs_url: z.literal("https://glassmkr.com/docs/getting-started?ref=mcp-triage"),
    source_url: z.literal("https://github.com/glassmkr/crucible"),
  }).strict().optional(),
};

export const analysisOutputSchema = z.object(analysisOutputShape).strict();
export type TriageAnalysis = z.infer<typeof analysisOutputSchema>;
type Finding = TriageAnalysis["findings"][number];
type Observed = Finding["observed"];

export interface AnalyzeOptions {
  /** os-release ID (ubuntu, debian, rhel, ...) for distro-specific fix variants. */
  distro?: string;
  /** Caller's guess at the format. Runs that domain's parser even if detect() missed. */
  formatHint?: TriageFormat;
  /** Parser list. Defaults to the registry; tests pass small fakes. */
  parsers?: readonly TriageParser[];
}

// ---------------------------------------------------------------------------
// Snapshot merge
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isEmptyScalar(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Merge one parser's value into the accumulated one. Two domains can share a
 * container (kernel_log writes gpu.tier1.xid_events, nvidia_gpu writes
 * gpu.tier1.gpus), so objects merge key by key and arrays concatenate.
 * Booleans OR together: a parser that saw data marks its container available,
 * and another parser that did not see that part must not switch it off.
 * Other scalars keep the first non-empty value.
 */
function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) return [...existing, ...incoming];
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const out: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) out[k] = mergeValue(out[k], v);
    return out;
  }
  if (typeof existing === "boolean" && typeof incoming === "boolean") return existing || incoming;
  return isEmptyScalar(existing) ? incoming : existing;
}

function mergeSlices(results: ParserResult[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const result of results) {
    // A parser may only write the keys its domain owns; anything else is a
    // parser bug and is ignored rather than allowed to wake an unrelated rule.
    for (const key of DOMAIN_SNAPSHOT_KEYS[result.domain]) {
      const value = (result.snapshot as Record<string, unknown>)[key];
      if (value === undefined) continue;
      merged[key] = mergeValue(merged[key], value);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * evaluateAlerts already catches a rule that throws and logs it with
 * console.error("Alert rule <type> error:", err). A partial snapshot is exactly
 * where that can happen, so the call is wrapped to learn WHICH rules threw (they
 * did not check anything and must not be reported as "no matching signal") and
 * to keep the error object, which can quote snapshot values, out of the log.
 *
 * Rules also log their decision path with console.log (psu_redundancy_loss
 * prints PSU counts and states on every evaluation), which the privacy policy's
 * "one line per call" does not cover (R2-21). Those calls are dropped here
 * rather than in the evaluator, whose path logs serve the ingest path.
 *
 * The call is synchronous, so swapping the console methods cannot catch anyone
 * else's output.
 */
function evaluateCapturingFailures(
  snapshot: Snapshot,
  config: ServerConfig,
): { results: AlertResult[]; failed: string[] } {
  const failed: string[] = [];
  const original = { error: console.error, log: console.log, info: console.info, debug: console.debug };
  const silent = () => {};
  console.error = (...args: unknown[]) => {
    const m = typeof args[0] === "string" ? /^Alert rule (\S+) error:$/.exec(args[0]) : null;
    if (m) {
      failed.push(m[1]);
      return;
    }
    original.error(...args);
  };
  console.log = silent;
  console.info = silent;
  console.debug = silent;
  try {
    const results = evaluateAlerts(snapshot, config);
    return { results, failed };
  } catch {
    // Outside the per-rule guard (phase bookkeeping). Report every rule as
    // unevaluated rather than crash the tool call.
    return { results: [], failed: ["*"] };
  } finally {
    console.error = original.error;
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
  }
}

// ---------------------------------------------------------------------------
// Evidence shaping
// ---------------------------------------------------------------------------

// Free text, raw log lines, internal bookkeeping, or values that only make
// sense for a live agent. Never shown.
const DROP_KEYS = new Set([
  "raw_line",
  "raw_message",
  "message",
  "recommendation",
  "fix_commands",
  "note",
  "errors_text",
  "details",
  "options",
  "parser_quality",
  "severity_reason",
  "window_days",
  "events_outside_window",
  "log_full_event",
  "triggering_signals",
  "verdict_prior_override",
]);

// Short human labels that legitimately contain spaces (drive and GPU models,
// SCSI sense keys, SEL component names). Everything else must be a single
// token; a string with whitespace in any other field is treated as free text.
const LABEL_KEYS = new Set(["model", "gpu_name", "sense_key", "xid_summary", "affected_components"]);

const SUBJECT_ID_KEYS = ["device", "pool", "controller", "pci_bdf", "gpu_uuid"] as const;
const SUBJECT_MODEL_KEYS = ["model", "gpu_name"] as const;

// The smartctl parser names a drive read through a RAID controller the way
// Crucible does: "/dev/bus/0[sat+megaraid,8]" (path, then the smartctl -d
// type). safeIdent would drop the brackets and the comma and print a device
// that does not exist, so this one validated shape is kept whole. It is never
// interpolated into a fix command (see fixEvidence).
const PASSTHROUGH_DEVICE = /^\/dev\/[A-Za-z0-9/_.-]{1,48}\[(?:sat\+)?(?:megaraid|cciss|3ware|aacraid|areca|marvell),\d{1,4}\]$/;

// The smartctl parser's stand-in when a text paste never names its device.
const UNKNOWN_DEVICE = /^unknown-device(?:-\d+)?$/;

function cleanDevice(value: string): string {
  const v = value.trim();
  return PASSTHROUGH_DEVICE.test(v) ? v : safeIdent(v, 64);
}

function cleanString(key: string, value: string): string {
  if (LABEL_KEYS.has(key)) return safeLabel(value, 64);
  if (/\s/.test(value.trim())) return "";
  if (key === "device") return cleanDevice(value);
  return safeIdent(value.trim(), 64);
}

// Rules that report several components at once list them as objects
// (failed_fans, faulted_slogs, unreadable_devices, affected_dimms). Only each
// item's name is kept, joined into one list, so the answer says WHICH fan or
// disk failed without carrying any of the item's other fields. Without this
// the whole array was dropped and drive_smart_unreadable, ipmi_fan_failure and
// zfs_slog_faulted named nothing at all.
const ITEM_ID_KEYS = ["device", "vdev", "label"] as const;

// Lists whose items are named by a `name` that may hold spaces, with the real
// length of that name. Explicit per list: a generic cap would cut a GPU model
// in drifted_models to a misleading fragment, and a generous one would let a
// sentence ride along in a 16-byte sensor name.
const NAMED_ITEM_LISTS: Record<string, number> = {
  failed_fans: 16, // ipmi_fan_failure: an IPMI SDR id is at most 16 bytes
  failed: 16, // psu_redundancy_loss per-PSU path: IPMI sensor names
  drifted_models: 64, // gpu_driver_or_firmware_drift: GPU product names
};

function itemName(listKey: string, item: Record<string, unknown>): string {
  for (const key of ITEM_ID_KEYS) {
    const v = item[key];
    if (typeof v !== "string" || !v.trim()) continue;
    return key === "device" ? cleanDevice(v) : safeIdent(v.trim(), 64);
  }
  const max = NAMED_ITEM_LISTS[listKey];
  // Commas would blur the joined list.
  if (max && typeof item.name === "string") return safeLabel(item.name, max).replace(/,/g, " ").trim();
  return "";
}

/** The one value every item shares for `key`, or "" when absent or mixed. */
function sharedItemValue(items: Record<string, unknown>[], key: string): string {
  const values = new Set(items.map((i) => (typeof i[key] === "string" ? safeIdent((i[key] as string).trim(), 64) : "")));
  if (values.size !== 1) return "";
  return [...values][0];
}

/** Scalar-only, sanitized copy of a rule's evidence. */
function sanitizeEvidence(evidence: Record<string, unknown>): Observed {
  const out: Observed = {};
  let count = 0;
  let sharedPool = "";
  for (const [key, value] of Object.entries(evidence)) {
    if (count >= MAX_OBSERVED_KEYS) break;
    if (DROP_KEYS.has(key) || !/^[A-Za-z0-9_]{1,48}$/.test(key)) continue;
    let clean: string | number | boolean | null | undefined;
    let total: { key: string; value: number } | null = null;
    if (value === null) clean = null;
    else if (typeof value === "number") clean = Number.isFinite(value) ? value : undefined;
    else if (typeof value === "boolean") clean = value;
    else if (typeof value === "string") clean = cleanString(key, value) || undefined;
    else if (Array.isArray(value)) {
      // Short lists of identifiers (failed members, link ids, flag names) are
      // joined into one token list; lists of objects keep only each item's
      // name; anything with prose is dropped. A longer list keeps its first
      // MAX_ARRAY_ITEMS items plus its real length: dropped whole, an HBA
      // fault on 24 disks named none of them (R2-7).
      if (value.length === 0) continue;
      const list = value.slice(0, MAX_ARRAY_ITEMS);
      if (list.every(isPlainObject)) {
        const items = list.map((item) => itemName(key, item)).filter(Boolean);
        if (items.length !== list.length) continue;
        if (NAMED_ITEM_LISTS[key]) {
          // Names the paste chose (GPU products, sensor names): a few whole
          // names and a count, as for affected_components. Sixteen 64-character
          // product names joined into ~1 KB of paste text in the evidence
          // (R2b-13).
          const names = value.slice(0, 256).filter(isPlainObject).map((item) => itemName(key, item)).filter(Boolean);
          clean = boundedNameList([...new Set(names)], ",") ?? undefined;
        } else clean = items.join(",");
        // zfs_slog_faulted names its pool only inside each item.
        sharedPool ||= sharedItemValue(list, "pool");
      } else {
        if (!list.every((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) continue;
        const items = list
          .map((v) => (typeof v === "number" ? String(v) : /\s/.test(v.trim()) ? "" : safeIdent(v.trim(), 64)))
          .filter(Boolean);
        clean = items.length > 0 ? items.join(",") : undefined;
      }
      if (clean !== undefined && value.length > list.length) total = { key: `${key}_total`, value: value.length };
    }
    if (clean === undefined) continue;
    out[key] = clean;
    count += 1;
    if (total && count < MAX_OBSERVED_KEYS && /^[A-Za-z0-9_]{1,48}$/.test(total.key)) {
      out[total.key] = total.value;
      count += 1;
    }
  }
  if (sharedPool && out.pool === undefined) out.pool = sharedPool;
  return out;
}

/**
 * Evidence for resolveFix. A placeholder device ("unknown-device", the paste
 * never named it) or a controller passthrough id (brackets are a shell glob)
 * would produce a command that cannot run as printed, so the device is left
 * out and the fix template renders its own `<device>` placeholder instead.
 */
function fixEvidence(evidence: Observed): Observed {
  const device = evidence.device;
  if (typeof device !== "string" || !(UNKNOWN_DEVICE.test(device) || PASSTHROUGH_DEVICE.test(device))) return evidence;
  const { device: _omit, ...rest } = evidence;
  void _omit;
  return rest;
}

// The characters a paste-derived value may carry into a fix command. The
// sanitizer's charsets keep "(", ")", ":", "#" and spaces, which are inert as
// data but not as shell words: in zsh, `/(e:id:)` before a space runs `id`
// (R4-2).
const COMMAND_SAFE = /^[A-Za-z0-9._/+-]{1,64}$/;

/**
 * Evidence resolveFix may interpolate into commands: numbers, booleans and
 * single command-safe tokens only, never a label (models, sensor lists). A
 * value left out renders as the template's `<key>` placeholder. The
 * explanation, which is prose, still reads the full evidence.
 */
function commandEvidence(evidence: Observed): Observed {
  const out: Observed = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === "string" && (LABEL_KEYS.has(key) || !COMMAND_SAFE.test(value))) continue;
    out[key] = value;
  }
  return out;
}

function subjectKind(ruleId: string, observed: Observed, ruleDomain: TriageDomain | undefined): SubjectKind {
  if (ruleId === "ecc_errors") return observed.source === "edac" ? "kernel" : "bmc";
  if (RULE_KIND[ruleId]) return RULE_KIND[ruleId];
  if (ruleId.startsWith("gpu_")) return "gpu";
  return ruleDomain ? DOMAIN_KIND[ruleDomain] : "kernel";
}

function pickString(observed: Observed, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const v = observed[key];
    if (typeof v === "string" && v && v !== "unknown") return { key, value: v };
  }
  return null;
}

// Shell placeholders some fix commands leave for the operator (smart_failing's
// ${DEVICE}, disk_io_errors' ${DEVICES}). resolveFix keeps them for the
// dashboard, which prints "substitute the device" beside each command; an
// answer here carries the commands alone, and run as printed with DEVICE unset
// smart_failing's RAID check says "not a RAID member" (R1-20).
const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEVICE_PLACEHOLDER = "<device>";

/** Kernel names of the devices a finding is about, for the shell placeholders. */
function fixDevices(evidence: Observed): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const part of value.split(",")) {
      const name = part.trim().replace(/^\/dev\//, "");
      if (DEVICE_NAME.test(name) && !UNKNOWN_DEVICE.test(name) && !out.includes(name)) out.push(name);
    }
  };
  if (typeof evidence.device === "string") {
    if (!PASSTHROUGH_DEVICE.test(evidence.device)) add(evidence.device);
  } else if (evidence.devices !== undefined) add(evidence.devices);
  else add(evidence.controller);
  return out;
}

function fillDevices(command: string, devices: string[]): string {
  return command
    .replace(/\$\{DEVICE\}/g, devices.length === 1 ? devices[0] : DEVICE_PLACEHOLDER)
    .replace(/\$\{DEVICES\}/g, devices.length > 0 ? devices.join(" ") : DEVICE_PLACEHOLDER);
}

/** The quick check's explanation with its {{key}} tokens filled; a token with no value is left out. */
function explanation(description: string, evidence: Observed): string {
  const has = (key: string) => ["string", "number", "boolean"].includes(typeof evidence[key]);
  const text = description
    .replace(/\s*\(\{\{(\w+)\}\}\)/g, (full: string, key: string) => (has(key) ? full : ""))
    .replace(/\{\{(\w+)\}\}/g, (full: string, key: string) => (has(key) ? full : ""));
  return interpolateEvidence(text, evidence);
}

function buildFix(ruleId: string, fix: ResolvedFix | null, evidence: Observed): Finding["fix"] {
  if (!fix) return null;
  const devices = fixDevices(evidence);
  const replacements = TRIAGE_TEXT_REPLACE[ruleId] ?? [];
  const text = (t: string) => replacements.reduce((acc, [from, to]) => acc.split(from).join(to), t);
  const cmd = (c: string) => fillDevices(text(c), devices);
  const steps: NonNullable<NonNullable<Finding["fix"]>["steps"]> = [];
  for (const p of fix.prerequisites) steps.push({ title: `Before you start: ${text(p)}` });
  if (fix.safe_mode) steps.push({ title: "Confirm the current state (read-only)", command: cmd(fix.safe_mode.command) });
  steps.push({ title: "Remediation", command: cmd(fix.command) });
  if (fix.validation) steps.push({ title: "Confirm the fix worked", command: cmd(fix.validation.command) });
  const override = TRIAGE_QUICK_CHECK[ruleId];
  const quick = override ?? {
    command: cmd(fix.quick_check.command),
    explanation: text(explanation(fix.quick_check.description, evidence)),
  };
  if ([quick.command, ...steps.map((s) => s.command ?? "")].some((c) => c.includes(DEVICE_PLACEHOLDER))) {
    steps.unshift({ title: `Replace ${DEVICE_PLACEHOLDER} in the commands below with the affected disk's kernel name, for example sda or nvme0n1` });
  }
  const total = evidence.devices_total;
  const listed = [fix.quick_check.command, fix.safe_mode?.command, fix.command, fix.validation?.command].some((c) => c?.includes("${DEVICES}"));
  if (listed && typeof total === "number" && devices.length > 0 && total > devices.length) {
    steps.unshift({ title: `The commands below cover the first ${devices.length} of ${total} devices; run them again for the rest.` });
  }
  const out: NonNullable<Finding["fix"]> = { quick_check: quick, steps };
  if (fix.verdict_prior) out.verdict_prior = fix.verdict_prior;
  return out;
}

function triageSummary(ruleId: string): string {
  return TRIAGE_SUMMARY[ruleId] ?? (getRuleMetadata(ruleId)?.summary ?? "").trim();
}

const NO_LOCATOR: ServerLocator = { os_id: null, os_id_like: null, os_version_id: null, dmi_vendor: null };

/**
 * A rule's summary and quick check as a paste answer shows them when nothing
 * from the paste fills them in. For the test that keeps dashboard-only wording
 * out of triage answers.
 */
export function triageRuleCopy(ruleId: string): {
  summary: string;
  quick_check: { command: string; explanation: string } | null;
  fix: Finding["fix"];
} {
  const fix = buildFix(ruleId, resolveFix(ruleId, {}, NO_LOCATOR), {});
  return { summary: triageSummary(ruleId), quick_check: fix?.quick_check ?? null, fix };
}

// A UTC time as the readers write it into the snapshot.
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * A finding without its fix workflow, and the call that builds it. Resolving
 * and interpolating a workflow is most of a finding's cost, and the answer
 * keeps at most MAX_FINDINGS: a 200 KB paste of faulted vdevs resolved about
 * 9,000 workflows and threw all but 30 away (R4-15). Dedupe and the cap read
 * only the finding, so the fix is built for the ones the answer keeps.
 */
interface ShapedFinding {
  finding: Finding;
  fix: () => Finding["fix"];
}

interface FixAdjust {
  /** gpu_pcie_link_degraded narrower than the card at the same generation. */
  widthOnly: boolean;
  /** raid_degraded on an array that is rebuilding with no failed member (R5-3). */
  rebuildingOnly?: boolean;
  /** A branch whose prior differs from the rule's YAML default. */
  verdictPrior?: "recoverable" | "investigation";
}

function findingFix(ruleId: string, safeEvidence: Observed, locator: ServerLocator, adjust: FixAdjust): Finding["fix"] {
  let fix: Finding["fix"];
  try {
    // The sanitized evidence, not the raw one: resolveFix interpolates
    // {{key}} tokens into commands, and only re-sanitized values may land there.
    const fixEv = fixEvidence(safeEvidence);
    fix = buildFix(ruleId, resolveFix(ruleId, commandEvidence(fixEv), locator), fixEv);
  } catch {
    return null;
  }
  if (!fix) return null;
  // The YAML explanation calls Gen 4 x8 on a Gen 4 x16 card "a slot, cable,
  // or firmware issue", beside a summary that calls it expected in a slot
  // wired for fewer lanes (R4-10).
  if (adjust.widthOnly && fix.quick_check) fix.quick_check.explanation = PCIE_WIDTH_ONLY_EXPLANATION;
  // No failed member to triage and no replacement to add: the read-only
  // state check is the whole workflow.
  if (adjust.rebuildingOnly) {
    fix.quick_check = { ...REBUILDING_QUICK_CHECK };
    fix.steps = (fix.steps ?? []).filter((s) => s.title === "Confirm the current state (read-only)");
  }
  if (adjust.verdictPrior) fix.verdict_prior = adjust.verdictPrior;
  return fix;
}

function shapeFinding(
  alert: AlertResult,
  ruleDomain: TriageDomain | undefined,
  locator: ServerLocator,
  zonelessSel = false,
  rebuilding: ReadonlyMap<string, string | undefined> = new Map(),
): ShapedFinding {
  const meta = getRuleMetadata(alert.type);
  const safeEvidence = sanitizeEvidence(alert.evidence ?? {});
  const kind = subjectKind(alert.type, safeEvidence, ruleDomain);

  const subject: Finding["subject"] = { kind };
  const used = new Set<string>();
  const id = pickString(safeEvidence, SUBJECT_ID_KEYS);
  if (id) {
    subject.id = id.value;
    used.add(id.key);
  }
  const model = pickString(safeEvidence, SUBJECT_MODEL_KEYS);
  if (model) {
    subject.model = model.value;
    used.add(model.key);
  }
  const serial = pickString(safeEvidence, ["serial"]);
  if (serial) {
    subject.serial = serial.value;
    used.add(serial.key);
  }

  const observed: Observed = {};
  const dropped = TRIAGE_DROP_OBSERVED[alert.type] ?? [];
  const renamed = TRIAGE_RENAME_OBSERVED[alert.type] ?? {};
  for (const [k, v] of Object.entries(safeEvidence)) {
    if (used.has(k) || dropped.includes(k) || (PLACEHOLDER_OBSERVED.has(k) && v === "unknown")) continue;
    observed[renamed[k] ?? k] = v;
  }
  // The SEL printed its times with no zone; the "Z" the snapshot needs for
  // the age comparisons would state one (R4-11).
  if (zonelessSel && (ruleDomain === "ipmi_sel" || observed.source === "ipmi_sel")) {
    for (const [k, v] of Object.entries(observed)) if (typeof v === "string" && UTC_SECONDS.test(v)) observed[k] = v.slice(0, -1);
  }
  // A span with one end undated covers only the dated events, and read as
  // the span of all of them (R4-13).
  const dated = (v: unknown) => typeof v === "string" && v !== "";
  if (typeof observed.events_in_paste === "number" && observed.events_in_paste > 1 && dated(observed.first_event_iso) !== dated(observed.last_event_iso)) {
    delete observed.first_event_iso;
    delete observed.last_event_iso;
  }

  let severity = alert.severity;
  let title = TRIAGE_TITLE[alert.type] ?? meta?.title ?? alert.type;
  let summary = triageSummary(alert.type);
  // The YAML verdict prior is the rule's default; a branch the triage below
  // marks benign carries "recoverable" so it does not say "vendor-side" beside
  // "common and recoverable on their own" (R2-14).
  let recoverable = false;
  let investigation = false;
  let widthOnly = false;
  if (alert.type === "zfs_scrub_errors" && observed.scrub_never_run === true) {
    title = NEVER_SCRUBBED.title;
    summary = NEVER_SCRUBBED.summary;
    recoverable = true;
  }
  // A recoverable sense key (Recovered Error, Not Ready, Unit Attention): the
  // evaluator itself calls these common and says to escalate only on repeats,
  // but that text is in the message this answer drops, and the YAML summary
  // says "investigate immediately to prevent data loss" (R1-17). Only those
  // three: Data Protect is a drive refusing writes, and the kernel does not
  // retry it or the other target-failure keys (R4-4). Illegal Request and
  // Vendor Specific keep the rule's own copy.
  const senseKey = alert.type === "disk_io_errors" && observed.scope === "scsi_sense" && severity !== "critical" ? observed.sense_key : undefined;
  if (typeof senseKey === "string" && RECOVERABLE_SENSE_KEYS.has(senseKey)) {
    observed.severity_basis = "recoverable_sense_key";
    title = "Recoverable SCSI sense key";
    summary =
      "The kernel reported a recoverable SCSI sense key on this drive (Recovered Error, Not Ready or Unit Attention). These are common and recoverable on their own; cross-check SMART for the drive, and treat them as a fault when they keep recurring in later logs.";
    recoverable = true;
  } else if (typeof senseKey === "string" && TARGET_FAILURE_SENSE[senseKey]) {
    observed.severity_basis = "target_failure_sense_key";
    ({ title, summary } = TARGET_FAILURE_SENSE[senseKey]);
    investigation = true;
  }
  // nvidia-smi's width maximum is the card's, never the slot's, and a paste has
  // no slot width (the agent reads it from sysfs). Narrower than the card with
  // the generation intact is exactly what a GPU in a slot wired for fewer lanes
  // shows, which the dashboard does not flag (R1-19).
  if (alert.type === "gpu_pcie_link_degraded" && observed.pcie_slot_max_width === null) {
    const genCur = observed.pcie_link_gen_current;
    const genMax = observed.pcie_link_gen_max;
    const genDown = typeof genCur === "number" && typeof genMax === "number" && genMax > 0 && genCur < genMax;
    if (!genDown) {
      severity = "info";
      observed.width_ceiling_basis = "card_max_slot_unknown";
      title = "GPU PCIe link narrower than card maximum";
      summary =
        "The GPU's PCIe link is narrower than the card's maximum width at the same generation. nvidia-smi does not show the slot's electrical width, so this output cannot tell a slot wired for fewer lanes (expected, not a fault) from a link that trained down; check the slot's width before re-seating anything.";
      widthOnly = true;
    }
  }

  if (alert.type === "psu_redundancy_loss" && observed.path === "aggregate-redundancy") {
    summary = PSU_AGGREGATE_SUMMARY;
    investigation = true;
  }
  let rebuildingOnly = false;
  if (
    alert.type === "raid_degraded" &&
    observed.raid_kind === "mdadm" &&
    subject.id !== undefined &&
    rebuilding.has(subject.id) &&
    observed.failed_disks === undefined
  ) {
    observed.rebuilding = true;
    const member = rebuilding.get(subject.id);
    if (member) observed.rebuilding_member = member;
    title = REBUILDING_TITLE;
    summary = REBUILDING_SUMMARY;
    recoverable = true;
    rebuildingOnly = true;
  }
  // Watchdog and "other" sensors (a watchdog reset, a Power Unit AC loss, an
  // OS critical stop) record what the host went through, not a part the BMC
  // found failed, so the rule's vendor-side prior does not fit (R5-5).
  if (
    alert.type === "ipmi_sel_critical" &&
    typeof observed.sensor_types === "string" &&
    observed.sensor_types.split(",").every((t) => t === "watchdog" || t === "other")
  ) {
    investigation = true;
  }

  const adjust: FixAdjust = {
    widthOnly,
    rebuildingOnly,
    verdictPrior: investigation ? "investigation" : recoverable ? "recoverable" : undefined,
  };
  return {
    finding: {
      rule_id: alert.type,
      severity,
      title,
      subject,
      summary,
      observed,
      fix: null,
    },
    fix: () => findingFix(alert.type, safeEvidence, locator, adjust),
  };
}

// Timestamps and counters that differ between otherwise identical events.
const VOLATILE_KEY = /timestamp|_iso$|^age_|^events_in_(?:window|paste)$/;

function findingKey(f: Finding): string {
  const stable = Object.entries(f.observed)
    .filter(([k]) => !VOLATILE_KEY.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([f.rule_id, f.severity, f.subject, stable]);
}

/** Collapse repeats (fifty identical NVMe resets) into one finding with a count. */
function dedupeFindings(findings: ShapedFinding[]): ShapedFinding[] {
  const byKey = new Map<string, { shaped: ShapedFinding; n: number }>();
  for (const s of findings) {
    const key = findingKey(s.finding);
    const hit = byKey.get(key);
    if (hit) hit.n += 1;
    else byKey.set(key, { shaped: s, n: 1 });
  }
  return [...byKey.values()].map(({ shaped, n }) =>
    n > 1 ? { ...shaped, finding: { ...shaped.finding, observed: { ...shaped.finding.observed, occurrences: n } } } : shaped,
  );
}

/**
 * At most `max` findings in their severity order, with the first of every
 * fired rule kept before any rule's second. Cut in order, a paste with thirty
 * critical disk errors hid a GPU that had fallen off the bus, and the note
 * said only that something was left out (R3-13).
 */
function capFindings(ordered: Finding[], max: number): Finding[] {
  if (ordered.length <= max) return ordered;
  const keep = new Set<number>();
  const rules = new Set<string>();
  ordered.forEach((f, i) => {
    if (keep.size < max && !rules.has(f.rule_id)) {
      rules.add(f.rule_id);
      keep.add(i);
    }
  });
  for (let i = 0; i < ordered.length && keep.size < max; i++) keep.add(i);
  return ordered.filter((_, i) => keep.has(i));
}

/** "disk_io_errors x3, gpu_xid_critical x2": the rules a cap left out, most first. */
function droppedRules(ordered: Finding[], kept: Finding[]): string {
  const counts = new Map<string, number>();
  const shown = new Set(kept);
  for (const f of ordered) if (!shown.has(f)) counts.set(f.rule_id, (counts.get(f.rule_id) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${safeIdent(rule, 48)} x${n}`);
  return list.length > 4 ? `${list.slice(0, 4).join(", ")} and ${list.length - 4} more rules` : list.join(", ");
}

// ---------------------------------------------------------------------------
// Event timing
// ---------------------------------------------------------------------------

interface SelRow {
  id?: unknown;
  timestamp?: unknown;
  sensor?: unknown;
  event?: unknown;
  direction?: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An event this much older than the newest SEL row in the paste is historical. */
const SEL_HISTORICAL_DAYS = 30;

function selTime(row: SelRow): number | null {
  if (typeof row.timestamp !== "string" || row.timestamp === "") return null;
  const t = Date.parse(row.timestamp);
  return Number.isFinite(t) ? t : null;
}

/**
 * When the critical SEL events ipmi_sel_critical counted happened, as scalars
 * the answer can carry. The rule keeps each event's age inside an array of
 * objects that the sanitizer drops, so without this an event from years ago,
 * long since deasserted, read like a current fault (R1-10). Every date is the
 * paste's own; "historical" is judged against the newest row in the paste,
 * never against the clock.
 */
function selTiming(alert: AlertResult, sel: SelRow[]): { evidence: Record<string, unknown>; historical: boolean } {
  const raw = alert.evidence?.critical_events;
  const critical: SelRow[] = Array.isArray(raw) ? raw.filter((e): e is SelRow => isPlainObject(e)) : [];
  const times = critical.map(selTime);
  const dated = times.filter((t): t is number => t !== null).sort((a, b) => a - b);
  // Deassertions per sensor + event, reduced to what "a later one exists"
  // needs, so a SEL of thousands of rows stays linear: the latest dated one,
  // and the highest record id among undated ones and among all of them.
  const deasserts = new Map<string, { time: number; undatedId: number; anyId: number }>();
  let newestRow: number | null = null;
  for (const d of sel) {
    const t = selTime(d);
    if (t !== null && (newestRow === null || t > newestRow)) newestRow = t;
    if (d.direction !== "Deasserted") continue;
    const key = `${String(d.sensor)}\u0000${String(d.event)}`;
    const id = typeof d.id === "number" ? d.id : -1;
    const k = deasserts.get(key) ?? { time: -Infinity, undatedId: -1, anyId: -1 };
    if (t !== null) k.time = Math.max(k.time, t);
    else k.undatedId = Math.max(k.undatedId, id);
    k.anyId = Math.max(k.anyId, id);
    deasserts.set(key, k);
  }
  const deasserted = critical.map((e, i) => {
    const k = deasserts.get(`${String(e.sensor)}\u0000${String(e.event)}`);
    if (!k) return false;
    const id = typeof e.id === "number" ? e.id : Infinity;
    const t = times[i];
    return t !== null ? k.time >= t || k.undatedId > id : k.anyId > id;
  });
  const evidence: Record<string, unknown> = {
    critical_events_counted: critical.length,
    critical_events_later_deasserted: deasserted.filter(Boolean).length,
  };
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (dated.length > 0) {
    evidence.oldest_critical_event = iso(dated[0]);
    evidence.newest_critical_event = iso(dated[dated.length - 1]);
  }
  if (dated.length < critical.length) evidence.critical_events_undated = critical.length - dated.length;
  const historical =
    critical.length > 0 &&
    critical.every((_, i) => {
      const t = times[i];
      const old = t !== null && newestRow !== null && newestRow - t > SEL_HISTORICAL_DAYS * DAY_MS;
      return old || deasserted[i];
    });
  return { evidence, historical };
}

const MAX_COMPONENTS = 3;
const COMPONENTS_CHARS = 64;

/**
 * ipmi_sel_critical's component list, rebuilt from whole sensor labels: at
 * most three, never cut mid-name, then "+N more". The rule joins every
 * critical sensor, and each is capped at 16 characters in the parser, so five
 * rows carried 64 characters of arranged prose, cut at the end (R2-18).
 */
function componentList(events: unknown): string | null {
  if (!Array.isArray(events)) return null;
  // A Set, not labels.includes: a SEL of thousands of distinct sensors was
  // quadratic (R4-14).
  const labels = new Set<string>();
  for (const e of events) {
    const label = isPlainObject(e) ? safeLabel(e.sensor, COMPONENTS_CHARS).replace(/,/g, " ").trim() : "";
    if (label) labels.add(label);
  }
  return boundedNameList([...labels], ", ");
}

/**
 * At most MAX_COMPONENTS whole names within COMPONENTS_CHARS, then "+N more"
 * for the rest. The first name is always kept (each is at most 64
 * characters), so a long one is never replaced by a bare count.
 */
function boundedNameList(labels: readonly string[], separator: string): string | null {
  if (labels.length === 0) return null;
  const kept: string[] = [];
  for (const label of labels) {
    if (kept.length === MAX_COMPONENTS) break;
    const rest = labels.length - kept.length - 1;
    const text = [...kept, label].join(separator) + (rest > 0 ? ` +${rest} more` : "");
    if (kept.length > 0 && text.length > COMPONENTS_CHARS) break;
    kept.push(label);
  }
  const more = labels.length - kept.length;
  return kept.join(separator) + (more > 0 ? ` +${more} more` : "");
}

function hasUnknownTimes(snapshot: Record<string, unknown>): boolean {
  const unknown = (ts: unknown) => typeof ts !== "string" || ts === "" || Number.isNaN(Date.parse(ts));
  const dmesg = snapshot.dmesg_events as { events?: Array<{ timestamp_iso?: unknown }> } | undefined;
  if (Array.isArray(dmesg?.events) && dmesg.events.some((e) => unknown(e?.timestamp_iso))) return true;
  const tier1 = (snapshot.gpu as { tier1?: { xid_events?: Array<{ timestamp_iso?: unknown }> } } | undefined)?.tier1;
  if (Array.isArray(tier1?.xid_events) && tier1.xid_events.some((e) => unknown(e?.timestamp_iso))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function countLines(text: string): number {
  if (text === "") return 0;
  const parts = text.split(/\r\n|\n|\r/);
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

// Parser notes are built from constants and counts by contract; this only
// strips control and bidi characters and bounds the length as a backstop.
function cleanNote(message: string): string {
  return message.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
}

function safeDetect(parser: TriageParser, text: string): boolean {
  try {
    return parser.detect(text) === true;
  } catch {
    return false;
  }
}

function normalizeDistro(distro: string | undefined): string | null {
  const id = safeIdent((distro ?? "").trim().toLowerCase(), 32).replace(/[^a-z0-9._-]/g, "");
  return id || null;
}

const CONTINUOUS_MONITORING = {
  docs_url: "https://glassmkr.com/docs/getting-started?ref=mcp-triage",
  source_url: "https://github.com/glassmkr/crucible",
} as const;

/**
 * The paste as the readers see it. "." in a JavaScript regex stops at U+2028
 * and U+2029, which no reader splits lines on, so any pattern with a
 * whitespace run before a trailing "(.*)$" retried every split of that run on
 * a line holding one: one anonymous 200 KB paste held the process for 40 s
 * (R2b-1). They become ordinary line breaks before any reader runs.
 */
function readerText(text: string): string {
  // An email, chat or web copy turns runs of spaces into no-break spaces, and
  // can carry a byte-order mark or zero-width spaces; the readers' patterns
  // match ASCII space, so 39 of 106 recognised fixtures read as nothing
  // (R5-12). Every horizontal Unicode space separator becomes a space, one
  // for one, and every format character goes: a right-to-left chat client or
  // web console marks each line with a bidi control, and an LRM at each line
  // start left 74 of 82 fixtures with no finding (R6-11). No reader pattern
  // matches one, and the identifiers they read are ASCII.
  return text
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/\p{Cf}/gu, "");
}

/** Analyze pasted command output with Glassmkr's alert rules. */
export function analyzeOutput(text: string, opts: AnalyzeOptions = {}): TriageAnalysis {
  const parsers = opts.parsers ?? TRIAGE_PARSERS;
  const hintDomain = opts.formatHint ? FORMAT_DOMAIN[opts.formatHint] : undefined;
  const notes: string[] = [];
  // Bytes and lines below are counted on the paste as given.
  const read = readerText(text);

  // 1. Detect and parse.
  const parsed: Array<{ parser: TriageParser; result: ParserResult; detected: boolean }> = [];
  for (const parser of parsers) {
    const detected = safeDetect(parser, read);
    if (!detected && parser.domain !== hintDomain) continue;
    try {
      parsed.push({ parser, result: parser.parse(read), detected });
    } catch {
      notes.push(`The ${parser.domain} reader failed on this input and was skipped.`);
    }
  }

  const formats: TriageFormat[] = [];
  const warnings = new Set<string>(notes);
  for (const { result } of parsed) {
    for (const f of result.formats ?? []) if (!formats.includes(f)) formats.push(f);
    for (const n of result.notes ?? []) {
      const note = cleanNote(String(n?.message ?? ""));
      if (note && !notes.includes(note)) notes.push(note);
      if (note && n?.level === "warning") warnings.add(note);
    }
  }

  // 2. Only parsers that recognised something take part in evaluation, so a
  // garbage paste never earns a "checked, no matching signal" line.
  const active = parsed.filter(({ result }) => (result.subjects ?? 0) > 0);
  const subjects = active.reduce((sum, { result }) => sum + result.subjects, 0);

  const allow: string[] = [];
  const ruleDomain = new Map<string, TriageDomain>();
  for (const { parser, result } of active) {
    // rules_checked can only narrow the parser's own list, never widen it.
    const checked = Array.isArray(result.rules_checked)
      ? parser.rules.filter((r) => result.rules_checked!.includes(r))
      : parser.rules;
    for (const rule of checked) {
      if (!ruleDomain.has(rule)) ruleDomain.set(rule, parser.domain);
      if (!allow.includes(rule)) allow.push(rule);
    }
  }

  // 3. Evaluate with every other rule muted.
  const merged = mergeSlices(active.map(({ result }) => result));
  let alerts: AlertResult[] = [];
  let failed: string[] = [];
  if (allow.length > 0) {
    const allowSet = new Set(allow);
    const snapshot = { collector_version: TRIAGE_COLLECTOR_VERSION, ...merged } as unknown as Snapshot;
    const evaluation = evaluateCapturingFailures(snapshot, {
      muted_rules: listMetadataRuleTypes().filter((t) => !allowSet.has(t)),
      ipmi_sel_critical_window_days: SEL_WINDOW_DAYS,
    });
    // Belt and braces: a rule without YAML metadata cannot be muted by type,
    // so anything outside the allowlist is dropped here too.
    alerts = evaluation.results.filter((a) => allowSet.has(a.type));
    failed = evaluation.failed;
    for (const rule of failed) {
      if (rule === "*") {
        notes.push(RULES_FAILED_NOTE);
        warnings.add(RULES_FAILED_NOTE);
      } else if (allowSet.has(rule)) {
        const note = `Rule ${safeIdent(rule, 64)} could not be evaluated on this input and was skipped.`;
        notes.push(note);
        warnings.add(note);
        console.warn(JSON.stringify({ evt: "triage_rule_error", rule: safeIdent(rule, 64) }));
      }
    }
  }

  // 4. Shape findings.
  const locator: ServerLocator = {
    os_id: normalizeDistro(opts.distro),
    os_id_like: null,
    os_version_id: null,
    dmi_vendor: null,
  };
  const selRows = ((merged.ipmi as { sel_events_recent?: unknown } | undefined)?.sel_events_recent ?? []) as SelRow[];
  let selHistorical = false;
  const timed = alerts.map((a) => {
    if (a.type !== "ipmi_sel_critical") return a;
    const timing = selTiming(a, Array.isArray(selRows) ? selRows : []);
    selHistorical ||= timing.historical;
    const components = componentList(a.evidence?.critical_events);
    return {
      ...a,
      evidence: { ...(a.evidence ?? {}), ...timing.evidence, ...(components ? { affected_components: components } : {}) },
    };
  });
  const zonelessSel = active.some(({ result }) => result.domain === "ipmi_sel" && result.zoneless_times === true);
  const rebuilding = new Map<string, string | undefined>();
  for (const { result } of active) for (const r of result.rebuilding_arrays ?? []) rebuilding.set(r.device, r.member);
  const deduped = dedupeFindings(timed.map((a) => shapeFinding(a, ruleDomain.get(a.type), locator, zonelessSel, rebuilding)));
  const fixOf = new Map(deduped.map((s) => [s.finding, s.fix]));
  const ordered = deduped
    .map((s, i) => ({ f: s.finding, i }))
    .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
  const kept = capFindings(ordered, MAX_FINDINGS);
  // Fix workflows only for the findings the answer keeps (R4-15).
  const findings = kept.map((f) => ({ ...f, fix: fixOf.get(f)?.() ?? null }));
  if (ordered.length > kept.length) {
    const note = `${ordered.length - kept.length} more findings were left out of this answer (${droppedRules(ordered, kept)}); paste a smaller section to see them.`;
    notes.push(note);
    warnings.add(note);
  }

  // 5. What ran and found nothing, and what one paste cannot say.
  const fired = new Set(alerts.map((a) => a.type));
  const skipped = new Set(failed);
  const checked_no_signal = skipped.has("*")
    ? []
    : allow
        .filter((rule) => !fired.has(rule) && !skipped.has(rule))
        .map((rule) => ({ rule_id: rule, title: TRIAGE_TITLE[rule] ?? getRuleMetadata(rule)?.title ?? rule }));

  const not_determinable: TriageAnalysis["not_determinable"] = [];
  for (const { parser } of active) {
    for (const item of parser.notDeterminable) {
      if (!not_determinable.some((n) => n.signal === item.signal)) {
        not_determinable.push({ signal: item.signal, reason: item.reason });
      }
    }
  }
  if (selHistorical) {
    not_determinable.push({
      signal: "Whether the SEL fault is still present",
      reason: `Every critical SEL event counted here is dated more than ${SEL_HISTORICAL_DAYS} days before the newest entry in the paste, or was later deasserted. The log records past events; the current state needs the sensor readings (ipmitool sdr elist or ipmitool sensor).`,
    });
  }
  if (hasUnknownTimes(merged)) {
    not_determinable.push({
      signal: "event_timing",
      reason: "Some events in this paste carry relative (time since boot) or no timestamps, so how long ago they happened cannot be determined from the paste alone.",
    });
  }

  const result: TriageAnalysis = {
    input: {
      formats,
      bytes: Buffer.byteLength(text, "utf8"),
      lines: countLines(text),
      subjects,
    },
    findings,
    checked_no_signal,
    not_determinable,
    // A parser forced by the format hint that found nothing was never
    // recognised, so it must not prompt "recognised but unreadable".
    next_capture: nextCapture(
      parsed.filter(({ detected, result }) => detected || result.subjects > 0).map(({ result }) => result),
      active.map(({ result }) => result),
      ordered,
    ),
    notes,
  };
  if (subjects > 0) result.continuous_monitoring = { ...CONTINUOUS_MONITORING };
  WARNING_NOTES.set(result, new Set(notes.filter((n) => warnings.has(n))));
  return result;
}

const RULES_FAILED_NOTE = "The rules could not be evaluated on this input; nothing was checked.";

/**
 * Which notes of an answer are warnings. Notes stay plain strings in the
 * output contract; the text block reads their level from here, for the object
 * analyzeOutput returned, and treats an unknown object as having none.
 */
const WARNING_NOTES = new WeakMap<TriageAnalysis, ReadonlySet<string>>();

// ---------------------------------------------------------------------------
// Next capture
// ---------------------------------------------------------------------------

const NOTHING_RECOGNISED_GOALS: CaptureGoal[] = ["all_disks", "raid_md", "zfs", "kernel_errors", "bmc_events", "gpu"];

// Where to look next when an output reports that it has nothing to read.
// Running the same command again only prints the same thing (R2-9, R2-16).
const NOTHING_TO_REPORT_NEXT: Partial<Record<TriageDomain, { goal: CaptureGoal; why: string }>> = {
  nvidia_gpu: {
    goal: "kernel_errors",
    why: "The kernel log shows whether the GPU reported an Xid such as 79 (fallen off the bus) or the NVIDIA driver failed to load.",
  },
};

function nextCapture(
  detected: ParserResult[],
  active: ParserResult[],
  findings: Finding[],
): TriageAnalysis["next_capture"] {
  const out: TriageAnalysis["next_capture"] = [];
  const add = (goal: CaptureGoal, why: string) => {
    if (out.some((o) => o.goal === goal)) return;
    out.push({ goal, command: captureCommandText(goal), why });
  };
  /** A detected output that ran no rule: capture it again, unless it said there was nothing to read. */
  const recapture = (r: ParserResult, why: string) => {
    if (!r.nothing_to_report) return add(r.recapture_goal ?? DOMAIN_GOAL[r.domain], r.recapture_why ? cleanNote(r.recapture_why) : why);
    const next = NOTHING_TO_REPORT_NEXT[r.domain];
    if (next) add(next.goal, next.why);
  };

  if (active.length === 0) {
    for (const r of detected) {
      recapture(r, "This output was recognised but could not be read in full; capture it again with this command and paste the complete output.");
    }
    if (out.length === 0) {
      // Nothing recognised, or only output that had nothing to evaluate: the
      // other captures, never the one just pasted.
      const pasted = new Set(detected.map((r) => DOMAIN_GOAL[r.domain]));
      for (const goal of NOTHING_RECOGNISED_GOALS) if (!pasted.has(goal)) add(goal, captureWhy(goal));
    }
    return out;
  }

  const domains = new Set(active.map((r) => r.domain));
  const formats = new Set(active.flatMap((r) => r.formats));
  // An array rebuilding with no failed member has no failing disk behind it (R5-3).
  const fired = new Set(findings.filter((f) => f.observed.rebuilding !== true).map((f) => f.rule_id));

  for (const r of detected) {
    if (!domains.has(r.domain)) {
      recapture(r, "Part of this paste was recognised but could not be read in full; capture it again with this command.");
    }
  }
  // A GPU paste without the ECC or temperature fields (a short --query-gpu
  // CSV) ran none of those checks (R2-17). A complete -q from a GPU that
  // reports ECC off or N/A has nothing more to give (R6-10).
  const gpuResult = active.find((r) => r.domain === "nvidia_gpu");
  const gpuRules = gpuResult?.rules_checked;
  if (gpuResult?.gpu_fields_absent) {
    add("gpu", "nvidia-smi -q carries the ECC, temperature, throttle-reason and PCIe fields this output lacks, so those checks can run.");
  }
  // A one-GPU host has no NVLink to check (R6-10).
  const singleGpuHost = gpuResult?.host_gpus === 1;
  if (domains.has("mdraid") && !formats.has("mdadm_detail")) add("raid_md", captureWhy("raid_md"));
  if (domains.has("ipmi_sel") && !formats.has("ipmitool_sel_info")) {
    add("bmc_events", "ipmitool sel info shows whether the BMC event log is full and has stopped recording.");
  }
  if (domains.has("nvidia_gpu") && !formats.has("nvidia_smi_nvlink_status") && !singleGpuHost) add("nvlink", captureWhy("nvlink"));
  // NVLink output for one GPU: the check needs every GPU's (R2b-5).
  if (gpuRules && formats.has("nvidia_smi_nvlink_status") && !gpuRules.includes("nvlink_link_down") && !singleGpuHost) {
    add("nvlink", "The NVLink check runs only on output covering two or more GPUs, so it needs nvidia-smi nvlink --status for every GPU on the host.");
  }

  const driveFinding = ["raid_degraded", "zfs_pool_unhealthy", "zfs_scrub_errors", "disk_io_errors", "filesystem_readonly"]
    .some((r) => fired.has(r));
  if (driveFinding && !domains.has("smart")) {
    add("all_disks", "SMART data shows whether the disk behind this finding is failing.");
  }
  if ((domains.has("smart") || driveFinding) && !domains.has("kernel_log")) {
    add("kernel_errors", captureWhy("kernel_errors"));
  }
  if (domains.has("nvidia_gpu") && !domains.has("kernel_log")) {
    add("kernel_errors", "GPU Xid events are written to the kernel log, not to nvidia-smi.");
  }
  if (fired.has("gpu_xid_critical") && !domains.has("nvidia_gpu")) add("gpu", captureWhy("gpu"));
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Content text
// ---------------------------------------------------------------------------

// The text block has to stand on its own: clients on MCP 2025-03-26 or older,
// and any client that forwards only `content`, never see structuredContent.
// It used to say "run one of the commands in next_capture" without the
// commands, and named no failed member or quick check (R1-24).
const TEXT_QUICK_CHECKS = 8;
const TEXT_OBSERVED_KEYS = 12;
// Parser notes are constant text. The answer prints warning-level ones (a
// failed self-test with no finding, an unnamed failed member, a GPU nvidia-smi
// could not open), and every note when no rule ran, since then the notes are
// the explanation (R2-3, R2-9, R2-16).
const TEXT_WARNINGS = 4;
const TEXT_NOTES = 6;
// A backstop. Every summary a finding can carry fits (a test holds it): at
// 300, the caveats added on purpose were cut mid-word (R2b-14).
export const TEXT_SUMMARY_CHARS = 480;

function captureLines(analysis: TriageAnalysis): string[] {
  const lines: string[] = [];
  for (const c of analysis.next_capture) {
    lines.push(`- ${c.goal}: ${c.why}`);
    for (const cmd of c.command.split("\n")) lines.push(`    ${cmd}`);
  }
  return lines;
}

function capped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

/** The model-visible text block that accompanies structuredContent. */
export function renderAnalysisText(analysis: TriageAnalysis): string {
  const lines: string[] = [];
  const noteLines = (notes: readonly string[], max: number) => notes.slice(0, max).map((n) => `- ${n}`);
  // Keyed on subjects, not formats: a recognised format with nothing readable
  // in it (`zpool status -x`, a cut-off paste) ran no rule either, and must not
  // claim it was checked. The readers' notes say why (no pools, nvidia-smi
  // could not reach the GPU, a block cut off); a guess here contradicted them
  // (R2-9, R2-16).
  if (analysis.input.subjects === 0) {
    const recognised = analysis.input.formats.length > 0 ? `Recognised ${analysis.input.formats.join(", ")}, but it held nothing the rules can read, so no rule was checked` : null;
    if (analysis.notes.length === 0) {
      lines.push(recognised ? `${recognised}.` : "No supported command output was recognised in this paste, so no rule was checked.");
    } else {
      lines.push(recognised ? `${recognised}:` : "Nothing in this paste could be checked with Glassmkr's rules:");
      lines.push(...noteLines(analysis.notes, TEXT_NOTES));
    }
    if (analysis.next_capture.length > 0) {
      lines.push("Run one of these on the server and paste the output:");
      lines.push(...captureLines(analysis));
    }
    return lines.join("\n");
  }
  const read = analysis.input.formats.length > 0 ? analysis.input.formats.join(", ") : "the pasted output";
  const warnings = analysis.notes.filter((n) => WARNING_NOTES.get(analysis)?.has(n));
  // A recognised paste with none of the fields any rule reads (a memory-only
  // GPU CSV) ran nothing, and must not say it was checked (R2-17).
  if (analysis.findings.length === 0 && analysis.checked_no_signal.length === 0) {
    const why = analysis.notes.includes(RULES_FAILED_NOTE)
      ? "the rules could not be evaluated on it"
      : "it has none of the fields Glassmkr's rules read";
    lines.push(`Read ${read} (${analysis.input.subjects} subject(s)), but ${why}, so no rule was checked.`);
    lines.push(...noteLines(analysis.notes, TEXT_NOTES));
    if (analysis.next_capture.length > 0) {
      lines.push("To check more, run on the server and paste the output:");
      lines.push(...captureLines(analysis));
    }
    return lines.join("\n");
  }
  lines.push(`Read ${read} (${analysis.input.subjects} subject(s)) and checked it with Glassmkr's alert rules.`);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of analysis.findings) counts[f.severity] += 1;
  if (analysis.findings.length === 0) {
    lines.push("No rule matched: no matching signal in this output. That is not a health verdict; it covers only what this paste shows.");
  } else {
    lines.push(`${analysis.findings.length} finding(s): ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info.`);
    const shown = new Set<string>();
    const summaries = new Set<string>();
    for (const f of analysis.findings) {
      const who = [f.subject.kind, f.subject.id, f.subject.serial ? `S/N ${f.subject.serial}` : ""].filter(Boolean).join(" ");
      lines.push(`- [${f.severity}] ${f.title} (${who})`);
      // The summary carries the corrections a title cannot (a recoverable
      // sense key, a slot width nvidia-smi cannot see); content-only clients
      // never saw it (R2-11). Once per distinct summary.
      if (f.summary && !summaries.has(f.summary)) {
        summaries.add(f.summary);
        lines.push(`  ${capped(f.summary, TEXT_SUMMARY_CHARS)}`);
      }
      const facts = Object.entries(f.observed)
        .filter(([, v]) => v !== null && v !== "")
        .slice(0, TEXT_OBSERVED_KEYS)
        .map(([k, v]) => `${k}=${v}`);
      if (facts.length > 0) lines.push(`  observed: ${facts.join(", ")}`);
      const qc = f.fix?.quick_check?.command.trimEnd();
      if (qc && !shown.has(qc) && shown.size < TEXT_QUICK_CHECKS) {
        shown.add(qc);
        lines.push("  quick check:");
        for (const l of qc.split("\n")) lines.push(`    ${l}`);
      }
    }
  }
  if (analysis.checked_no_signal.length > 0) {
    lines.push(`${analysis.checked_no_signal.length} other rule(s) ran and found no matching signal in this output.`);
  }
  if (warnings.length > 0) {
    lines.push("Also in this output:");
    lines.push(...noteLines(warnings, TEXT_WARNINGS));
  }
  if (analysis.not_determinable.some((n) => n.signal === "event_timing")) {
    lines.push("Times unknown: some events have relative or missing timestamps, so their age cannot be judged from this paste.");
  }
  const sel = analysis.not_determinable.find((n) => n.signal === "Whether the SEL fault is still present");
  if (sel) lines.push(sel.reason);
  if (analysis.next_capture.length > 0) {
    lines.push("To check more, run on the server and paste the output:");
    lines.push(...captureLines(analysis));
  }
  return lines.join("\n");
}
