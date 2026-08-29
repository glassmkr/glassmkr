// Shared three-tier classifier for interface errors. Keep in sync with
// evaluateInterfaceErrors() in $lib/server/alerts/evaluator.ts — the server
// decides whether to fire an alert, and the dashboard uses the same math
// to colour the ERRORS column without a snapshot schema change.
//
// Thresholds (per collection interval):
//   yellow  = any non-zero hardware-error delta (dashboard-only, no alert)
//   orange  = ratio >= 0.01% on >=10,000 packets,
//             OR absolute >=10 errors sustained across 2 intervals
//   red     = ratio >= 0.1%  on >=1,000 packets,
//             OR absolute >=100 errors
//
// Minimum-traffic gate (ratio requires >= 1,000 packets) prevents idle
// ports from tripping on a single error.

export type InterfaceTier = "none" | "yellow" | "orange" | "red";

const MIN_PACKETS_FOR_RATIO = 1_000;
const ORANGE_RATIO = 0.0001;
const ORANGE_MIN_PACKETS = 10_000;
const ORANGE_ABS = 10;
const RED_RATIO = 0.001;
const RED_ABS = 100;
const DROP_RED = 0.10;
const DROP_ORANGE = 0.01;
const DROP_YELLOW = 0.001;

export interface IfaceLike {
  interface?: string;
  rx_errors?: number;
  tx_errors?: number;
  rx_crc_errors?: number;
  rx_frame_errors?: number;
  rx_length_errors?: number;
  tx_carrier_errors?: number;
  rx_drops?: number;
  tx_drops?: number;
  rx_packets?: number;
  tx_packets?: number;
  bond_master?: string;
  is_bond_master?: boolean;
}

export function hardwareErrorSum(iface: IfaceLike): number {
  return (iface.rx_errors || 0)
    + (iface.tx_errors || 0)
    + (iface.rx_crc_errors || 0)
    + (iface.rx_frame_errors || 0)
    + (iface.rx_length_errors || 0)
    + (iface.tx_carrier_errors || 0);
}

export function dropSum(iface: IfaceLike): number {
  return (iface.rx_drops || 0) + (iface.tx_drops || 0);
}

/** Client-side classifier. Returns "none" for bond masters (per-slave eval
 *  is authoritative); otherwise mirrors the server's threshold math. The
 *  `prevErrors` parameter is used only for the sustained-2-intervals gate
 *  at the orange absolute-count threshold; pass 0 if unknown.
 */
export function classifyInterfaceTier(
  iface: IfaceLike,
  prevErrors = 0,
  firewallActive = false,
): InterfaceTier {
  const name = iface.interface ?? "";
  const isBondMaster = iface.is_bond_master === true ||
    (name.startsWith("bond") && iface.bond_master == null);
  if (isBondMaster) return "none";

  const errors = hardwareErrorSum(iface);
  const drops = dropSum(iface);
  const packets = (iface.rx_packets || 0) + (iface.tx_packets || 0);
  const ratio = packets >= MIN_PACKETS_FOR_RATIO ? errors / packets : null;
  const dropRatio = packets >= MIN_PACKETS_FOR_RATIO ? drops / packets : null;

  if (
    (ratio !== null && ratio >= RED_RATIO && packets >= MIN_PACKETS_FOR_RATIO) ||
    errors >= RED_ABS
  ) return "red";

  if (
    (ratio !== null && ratio >= ORANGE_RATIO && packets >= ORANGE_MIN_PACKETS) ||
    (errors >= ORANGE_ABS && prevErrors >= ORANGE_ABS)
  ) return "orange";

  if (errors > 0) return "yellow";

  // Drop-only classification; firewall-on-bond suppression is enforced on
  // server side and doesn't reach here (bond masters already returned).
  if (drops > 0 && !firewallActive && dropRatio !== null) {
    if (dropRatio >= DROP_RED) return "red";
    if (dropRatio >= DROP_ORANGE) return "orange";
    if (dropRatio >= DROP_YELLOW) return "yellow";
  }

  return "none";
}
