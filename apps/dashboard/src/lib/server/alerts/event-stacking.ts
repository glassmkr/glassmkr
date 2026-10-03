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
  id?: unknown;
  timestamp?: unknown;
  sensor?: unknown;
  event?: unknown;
}

// SEL record identity. The BMC's record id resets on `ipmitool sel clear`,
// so key on timestamp+sensor+event (the same triple the evaluator's
// transient-pairing uses) rather than the record id.
//
// Except for an undated record (2026-10-03): Crucible #151 sends "" for a
// Pre-Init row instead of the collection time. "" cannot tell two records
// apart, so a second Pre-Init "Fan Lower Critical" logged by a later BMC init
// would match the first one's key and leave an acknowledged alert silent. An
// undated record keys on its record id instead: stable for as long as the
// record exists (`sel clear` deletes it, so a reused id is a new record). The
// agent parses ipmitool's hex id base-10, so ids 0x1a..0x1f all arrive as 1
// and can still fold together; that needs an agent fix, not a key change.
function selKeys(evidence: Evidence): string[] | null {
  const events = (evidence as { critical_events?: unknown }).critical_events;
  if (!Array.isArray(events)) return null;
  return (events as SelEventLike[]).map((e) => `${e.timestamp === "" ? `undated#${e.id}` : e.timestamp}|${e.sensor}|${e.event}`);
}

// XID emission identity. gpu_xid_critical has the same windowed-re-emission
// shape as the SEL rule: the agent re-reports every XID event from its 24h
// dmesg window on every snapshot (parseXidEvents dedups within ONE read,
// not across snapshots), and the evaluator emits one alert per
// (pci_bdf, xid_code) group whenever criticals exist. The emission's
// evidence carries no per-event list, so key on the group plus
// last_event_iso: identical for a re-reported window, advances when a new
// occurrence of that XID lands (which should stack + re-notify).
//
// When the dmesg lines carry no absolute time (only "[seconds since boot]"),
// agents before Crucible #151 stamp the events with the collection time, so
// for them the key changes every snapshot and stacking degrades to the legacy
// behavior; no worse than before. Newer agents send "" and also fold every
// undated line of one (pci_bdf, xid_code) into a single event, the oldest
// still in the ring buffer. "bdf|code|" alone would be stable, but it would
// also match the same XID recurring after a reboot (the event alert stays open
// for 24h after its last emission), so a GPU falling off the bus again would
// refresh it silently. An undated group keys on that event's raw kernel line
// instead: its relative stamp is fixed while the line stays in the ring
// buffer and differs for a post-reboot recurrence.
function xidKeys(evidence: Evidence): string[] | null {
  const e = evidence as { pci_bdf?: unknown; xid_code?: unknown; last_event_iso?: unknown; raw_message?: unknown };
  if (e.pci_bdf === undefined || e.xid_code === undefined) return null;
  const when = e.last_event_iso === "" ? `undated:${e.raw_message}` : (e.last_event_iso ?? "unknown");
  return [`${e.pci_bdf}|${e.xid_code}|${when}`];
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
