// The urgency vocabulary, in product language.
//
// These four words appeared on every trend warning and were defined nowhere a
// user could read: an external audit noted that the page was "more confident
// than the visible evidence supports", and the first thing missing was what the
// words mean. The rules below are not a paraphrase written from memory; they
// restate the branches of computeUrgencyTier in
// lib/server/trend-warnings/persistence.ts, and __tests__/urgency-copy.test.ts
// drives that function at each boundary named here so the two cannot drift.
//
// This module is deliberately client-safe (no $lib/server import), because the
// legend renders in the browser.
//
// There is no WATCH entry below, and that is not an omission. The type
// UrgencyTier has always listed four tiers and migration 002 documents four in
// a column comment, but a finding's severity is only ever "high" or "medium",
// and computeUrgencyTier's third branch returns "scheduled" for every medium
// finding. Nothing can reach the fourth branch. Writing a user-facing
// definition for a state the system cannot produce is the same defect as
// advertising a retired price, so the legend documents the three tiers that
// actually occur and the test asserts the fourth stays unreachable.

export type UrgencyTier = "imminent" | "soon" | "scheduled" | "watch";

export interface UrgencyTierDoc {
  tier: UrgencyTier;
  label: string;
  meaning: string;
}

export const URGENCY_TIERS: UrgencyTierDoc[] = [
  {
    tier: "imminent",
    label: "IMMINENT",
    meaning:
      "High severity with a projection of seven days or less, or a signal that carries no useful lead time at all. Act now.",
  },
  {
    tier: "soon",
    label: "SOON",
    meaning:
      "High severity at any horizon, or a projection of thirty days or less. Schedule inside the month.",
  },
  {
    tier: "scheduled",
    label: "SCHEDULED",
    meaning:
      "Everything else the system raises: a medium-severity trend, or a projection beyond thirty days. Fold into planned maintenance.",
  },
];

// How a warning comes to exist at all. Stated on the page because "the model"
// is a fair question to ask of anything that predicts hardware failure, and the
// honest answer here is that there is no model: it is a rule over consecutive
// snapshots, and it says so.
export const URGENCY_BASIS = {
  cadence: "every 6 hours",
  persistence:
    "A warning is raised only after the same signal appears in two consecutive batches, except for a short list of signal types that are actionable on first sight (a drive reporting its first reallocated sector, an NVMe critical-warning bit).",
  method:
    "Warnings come from rules applied across stored snapshots, not from a trained model. A projected timeline is an extrapolation of the observed trend, so treat it as an ordering hint rather than a date.",
};
