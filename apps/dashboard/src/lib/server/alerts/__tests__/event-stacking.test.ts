import { describe, expect, it } from "vitest";
import { freshEventKeys } from "../event-stacking";
import { EVENT_RULES } from "../../../alerts/presentation";

const selEvent = (ts: string, sensor = "Temperature #0x30", event = "Upper Critical going high") => ({
  timestamp: ts,
  sensor,
  event,
  direction: "Asserted",
  severity: "critical",
});

const selEvidence = (...events: Array<Record<string, unknown>>) => ({
  critical_events: events,
  window_days: 30,
});

describe("freshEventKeys", () => {
  it("returns all keys on the first emission (no prior occurrences)", () => {
    const fresh = freshEventKeys("ipmi_sel_critical", selEvidence(selEvent("2026-06-11T11:58:17Z")), []);
    expect(fresh).toEqual(["2026-06-11T11:58:17Z|Temperature #0x30|Upper Critical going high"]);
  });

  it("returns [] when the same event is re-emitted (the spam case)", () => {
    const evt = selEvent("2026-06-11T11:58:17Z");
    // Occurrences embed the emission evidence, so prior occurrences carry
    // critical_events themselves. 90 of these accumulated pre-fix.
    const prior = [
      { timestamp: "2026-06-11T11:58:44Z", ...selEvidence(evt) },
      { timestamp: "2026-06-11T11:59:44Z", ...selEvidence(evt) },
    ];
    expect(freshEventKeys("ipmi_sel_critical", selEvidence(evt), prior)).toEqual([]);
  });

  it("returns only the new event when a genuinely fresh SEL entry arrives", () => {
    const old = selEvent("2026-06-11T11:58:17Z");
    const fresh = selEvent("2026-06-11T15:00:00Z", "PS1 Status", "Failure detected");
    const prior = [{ timestamp: "2026-06-11T11:58:44Z", ...selEvidence(old) }];
    expect(freshEventKeys("ipmi_sel_critical", selEvidence(old, fresh), prior)).toEqual([
      "2026-06-11T15:00:00Z|PS1 Status|Failure detected",
    ]);
  });

  it("does not key on the SEL record id (survives ipmitool sel clear renumbering)", () => {
    const a = { ...selEvent("2026-06-11T11:58:17Z"), id: 55 };
    const b = { ...selEvent("2026-06-11T11:58:17Z"), id: 1 }; // same event, renumbered
    const prior = [{ timestamp: "2026-06-11T11:58:44Z", ...selEvidence(a) }];
    expect(freshEventKeys("ipmi_sel_critical", selEvidence(b), prior)).toEqual([]);
  });

  it("returns null for rules without an identity extractor (legacy stacking)", () => {
    expect(freshEventKeys("unexpected_reboot", { boot_id: "x" }, [])).toBeNull();
  });

  it("returns null when the evidence has no recognizable event list", () => {
    expect(freshEventKeys("ipmi_sel_critical", { window_days: 30 }, [])).toBeNull();
  });

  it("gpu_xid: [] when the same 24h-window XID group is re-reported each snapshot", () => {
    const xid = {
      pci_bdf: "0000:81:00.0",
      xid_code: 79,
      first_event_iso: "2026-06-11T10:00:00Z",
      last_event_iso: "2026-06-11T10:00:00Z",
      events_in_window: 1,
    };
    const prior = [{ timestamp: "2026-06-11T10:01:00Z", ...xid }];
    expect(freshEventKeys("gpu_xid_critical", xid, prior)).toEqual([]);
  });

  it("gpu_xid: a new occurrence of the same XID (last_event_iso advanced) stacks", () => {
    const old = { pci_bdf: "0000:81:00.0", xid_code: 79, last_event_iso: "2026-06-11T10:00:00Z" };
    const advanced = { pci_bdf: "0000:81:00.0", xid_code: 79, last_event_iso: "2026-06-11T12:30:00Z" };
    const prior = [{ timestamp: "2026-06-11T10:01:00Z", ...old }];
    expect(freshEventKeys("gpu_xid_critical", advanced, prior)).toEqual([
      "0000:81:00.0|79|2026-06-11T12:30:00Z",
    ]);
  });

  it("gpu_xid: a different (GPU, code) group stacks even while another group is recorded", () => {
    const g1 = { pci_bdf: "0000:81:00.0", xid_code: 79, last_event_iso: "2026-06-11T10:00:00Z" };
    const g2 = { pci_bdf: "0000:c1:00.0", xid_code: 48, last_event_iso: "2026-06-11T11:00:00Z" };
    const prior = [{ timestamp: "2026-06-11T10:01:00Z", ...g1 }];
    expect(freshEventKeys("gpu_xid_critical", g2, prior)).toEqual([
      "0000:c1:00.0|48|2026-06-11T11:00:00Z",
    ]);
  });

  it("gpu_xid: null (legacy stacking) when the emission lacks group identity fields", () => {
    expect(freshEventKeys("gpu_xid_critical", { events: [] }, [])).toBeNull();
  });

  it("tolerates prior occurrences with malformed or missing critical_events", () => {
    const evt = selEvent("2026-06-11T11:58:17Z");
    const prior = [
      { timestamp: "old", note: "no events field" },
      { timestamp: "old2", critical_events: "not-an-array" },
    ];
    expect(freshEventKeys("ipmi_sel_critical", selEvidence(evt), prior as never)).toEqual([
      "2026-06-11T11:58:17Z|Temperature #0x30|Upper Critical going high",
    ]);
  });
});

