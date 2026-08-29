// NVIDIA XID error code -> short description lookup.
//
// Mirrors the table Crucible v0.13.0 hardcoded at
// src/collect/gpu.ts (XID_CRITICAL + XID_WARNING) and the
// xidShortDescription() helper in dashboard's evaluator.ts; this
// module exists so the dashboard UI (alert evidence, XID event log
// in the GPU panel) can look up the description without round-
// tripping to the alert message string.
//
// Source: NVIDIA XID Errors documentation. Refresh when major
// driver versions add codes — track at
// https://docs.nvidia.com/deploy/xid-errors/index.html

export type XidSeverity = "critical" | "warning" | "info";

interface XidEntry {
  severity: XidSeverity;
  short: string;
}

const XID_TABLE: Record<number, XidEntry> = {
  // Critical
  13: { severity: "critical", short: "Graphics Engine exception" },
  31: { severity: "critical", short: "GPU memory page fault" },
  43: { severity: "critical", short: "GPU stopped processing" },
  45: { severity: "critical", short: "Preemptive cleanup" },
  48: { severity: "critical", short: "Double Bit ECC error" },
  56: { severity: "critical", short: "Display Engine error" },
  57: { severity: "critical", short: "Video memory programming error" },
  58: { severity: "critical", short: "Unstable video memory" },
  62: { severity: "critical", short: "Internal microcontroller halt" },
  63: { severity: "critical", short: "ECC page retirement recording event" },
  64: { severity: "critical", short: "ECC page retirement recording failure" },
  65: { severity: "critical", short: "Video processor exception" },
  66: { severity: "critical", short: "Video processor exception" },
  68: { severity: "critical", short: "NVDEC error" },
  69: { severity: "critical", short: "Graphics Engine class error" },
  71: { severity: "critical", short: "CE (copy engine) error" },
  72: { severity: "critical", short: "CE (copy engine) error" },
  73: { severity: "critical", short: "NVENC error" },
  74: { severity: "critical", short: "NVLink error" },
  76: { severity: "critical", short: "Bad GPU health" },
  78: { severity: "critical", short: "NVENC error" },
  79: { severity: "critical", short: "GPU has fallen off the bus" },
  92: { severity: "critical", short: "High single-bit ECC error rate" },
  94: { severity: "critical", short: "Contained ECC error" },
  95: { severity: "critical", short: "Uncontained ECC error" },
  96: { severity: "critical", short: "NVDEC error" },
  100: { severity: "critical", short: "Remote NVLink error" },
  101: { severity: "critical", short: "Remote NVLink error" },
  110: { severity: "critical", short: "Security violation" },
  111: { severity: "critical", short: "Security violation" },
  119: { severity: "critical", short: "GSP RPC timeout" },
  120: { severity: "critical", short: "GSP RPC timeout" },
  // Warning
  8: { severity: "warning", short: "GPU stopped processing (recoverable)" },
  14: { severity: "warning", short: "Display error" },
  22: { severity: "warning", short: "Inforom error (possibly recoverable)" },
  25: { severity: "warning", short: "Inforom error (possibly recoverable)" },
  32: { severity: "warning", short: "Invalid push buffer stream" },
  38: { severity: "warning", short: "Driver firmware error" },
  39: { severity: "warning", short: "Graphics Engine exception" },
  42: { severity: "warning", short: "Recoverable engine error" },
  44: { severity: "warning", short: "Recoverable engine error" },
  46: { severity: "warning", short: "Recoverable engine error" },
  60: { severity: "warning", short: "Application reset" },
  67: { severity: "warning", short: "NVLink error (recoverable)" },
};

/** Returns the canonical NVIDIA short description for a known XID,
 *  or a generic fallback for unknowns. Mirrors the evaluator's
 *  xidShortDescription() so panel + alert messages match. */
export function xidShortDescription(code: number): string {
  return XID_TABLE[code]?.short ?? "hardware fault (consult NVIDIA XID reference)";
}

/** Severity classification per the same NVIDIA table. Unknown
 *  codes default to "info" (Crucible v0.13.0 parser convention). */
export function xidSeverity(code: number): XidSeverity {
  return XID_TABLE[code]?.severity ?? "info";
}

/** "XID 79: GPU has fallen off the bus" — convenience formatter for
 *  the panel's event log + the alert evidence renderer. */
export function formatXid(code: number): string {
  return `XID ${code}: ${xidShortDescription(code)}`;
}
