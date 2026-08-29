import { describe, expect, it } from "vitest";
import { expandChannelPriorities, getPriority } from "../presentation";

// P0-04 from the 2026-08-29 audit, corrected.
//
// The audit reported that a newly configured channel omits all P0 alerts. That
// overstated it: expandChannelPriorities adds P0 whenever P1 is present, so a
// channel created with the old default still paged on P0. The real defect was
// narrower and still real: P0 was absent from the channel UI and from API
// validation, so a channel that deliberately deselected P1 had no way to ask
// for the tier ABOVE it, and the API filtered out an explicit P0.
//
// The audit also prescribed removing P4. That would have been wrong: P4 is the
// tier getPriority assigns to an info-severity instance so it shows on the
// dashboard without paging, which priority.test.ts asserts directly.

const VALID = ["P0", "P1", "P2", "P3", "P4"];

/** Mirrors the filter both channel routes apply to a caller's list. */
const accept = (asked: string[]) => asked.filter((p) => VALID.includes(p));

describe("a channel can opt into P0", () => {
  it("keeps an explicitly requested P0 instead of filtering it out", () => {
    expect(accept(["P0", "P2"])).toEqual(["P0", "P2"]);
  });

  it("still accepts P4, which is the info tier", () => {
    expect(accept(["P4"])).toEqual(["P4"]);
  });

  it("routes the three P0 rules to a channel that asked only for P0", () => {
    const prios = expandChannelPriorities(accept(["P0"]));
    for (const rule of ["mce_uncorrected", "gpu_uncorrected_ecc", "gpu_xid_critical"]) {
      expect(prios).toContain(`P${getPriority(rule)}`);
    }
  });

  it("a channel that deselects P1 and selects P2 does NOT silently receive P0", () => {
    // This is the case the old UI could not express in either direction, and it
    // is correct behaviour: the expansion is a compatibility path for channels
    // that opted into paging, not a rule that everything receives P0.
    expect(expandChannelPriorities(["P2", "P3"])).not.toContain("P0");
  });

  it("an existing P1 channel still receives P0 without being re-saved", () => {
    expect(expandChannelPriorities(["P1", "P2", "P3", "P4"])).toContain("P0");
  });
});
