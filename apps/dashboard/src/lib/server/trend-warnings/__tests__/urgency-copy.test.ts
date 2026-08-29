import { describe, expect, it, vi } from "vitest";

// The urgency legend the dashboard shows users states specific boundaries: seven
// days, thirty days, and severity. This file exists so that copy cannot quietly
// stop being true. If someone changes a threshold in computeUrgencyTier without
// changing $lib/trend-urgency.ts, these fail.
//
// The known-bad direction matters as much as the good one: each tier is also
// checked one step past its own boundary, so a rule that silently widened would
// be caught rather than passing because everything maps to "imminent".

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@glassmkr/db/pg", () => ({ query: queryMock }));

import { computeUrgencyTier } from "../persistence";
import type { Finding } from "../types";
import { URGENCY_TIERS } from "$lib/trend-urgency";

function f(severity: Finding["severity"], projected_timeline: string | null): Finding {
  return {
    type: "smart_5_growing",
    severity,
    resource: { kind: "drive", name: "/dev/sda", serial: "X", model: "M", vendor: "V" },
    contributing_metrics: [],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline,
    evidence_summary: "",
  } as unknown as Finding;
}

const SEVERITIES: Array<Finding["severity"]> = ["high", "medium"];

describe("the urgency legend matches the rule it describes", () => {
  it("names exactly the tiers the rule can produce", () => {
    expect(URGENCY_TIERS.map((t) => t.tier)).toEqual(["imminent", "soon", "scheduled"]);
  });

  it("IMMINENT: high severity within seven days, or no useful lead time", () => {
    expect(computeUrgencyTier(f("high", "within 7 days"))).toBe("imminent");
    expect(computeUrgencyTier(f("high", "immediate"))).toBe("imminent");
    // One day past the stated boundary is no longer imminent.
    expect(computeUrgencyTier(f("high", "within 8 days"))).toBe("soon");
    // Medium never reaches imminent, however short the projection.
    expect(computeUrgencyTier(f("medium", "immediate"))).not.toBe("imminent");
  });

  it("SOON: high severity at any horizon, or thirty days or less", () => {
    expect(computeUrgencyTier(f("high", "within 200 days"))).toBe("soon");
    expect(computeUrgencyTier(f("high", null))).toBe("soon");
    expect(computeUrgencyTier(f("medium", "within 30 days"))).toBe("soon");
    expect(computeUrgencyTier(f("medium", "within 31 days"))).toBe("scheduled");
  });

  it("SCHEDULED: every remaining medium-severity finding", () => {
    expect(computeUrgencyTier(f("medium", null))).toBe("scheduled");
    expect(computeUrgencyTier(f("medium", "within 90 days"))).toBe("scheduled");
    expect(computeUrgencyTier(f("medium", "within 900 days"))).toBe("scheduled");
    expect(computeUrgencyTier(f("medium", "no clear trend"))).toBe("scheduled");
  });

  it("WATCH is unreachable, so it is not documented to users", () => {
    // UrgencyTier and migration 002's column comment both still list a fourth
    // tier. Severity is only ever high or medium, and the medium branch is a
    // catch-all, so nothing can produce it. If a future change makes "watch"
    // reachable, this fails and the legend needs a fourth entry.
    const timelines = [null, "immediate", "within 1 day", "within 45 days", "within 400 days", "no clear trend", ""];
    const produced = new Set<string>();
    for (const sev of SEVERITIES) for (const t of timelines) produced.add(computeUrgencyTier(f(sev, t)));
    expect([...produced].sort()).toEqual(["imminent", "scheduled", "soon"]);
    expect(produced.has("watch")).toBe(false);
    expect(URGENCY_TIERS.some((t) => (t.tier as string) === "watch")).toBe(false);
  });
});
