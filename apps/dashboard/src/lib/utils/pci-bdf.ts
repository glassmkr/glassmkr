// PCI address matching between the two places a GPU's BDF reaches the
// dashboard. nvidia-smi `pci.bus_id` (tier1.gpus[].pci_bdf) is
// "00000000:3B:00.0": 8-hex-digit domain, uppercase, with a function. The
// NVRM Xid line, which Crucible copies into xid_events[].pci_bdf as-is, is
// "0000:3b:00": 4-hex-digit domain, lowercase, no function. String equality
// between the two never held, so until 2026-10 every gpu_xid_critical alert
// named the GPU "unknown" and the XID event log never resolved a GPU.

export interface PciBdf {
  domain: number;
  bus: number;
  device: number;
  /** null when the source omits the function (the NVRM Xid form). */
  fn: number | null;
}

const BDF_RE = /^([0-9a-f]{1,8}):([0-9a-f]{1,2}):([0-9a-f]{1,2})(?:\.([0-7]))?$/i;

/** Parse a domain-qualified PCI address in either form, any hex case.
 *  Returns null for anything else. */
export function parsePciBdf(raw: string): PciBdf | null {
  const m = BDF_RE.exec(raw.trim());
  if (!m) return null;
  return {
    domain: parseInt(m[1], 16),
    bus: parseInt(m[2], 16),
    device: parseInt(m[3], 16),
    fn: m[4] === undefined ? null : parseInt(m[4], 10),
  };
}

/** Same PCI device? Domain, bus and device must agree numerically; the
 *  function is compared only when both sides carry one, since the Xid form
 *  never does. An unparseable side never matches. */
export function pciBdfMatches(a: string, b: string): boolean {
  const x = parsePciBdf(a);
  const y = parsePciBdf(b);
  return x !== null && y !== null && pciBdfEqual(x, y);
}

/** pciBdfMatches on addresses already parsed, for joining many against many. */
export function pciBdfEqual(x: PciBdf, y: PciBdf): boolean {
  if (x.domain !== y.domain || x.bus !== y.bus || x.device !== y.device) return false;
  return x.fn === null || y.fn === null || x.fn === y.fn;
}
