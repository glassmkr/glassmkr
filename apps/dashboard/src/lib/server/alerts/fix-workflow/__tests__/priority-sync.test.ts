// Codex 2026-05-22B F1 sync test.
//
// `apps/dashboard/src/lib/alerts/presentation.ts` exports an
// ALERT_PRIORITIES map that the dispatcher consults to filter alerts per
// notification channel. Before Codex review B, that map was hand-
// maintained and drifted: 24 rules were missing from it, 25 had wrong
// values, and P0 GPU data-corruption rules silently defaulted to P3 so
// any paging channel filtered on `priority <= 1` skipped them.
//
// This test pins the two sources together. It loads the YAML rule
// registry via the canonical loader, then asserts every rule's
// declared `priority:` matches the integer in ALERT_PRIORITIES. CI
// catches future drift before deploy.
//
// Failure mode it prevents: a future PR adds a new YAML rule, ships,
// dispatcher defaults its priority to 3 because nobody updated the TS
// map, paging channels miss it, customer never gets the alert that
// matters.

import { describe, it, expect } from "vitest";
import { ALERT_PRIORITIES } from "$lib/alerts/presentation";
import { ruleRegistry } from "../loader.js";

// Stringified YAML enum -> integer used by getPriority() and dispatcher.
const PRIORITY_TO_INT: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

describe("ALERT_PRIORITIES is in sync with the YAML rule library (Codex 2026-05-22B F1)", () => {
  it("every YAML rule has an entry in ALERT_PRIORITIES", () => {
    const missing: string[] = [];
    for (const id of ruleRegistry.keys()) {
      if (!(id in ALERT_PRIORITIES)) missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(
        `ALERT_PRIORITIES is missing ${missing.length} rule(s):\n` +
          missing.map((id) => `  - ${id}`).join("\n") +
          `\n\nFix: add these to apps/dashboard/src/lib/alerts/presentation.ts.`,
      );
    }
  });

  it("every ALERT_PRIORITIES entry has a matching YAML rule", () => {
    // Catches the inverse case: a rule was deleted/renamed but the TS
    // map still references it. Not catastrophic (dead entry) but it
    // means getPriority() on the deleted name returns 1/2/3 instead of
    // the default-3, which can mask other bugs.
    const orphans: string[] = [];
    for (const id of Object.keys(ALERT_PRIORITIES)) {
      if (!ruleRegistry.has(id)) orphans.push(id);
    }
    if (orphans.length > 0) {
      throw new Error(
        `ALERT_PRIORITIES has ${orphans.length} orphaned entry/entries (no matching YAML):\n` +
          orphans.map((id) => `  - ${id}`).join("\n") +
          `\n\nFix: remove these from apps/dashboard/src/lib/alerts/presentation.ts.`,
      );
    }
  });

  it("ALERT_PRIORITIES values match each YAML rule's priority field", () => {
    const mismatches: Array<{ id: string; yaml: string; map: number; expected: number }> = [];
    for (const [id, rule] of ruleRegistry.entries()) {
      const expected = PRIORITY_TO_INT[rule.priority];
      const actual = ALERT_PRIORITIES[id];
      if (expected !== actual) {
        mismatches.push({ id, yaml: rule.priority, map: actual, expected });
      }
    }
    if (mismatches.length > 0) {
      const detail = mismatches
        .map(
          (m) =>
            `  - ${m.id}: YAML says ${m.yaml} (=${m.expected}), ALERT_PRIORITIES has ${m.map}`,
        )
        .join("\n");
      throw new Error(
        `${mismatches.length} priority mismatch(es) between YAML and ALERT_PRIORITIES:\n` +
          detail +
          `\n\nFix: update apps/dashboard/src/lib/alerts/presentation.ts so values match YAML.`,
      );
    }
  });

  it("P0 rules exist in the registry (canary for the fix that prompted this test)", () => {
    // gpu_uncorrected_ecc, gpu_xid_critical, and mce_uncorrected are
    // the three P0 rules in the library at time of writing. They are
    // the ones that triggered the Codex critical finding (silently
    // routed through paging filters as P3). If a future YAML edit
    // demotes them all without intent, this test makes the change loud.
    const p0Rules: string[] = [];
    for (const [id, rule] of ruleRegistry.entries()) {
      if (rule.priority === "P0") p0Rules.push(id);
    }
    expect(p0Rules.length).toBeGreaterThan(0);
  });
});
