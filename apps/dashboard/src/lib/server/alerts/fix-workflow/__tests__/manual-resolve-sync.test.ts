// Manual-resolve sync test for the post-incident forensic rule set.
//
// Five rules in the library describe events that already completed by the
// time the alert reaches the dashboard:
//
//   - unexpected_reboot         (host rebooted)
//   - systemd_service_failed    (unit entered failed state)
//   - systemd_service_oom_killed (unit killed by OOM)
//   - oom_kills                 (kernel OOM event fired)
//   - mce_uncorrected           (uncorrected memory error)
//
// All five carry `manual_resolve: true` in their YAML. The flag gates
// the alert detail page's "Mark resolved (manual)" UI; the schema +
// flag are the contract between rule authoring and the UI.
//
// This test pins the contract: any future PR that adds a forensic rule
// to FORENSIC_RULES without setting manual_resolve (or removes
// manual_resolve from one of these five) fails CI before deploy.
//
// Spec: CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md.

import { describe, it, expect } from "vitest";
import { ruleRegistry } from "../loader.js";

// The set expanded 2026-05-27 from 5 to 10 after a post-merge sweep
// (Residual R-5) showed the original list undercounted: the right
// discriminator is "discrete event vs continuous state," not
// verdict_prior. The 5 added rules are all discrete events with no
// software auto-clear path. See apps/dashboard/src/lib/server/alerts/
// rules/README.md for the authoring convention this list pins.
const FORENSIC_RULES = [
  // Original 5 (CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md)
  "unexpected_reboot",
  "systemd_service_failed",
  "systemd_service_oom_killed",
  "oom_kills",
  "mce_uncorrected",
  // Added 2026-05-27 from the post-merge sweep
  "gpu_xid_critical",
  "ipmi_sel_critical",
  "disk_io_errors",
  "filesystem_readonly",
  "nvme_critical_warning",
] as const;

describe("manual_resolve flag pins forensic rules to the manual-resolve UI", () => {
  it("every forensic rule sets manual_resolve: true", () => {
    const missing: string[] = [];
    for (const id of FORENSIC_RULES) {
      const rule = ruleRegistry.get(id);
      if (!rule) {
        throw new Error(
          `forensic rule "${id}" not found in registry; FORENSIC_RULES is out of date or the YAML moved`,
        );
      }
      if (rule.manual_resolve !== true) {
        missing.push(id);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `forensic rule(s) missing manual_resolve: true:\n  - ${missing.join("\n  - ")}\n` +
          `Add the flag below "priority:" in the YAML, or remove the rule from FORENSIC_RULES if it's no longer forensic.`,
      );
    }
  });

  it("no non-forensic rule accidentally sets manual_resolve (would hide the auto-resolve UX)", () => {
    const forensicSet = new Set<string>(FORENSIC_RULES);
    const stray: string[] = [];
    for (const [id, rule] of ruleRegistry.entries()) {
      if (rule.manual_resolve === true && !forensicSet.has(id)) {
        stray.push(id);
      }
    }
    if (stray.length > 0) {
      throw new Error(
        `manual_resolve: true on non-forensic rule(s):\n  - ${stray.join("\n  - ")}\n` +
          `Either move them into FORENSIC_RULES here OR drop the flag in the YAML.`,
      );
    }
  });

  it("flag remains optional on the schema (existing rules without it validate)", () => {
    let withoutFlag = 0;
    for (const rule of ruleRegistry.values()) {
      if (rule.manual_resolve === undefined) withoutFlag++;
    }
    expect(withoutFlag).toBeGreaterThan(0);
  });
});