// Re-emission invariant over EVERY event rule (2026-06-11 SEL/XID spam class).
//
// The failure mode this guards: a windowed event rule re-emits identical
// events on every snapshot; if the stacking path treats each emission as a
// new occurrence, every snapshot resets notification_sent and the customer
// gets one notification per collection interval for the whole window (90
// Telegram sends in an afternoon from one injected SEL event; gpu_xid would
// have been ~1440/day per XID).
//
// The contract this test enforces: every rule in EVENT_RULES must EITHER
//   (a) have an identity extractor + a representative fixture here, proving
//       that an identical re-emission yields zero fresh keys, OR
//   (b) be listed in EDGE_TRIGGERED, asserting its evaluator emits at most
//       once per real-world event (so legacy stack-per-emission is correct).
// Adding a new rule to EVENT_RULES without doing one of the two fails this
// suite with instructions, instead of shipping the next notification storm.
describe("EVENT_RULES re-emission invariant", () => {
  // Rules whose evaluator is edge-triggered: it emits once per real event
  // and does NOT re-emit on a later snapshot with unchanged state. Justify
  // every entry.
  const EDGE_TRIGGERED: Record<string, string> = {
    unexpected_reboot:
      "emitted via reboot-evidence cross-snapshot comparison, once per detected boot; an unchanged snapshot does not re-emit",
  };

  // Representative emission evidence per extractor-backed rule. Shape must
  // match what the evaluator emits (occurrences embed this same evidence).
  const FIXTURES: Record<string, Record<string, unknown>> = {
    ipmi_sel_critical: {
      critical_events: [
        { timestamp: "2026-06-11T11:58:17Z", sensor: "Temperature #0x30", event: "Upper Critical going high" },
      ],
      window_days: 30,
    },
    gpu_xid_critical: {
      pci_bdf: "0000:81:00.0",
      xid_code: 79,
      first_event_iso: "2026-06-11T10:00:00Z",
      last_event_iso: "2026-06-11T10:00:00Z",
      events_in_window: 1,
    },
  };

  for (const rule of EVENT_RULES) {
    it(`${rule}: identical re-emission must not stack or re-notify`, () => {
      if (rule in EDGE_TRIGGERED) {
        // Documented exemption; nothing to check at the dedup layer.
        return;
      }
      const evidence = FIXTURES[rule];
      expect(
        evidence,
        `${rule} is in EVENT_RULES but has no fixture here. Either add an identity extractor in event-stacking.ts plus a fixture, or document the rule in EDGE_TRIGGERED with a justification.`,
      ).toBeDefined();
      const prior = [{ timestamp: "2026-06-11T12:00:00Z", ...evidence }];
      expect(
        freshEventKeys(rule, evidence, prior),
        `${rule}: re-emitting identical evidence against a recorded occurrence must yield zero fresh keys`,
      ).toEqual([]);
    });
  }
});
