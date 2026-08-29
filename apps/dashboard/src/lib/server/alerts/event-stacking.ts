// Event-rule occurrence identity (2026-06-11 SEL notification-spam fix).
//
// Event-type alerts stack occurrences into one card (EVENT_RULES in
// $lib/alerts/presentation). The ingest stacking path originally treated
// EVERY emission as a fresh occurrence: append to evidence.occurrences,
// bump the "(N times)" title, un-acknowledge, and reset notification_sent
// so the dispatcher re-sends the alert.
//
// That is only correct when each emission really is a new event
// (unexpected_reboot emits once per detected boot). It is wrong for
// windowed event rules: ipmi_sel_critical re-emits on every snapshot for
// as long as a critical SEL entry sits inside its 30-day window, because
// the agent re-reports the same SEL entries each collection. One injected
// test event on glassmkr-val-centos produced 90 occurrences and 90
// Telegram sends in an afternoon (one per 60s snapshot) before this fix.
//
// freshEventKeys() lets ingest ask: which of this emission's events has no
// prior occurrence recorded? Rules without an extractor return null ("no
// identity available") and keep the legacy stack-every-emission behavior.

type Evidence = Record<string, unknown>;

interface SelEventLike {
  timestamp?: unknown;
  sensor?: unknown;
  event?: unknown;
}

// SEL record identity. The BMC's record id resets on `ipmitool sel clear`,
// so key on timestamp+sensor+event (the same triple the evaluator's
// transient-pairing uses) rather than the record id.
function selKeys(evidence: Evidence): string[] | null {
  const events = (evidence as { critical_events?: unknown }).critical_events;
  if (!Array.isArray(events)) return null;
  return (events as SelEventLike[]).map((e) => `${e.timestamp}|${e.sensor}|${e.event}`);
}

// XID emission identity. gpu_xid_critical has the same windowed-re-emission
// shape as the SEL rule: the agent re-reports every XID event from its 24h
// dmesg window on every snapshot (parseXidEvents dedups within ONE read,
// not across snapshots), and the evaluator emits one alert per
// (pci_bdf, xid_code) group whenever criticals exist. The emission's
// evidence carries no per-event list, so key on the group plus
// last_event_iso: identical for a re-reported window, advances when a new
// occurrence of that XID lands (which should stack + re-notify). On old
// kernels whose dmesg lines carry no parseable timestamp the agent stamps
// events with the collection time, so the key changes every snapshot and
// stacking degrades to the legacy behavior; no worse than before.
function xidKeys(evidence: Evidence): string[] | null {
  const e = evidence as { pci_bdf?: unknown; xid_code?: unknown; last_event_iso?: unknown };
  if (e.pci_bdf === undefined || e.xid_code === undefined) return null;
  return [`${e.pci_bdf}|${e.xid_code}|${e.last_event_iso ?? "unknown"}`];
}

const EXTRACTORS: Record<string, (evidence: Evidence) => string[] | null> = {
  ipmi_sel_critical: selKeys,
  gpu_xid_critical: xidKeys,
  // unexpected_reboot intentionally absent: it is edge-triggered (one
  // emission per detected boot), so legacy stack-per-emission is correct.
};

/**
 * Returns the emission's event keys that no prior occurrence has recorded.
 * Returns null when the rule has no identity extractor or the evidence has
 * no recognizable event list; the caller keeps legacy always-stack behavior.
 * An empty array means "everything in this emission is already recorded":
 * refresh quietly, do not stack or re-notify.
 */
export function freshEventKeys(
  alertType: string,
  emissionEvidence: Evidence,
  priorOccurrences: Evidence[],
): string[] | null {
  const extract = EXTRACTORS[alertType];
  if (!extract) return null;
  const emitted = extract(emissionEvidence);
  if (emitted === null) return null;
  const seen = new Set<string>();
  for (const occ of priorOccurrences) {
    for (const k of extract(occ) ?? []) seen.add(k);
  }
  return emitted.filter((k) => !seen.has(k));
}
