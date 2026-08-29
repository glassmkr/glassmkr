// Regression coverage for the 8 GPU rules from PR #166.
//
// EVIDENCE_MAP drives the alert-detail "evidence" navigation links.
// Without an entry, the alert card renders no link to the GPU panel
// and the customer has no jump-target from the alert to the per-GPU
// breakdown that explains it. PR #166 shipped the rules with no
// EVIDENCE_MAP entries; this PR adds them and pins them.

import { describe, expect, it } from "vitest";

import { EVIDENCE_MAP } from "../presentation";

const GPU_RULES = [
  "gpu_xid_critical",
  "gpu_uncorrected_ecc",
  "gpu_thermal_critical",
  "nvlink_link_down",
  "gpu_pcie_link_degraded",
  "gpu_power_cap_throttling",
  "gpu_driver_or_firmware_drift",
  "gpu_corrected_ecc_storm",
];

describe("EVIDENCE_MAP GPU coverage", () => {
  for (const rule of GPU_RULES) {
    it(`${rule} has at least one evidence link pointing to #gpu`, () => {
      const entries = EVIDENCE_MAP[rule];
      expect(entries, `missing EVIDENCE_MAP entry for ${rule}`).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.anchor === "#gpu")).toBe(true);
    });
  }
});
