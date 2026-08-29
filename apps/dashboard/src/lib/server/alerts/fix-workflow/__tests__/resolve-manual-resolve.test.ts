// resolveFix must surface rule.manual_resolve to the dashboard so the
// AlertRow.svelte gate can show the "Mark resolved (manual)" button on
// exactly the 5 forensic rules and not on the other 57. Per
// CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md.

import { describe, it, expect } from "vitest";
import { resolveFix } from "../resolve.js";

// Kept in sync with manual-resolve-sync.test.ts FORENSIC_RULES. Expanded
// 2026-05-27 from 5 to 10 per the post-merge sweep (Residual R-5).
const FORENSIC_RULES = [
  "unexpected_reboot",
  "systemd_service_failed",
  "systemd_service_oom_killed",
  "oom_kills",
  "mce_uncorrected",
  "gpu_xid_critical",
  "ipmi_sel_critical",
  "disk_io_errors",
  "filesystem_readonly",
  "nvme_critical_warning",
] as const;

// Spot-checks of auto-resolvable rules: these MUST report manual_resolve: false
// or the UI would prompt the operator to manually close alerts that the
// snapshot loop would auto-close on the next ingest.
const AUTO_RESOLVABLE_SPOT_CHECKS = [
  "cpu_high",
  "memory_high",
  "disk_full",
  "tcp_retrans_high",
] as const;

const SERVER = {
  os_id: "debian",
  os_id_like: null,
  os_version_id: "13",
  dmi_vendor: null,
};

describe("resolveFix exposes manual_resolve to the dashboard", () => {
  for (const id of FORENSIC_RULES) {
    it(`${id} resolves with manual_resolve: true`, () => {
      const out = resolveFix(id, {}, SERVER);
      expect(out, `resolveFix returned null for forensic rule ${id}`).not.toBeNull();
      expect(out?.manual_resolve, id).toBe(true);
    });
  }

  for (const id of AUTO_RESOLVABLE_SPOT_CHECKS) {
    it(`${id} resolves with manual_resolve: false`, () => {
      const out = resolveFix(id, {}, SERVER);
      if (out === null) {
        // Rule absent from the YAML library on this branch; that's a
        // separate concern handled by rule-coverage tests.
        return;
      }
      expect(out.manual_resolve, id).toBe(false);
    });
  }
});
