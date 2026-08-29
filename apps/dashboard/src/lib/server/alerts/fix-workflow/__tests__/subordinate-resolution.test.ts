// Codex 2026-05-22B F6 lint test.
//
// The loader (loader.ts) deliberately allows forward-reference
// `subordinate_to: <future_rule>` because PRs sometimes pre-declare a
// parent that lands in a follow-up PR. The runtime fails open: a child
// whose declared parent isn't in active_alerts simply emits independently.
//
// That tolerance let `unexpected_reboot.subordinate_to:
// kernel_panic_detected` sit dangling for months — Codex review B flagged
// it. The YAML promised an alert-collapse that can never happen because
// the parent rule was never built.
//
// This test asserts every `subordinate_to` value resolves to a registered
// rule id, with a documented allow-list for intentional pre-declarations.
// Adding a forward-reference is now a conscious act: the contributor must
// add the parent to KNOWN_FORWARD_REFS below, which gives reviewers a
// concrete place to ask "is this parent actually planned?".

import { describe, it, expect } from "vitest";
import { ruleRegistry } from "../loader.js";

/**
 * Allow-listed forward-references. Each entry must have a tracking link
 * or rationale comment so we know why it's pending.
 *
 * Empty at the time the test was introduced (Codex review B closed the
 * one historical entry, `kernel_panic_detected`).
 */
const KNOWN_FORWARD_REFS: ReadonlySet<string> = new Set<string>([
  // (no current entries)
]);

describe("subordinate_to resolution (Codex 2026-05-22B F6)", () => {
  it("every subordinate_to in the rule library resolves OR is allow-listed", () => {
    const unresolved: Array<{ child: string; parent: string }> = [];
    for (const [childId, rule] of ruleRegistry.entries()) {
      if (!rule.subordinate_to) continue;
      const parent = rule.subordinate_to;
      if (ruleRegistry.has(parent)) continue;
      if (KNOWN_FORWARD_REFS.has(parent)) continue;
      unresolved.push({ child: childId, parent });
    }
    if (unresolved.length > 0) {
      throw new Error(
        `${unresolved.length} unresolved subordinate_to reference(s):\n` +
          unresolved.map((u) => `  - ${u.child} -> ${u.parent}`).join("\n") +
          `\n\nFix: either ship the parent rule, drop the subordinate_to from the child YAML, ` +
          `or add the parent id to KNOWN_FORWARD_REFS in this test file with a comment ` +
          `explaining the tracking issue / planned PR.`,
      );
    }
  });

  it("KNOWN_FORWARD_REFS does not contain ids that already exist (would mask real drift)", () => {
    // If a parent rule lands in the library while still allow-listed,
    // the allow-list entry becomes a noise/maintenance hazard. Remove it.
    const stale: string[] = [];
    for (const id of KNOWN_FORWARD_REFS) {
      if (ruleRegistry.has(id)) stale.push(id);
    }
    expect(stale).toEqual([]);
  });
});
