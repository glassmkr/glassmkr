// Owned-vs-rented physical-remediation note (R-P2-2) and the predicate that
// decides whether an alert is "vendor facing": a physical hardware fault whose
// remediation a rented / provider-managed customer must escalate to their
// hosting provider rather than fix themselves.
//
// This is the SINGLE SOURCE OF TRUTH for the note. The evaluator (server) appends
// OWNERSHIP_REMEDIATION_NOTE to the recommendation of every vendor-side physical
// rule; the "Generate ticket draft" feature (UI + API) shows its button exactly
// where that note is present. Keeping the predicate keyed on the note (not a
// separate rule allowlist) means the button's visibility is a literal consequence
// of the ownership-branch work: add the note to a rule and the button follows;
// the cpu_temperature_high load-correlated branch, which deliberately omits the
// note, is excluded for free.
//
// This module lives under lib/alerts/ (NOT lib/server/) so it is client-safe:
// the alert detail page imports `alertIsVendorFacing` and the evaluator imports
// `OWNERSHIP_REMEDIATION_NOTE`, with no server-only code pulled into the bundle.

export const OWNERSHIP_REMEDIATION_NOTE =
  "If you operate this hardware (owned or colocated): handle the inspection or swap yourself, or dispatch a remote-hands technician. If this is rented or provider-managed: file a hardware service ticket with your provider. Either way, the physical check needs to happen on-site.";

/**
 * True when the alert is a physical hardware fault a provider-managed customer
 * would escalate to their hosting provider. Detected by the presence of the
 * ownership note in the alert's stored recommendation, so it stays in lockstep
 * with the evaluator without a duplicated rule list.
 */
export function alertIsVendorFacing(recommendation: string | null | undefined): boolean {
  return typeof recommendation === "string" && recommendation.includes(OWNERSHIP_REMEDIATION_NOTE);
}
