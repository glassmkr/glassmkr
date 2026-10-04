// Paste triage: run Glassmkr's own alert rules on command output a person
// pasted into an AI assistant (ChatGPT, Claude) instead of on a live agent
// snapshot. Each parser turns one kind of output into the Snapshot slice the
// evaluator already understands, so the verdict comes from the same rule code
// and fix workflows as the dashboard, not from a second copy of the logic.
//
// Contract every parser follows:
//   - detect() is a cheap, deterministic sniff and never throws.
//   - parse() never throws on malformed or truncated input; it returns
//     subjects: 0 plus a note instead.
//   - Never invent a value. A field the paste does not contain is omitted
//     (or null where the Snapshot type requires the key). In particular a
//     missing or relative timestamp is never replaced with "now".
//   - Identifiers copied from the paste (device names, models, serials,
//     pool / array / vdev names, sensor names, PCI addresses) go through
//     sanitize.ts before they land in the snapshot, so any text the
//     evaluator interpolates into a title or fix command is inert.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import type { CaptureGoal } from "./capture";

export type TriageDomain =
  | "smart"
  | "zfs"
  | "mdraid"
  | "kernel_log"
  | "ipmi_sel"
  | "nvidia_gpu";

/** Specific recognised format, reported back so the user can see what was read. */
export type TriageFormat =
  | "smartctl_json"
  | "smartctl_text"
  | "zpool_status"
  | "proc_mdstat"
  | "mdadm_detail"
  | "dmesg"
  | "journalctl_kernel"
  | "syslog_kernel"
  | "ipmitool_sel_elist"
  | "ipmitool_sel_list"
  | "ipmitool_sel_info"
  /** `ipmitool sdr type Fan`, `sdr list`, `sdr elist`: fan and PSU rows. */
  | "ipmitool_sdr"
  /** `ipmitool sensor`: fan and PSU rows with thresholds. */
  | "ipmitool_sensor"
  | "nvidia_smi_query"
  | "nvidia_smi_nvlink_status";

export interface ParseNote {
  level: "info" | "warning";
  /** Plain sentence built from constants and counts only, never from paste text. */
  message: string;
}

export interface ParserResult {
  domain: TriageDomain;
  formats: TriageFormat[];
  /** ONLY the snapshot keys this domain owns (see DOMAIN_SNAPSHOT_KEYS). */
  snapshot: Partial<Snapshot>;
  /** Devices / arrays / pools / GPUs / log events recognised. 0 = nothing usable. */
  subjects: number;
  notes: ParseNote[];
  /**
   * The subset of the parser's `rules` whose input this paste actually
   * contained. Omitted means all of them. A rule left out is muted, so it is
   * never reported as "ran and found no matching signal" when the paste held
   * nothing it reads: a SEL-only paste says nothing about fans, and an
   * `nvidia-smi -q` paste has no NVLink link state.
   */
  rules_checked?: readonly string[];
  /**
   * Set with subjects: 0 when the output was read in full and itself says
   * there is nothing to evaluate: no pools, no md arrays, nvidia-smi unable to
   * reach the driver or a GPU. That is not a cut-off or unreadable paste, so
   * the answer must not ask for the same command again (R2-9, R2-16).
   */
  nothing_to_report?: true;
  /**
   * Why to run the domain's capture again, when the output was read in full
   * but the command's options left out what the rules read (`zpool status -x`
   * prints one summary line). Constant text, like a note. analyze.ts uses it
   * in place of "could not be read in full", which told the user a complete
   * paste was cut off (R2b-17).
   */
  recapture_why?: string;
  /**
   * The capture to ask for in place of the domain's default, when the output
   * is a sibling command whose fields no rule reads: `nvidia-smi nvlink -e`
   * prints counters, and the link state needs `nvlink --status`, not
   * `nvidia-smi -q` (R4-1).
   */
  recapture_goal?: CaptureGoal;
  /**
   * Set when the output printed every event time it dates without a time
   * zone. The snapshot still holds them as UTC, the collector's reading, for
   * the age comparisons; the answer shows them without the "Z", which would
   * claim a zone the output does not state (R4-11).
   */
  zoneless_times?: true;
  /**
   * md arrays that are degraded with no failed member, no unnamed empty slot,
   * and a member attached but not yet in sync: a fresh build, or recovery onto
   * a replacement already added. The answer must not say a disk has failed or
   * ask for a replacement (R5-3). `member` is the rebuild target when mdadm
   * --detail names exactly one; /proc/mdstat cannot.
   */
  rebuilding_arrays?: ReadonlyArray<{ device: string; member?: string }>;
}

export interface TriageParser {
  domain: TriageDomain;
  /**
   * Evaluator rule ids that can legitimately fire from this domain on ONE
   * paste. Rules that need history (deltas, trends, previous snapshots) are
   * excluded and listed in notDeterminable instead.
   */
  rules: readonly string[];
  /** Signals this domain cannot judge from a single paste, for the honest "what this cannot tell you" list. */
  notDeterminable: ReadonlyArray<{ signal: string; reason: string }>;
  detect(text: string): boolean;
  parse(text: string): ParserResult;
}

/**
 * Snapshot keys each domain may write. analyze.ts merges parser results and
 * concatenates arrays where two domains share a container (kernel_log writes
 * gpu.tier1.xid_events, nvidia_gpu writes gpu.tier1.gpus).
 */
export const DOMAIN_SNAPSHOT_KEYS: Record<TriageDomain, ReadonlyArray<keyof Snapshot>> = {
  smart: ["smart", "smart_unreadable"],
  zfs: ["zfs"],
  mdraid: ["raid"],
  kernel_log: ["dmesg_events", "gpu", "io_errors", "ecc_edac"],
  ipmi_sel: ["ipmi"],
  nvidia_gpu: ["gpu"],
};
