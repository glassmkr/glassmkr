// Coverage test: every rule type registered in evaluator.ts must
// have a matching YAML file under ../rules/, AND every YAML file
// must correspond to a registered rule (or be explicitly allow-
// listed for watchdog/cross-snapshot rules emitted outside the
// evaluator's snapshot-driven array).
//
// Failure mode: someone adds a rule to evaluator.ts without
// creating a YAML stub → this test fails CI → forces the YAML
// to be authored before merge.
//
// Allow-listed types (not in evaluator.ts's array but emitted
// elsewhere): server_unreachable (watchdog).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRuleMetadata, listMetadataRuleTypes } from "../loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pull the rule type strings from evaluator.ts by parsing the
// source. Cheap regex over the registry's `type: "x"` lines.
function evaluatorRegisteredRuleTypes(): string[] {
  const evaluatorPath = join(
    __dirname,
    "..",
    "..",
    "evaluator.ts",
  );
  const src = readFileSync(evaluatorPath, "utf8");
  const matches = src.matchAll(/^\s*type: "([a-z_]+)",\s*$/gm);
  return [...new Set([...matches].map((m) => m[1]!))];
}

// Allow-listed rule types that aren't in evaluator.ts's snapshot
// rule array (they're emitted by other code paths like the
// watchdog). Adding to this list is a deliberate choice.
const EXTRA_RULE_TYPES: ReadonlySet<string> = new Set([
  "server_unreachable", // emitted by lib/server/watchdog.ts
]);

describe("FIX-workflow rule coverage", () => {
  const inEvaluator = evaluatorRegisteredRuleTypes().sort();
  const inYaml = listMetadataRuleTypes();

  it("every rule registered in evaluator.ts has a YAML file", () => {
    const missing = inEvaluator.filter((t) => !inYaml.includes(t));
    expect(
      missing,
      `These rules are registered in evaluator.ts but missing YAML metadata under ./rules/. Author them per CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every YAML file matches either an evaluator rule or an allow-listed extra", () => {
    const validNames = new Set([...inEvaluator, ...EXTRA_RULE_TYPES]);
    const orphans = inYaml.filter((t) => !validNames.has(t));
    expect(
      orphans,
      `These YAML files don't match any registered rule or allow-listed extra:\n  ${orphans.join("\n  ")}\n\nEither remove the YAML or add the rule to EXTRA_RULE_TYPES (and document where it's emitted from).`,
    ).toEqual([]);
  });

  it("the 62 customer-facing rules are all covered (the canonical count)", () => {
    // 2026-05-20: GPU first release added 8 new rules
    // (gpu_xid_critical, gpu_uncorrected_ecc, gpu_thermal_critical,
    // nvlink_link_down, gpu_pcie_link_degraded, gpu_power_cap_throttling,
    // gpu_driver_or_firmware_drift, gpu_corrected_ecc_storm) bringing
    // the canonical count from 52 to 60. Consumes Crucible v0.13.0
    // snap.gpu. validation-pending provenance throughout; lifts to
    // fleet-tested in follow-up after Simon's 2-3 incoming GPU
    // validation hosts surface 3-5 days of clean data.
    // 2026-05-20 (cycle 2): added io_pressure_high (PSI io.full
    // companion to cpu_iowait_high; catches the modern-NVMe case
    // where iowait stays near zero) bringing the count to 61.
    // 2026-05-26: added cmos_battery_low (P3) as the missing other
    // half of PR #229's psu_rail VBAT exclusion; fires when the
    // motherboard CR2032 reads below 2.6V. Count to 62.
    // 2026-06-27: added gpu_driver_unsafe_reboot (P1) from the 20-box GPU
    // fleet report; fires when an NVIDIA GPU will not survive a reboot
    // (nouveau not blacklisted, or the nvidia module not loaded). Count to 63.
    // 2026-07-03: added ssh_config_unapplied (P2) from the live blind-
    // remediation campaign; fires when sshd_config is edited but the daemon
    // has not reloaded, so a root-login fix does not silently clear the alert
    // while the box stays exposed. Count to 64.
    // 2026-07-04: added memory_channels_underpopulated (P3, DIMM topology
    // Tier 1 per CC_SPEC_DIMM_POPULATION_2026-07-04); fires from SMBIOS
    // Type 17 facts when memory channels are empty or DIMMs run below
    // rated speed. Count to 65.
    // 2026-07-14: added ipmi_sel_full (P3 warning, auto-resolves after a
    // verified SEL clear) from the
    // val campaign (box "asrock"); fires when the BMC SEL is full or
    // near-full (a log-full / logging-disabled Asserted event, or
    // sel_entries_count >= 3000), because a full SEL stops recording new
    // events and ipmi_sel_critical goes structurally deaf to future faults.
    // Count to 66.
    // 2026-07-15: added bios_firmware_age (P3, INFO-only advisory) as the
    // first slice of the currency-monitoring milestone; fires when
    // snap.dmi.bios_date is older than 24 months on bare metal (VM/placeholder
    // dates guarded). Raw BIOS age is not a should-update signal, so it is
    // info-only and worded to prompt vendor-catalog verification. Count to 67.
    // 2026-07-15: added os_end_of_life (P2, warning ceiling) as the second
    // currency-monitoring rule; combines the synced endoflife.date release EOL
    // date with the host's extended-support enrollment (snap.support_status) so
    // a past-EOL host still on ESM/EUS is not falsely called unsupported. Count
    // to 68.
    // 2026-07-18: added drive_smart_unreadable (P2, warning ceiling, never
    // pages) from the drive-health follow-up (Scope 3). Fires when Crucible
    // (0.14.4+, snap.smart_unreadable) sees fixed disks present in /sys/block
    // whose SMART it cannot read (smartmontools missing, or a controller
    // needing a -d type): a monitoring blind spot, not a drive fault. Excludes
    // virtual/removable media and suppresses on healthy HW-RAID by construction.
    // Count to 69.
    // 2026-07-29: added ipmi_monitoring_unavailable (P3, warning) from the
    // DataPacket fit study gap P1-2. Fires when snap.ipmi.detection reports the
    // capability probe failed for any reason EXCEPT no_bmc_device, i.e. the host
    // has a BMC we cannot reach. Every IPMI-derived rule (ipmi_fan_failure,
    // psu_redundancy_loss, ipmi_sel_critical, ipmi_sel_full, SEL-derived
    // ecc_errors) is structurally deaf while it fires. Live on 3 of 20 fleet
    // hosts at time of writing, all reason ipmitool_cve_2020_5208 (ipmitool
    // < 1.8.19 refused by the agent), which is a one-package fix. no_bmc_device
    // is excluded so VMs and BMC-less hosts stay silent. Count to 70.
    // 2026-08-30: added boot_config_broken (P0, critical) + boot_config_drift
    // (P3, warning) from the val-rocky boot-failure postmortem. The collector
    // (Crucible 1.2.0+ snap.boot_config) cross-checks every boot target's
    // root=UUID/LABEL against the filesystems that actually exist:
    // boot_config_broken fires when the NEXT-boot entry resolves to no present
    // filesystem (the "next reboot will not come back" case, caught in the
    // window before the fatal reboot); boot_config_drift fires when the host
    // boots today but the cmdline source / default entry / a fallback entry
    // points at a wrong or absent filesystem (a future kernel update would
    // detonate it). Both capability-gate on snap.boot_config.available and are
    // proven silent on the four val distros. Count to 72.
    expect(inYaml.length).toBe(72);
    expect(inYaml).toContain("ipmi_monitoring_unavailable");
    expect(inYaml).toContain("boot_config_broken");
    expect(inYaml).toContain("boot_config_drift");
    expect(inYaml).toContain("os_end_of_life");
    expect(inYaml).toContain("bios_firmware_age");
    expect(inYaml).toContain("ipmi_sel_full");
    expect(inYaml).toContain("memory_channels_underpopulated");
    expect(inYaml).toContain("io_pressure_high");
    expect(inYaml).toContain("server_unreachable");
    expect(inYaml).toContain("cpu_pressure_high");
    expect(inYaml).toContain("mem_pressure_high");
    expect(inYaml).toContain("mce_uncorrected");
    expect(inYaml).toContain("zfs_slog_faulted");
    expect(inYaml).toContain("disk_fill_projection");
    expect(inYaml).toContain("accept_backlog_or_syn_flood");
    expect(inYaml).toContain("lacp_partner_lost");
    expect(inYaml).toContain("tcp_retrans_high");
    expect(inYaml).toContain("listen_overflow");
    expect(inYaml).toContain("systemd_service_oom_killed");
    expect(inYaml).toContain("service_flapping");
    expect(inYaml).toContain("lvm_thinpool_metadata_high");
    expect(inYaml).toContain("nvme_critical_warning");
    expect(inYaml).toContain("softnet_drops");
    expect(inYaml).toContain("gpu_xid_critical");
    expect(inYaml).toContain("gpu_uncorrected_ecc");
    expect(inYaml).toContain("gpu_thermal_critical");
    expect(inYaml).toContain("nvlink_link_down");
    expect(inYaml).toContain("gpu_pcie_link_degraded");
    expect(inYaml).toContain("gpu_power_cap_throttling");
    expect(inYaml).toContain("gpu_driver_or_firmware_drift");
    expect(inYaml).toContain("gpu_corrected_ecc_storm");
  });

  // Two-tier remediation UX (2026-05-20): every rule must ship a
  // non-trivial quick_check so the dashboard alert detail page can
  // render it as the default expanded view. The schema enforces
  // non-empty strings; this test guards against placeholder content
  // (e.g. "TODO", a one-word stub) sneaking past the Zod check.
  it("every rule has a substantive quick_check command + description", () => {
    const stubs: string[] = [];
    for (const ruleId of inYaml) {
      const meta = getRuleMetadata(ruleId);
      if (!meta) {
        stubs.push(`${ruleId}: missing metadata`);
        continue;
      }
      const qc = meta.fix.quick_check;
      if (!qc || qc.command.trim().length < 5) {
        stubs.push(`${ruleId}: quick_check.command too short`);
      }
      if (!qc || qc.description.trim().length < 20) {
        stubs.push(`${ruleId}: quick_check.description too short`);
      }
      if (qc && /\bTODO\b/i.test(qc.command + qc.description)) {
        stubs.push(`${ruleId}: quick_check contains TODO`);
      }
    }
    expect(
      stubs,
      `These rules have stub or missing quick_check content:\n  ${stubs.join("\n  ")}`,
    ).toEqual([]);
  });

  // Wildcard-fallback invariant. resolveFix documents (and selectVariant
  // relies on) every rule carrying a catch-all `distro_match: ["*"]` +
  // `vendor_match: ["*"]` variant, so a host whose distro/vendor matches no
  // specific variant still gets remediation instead of a null fix_workflow.
  // gpu_driver_unsafe_reboot shipped with only bare distro variants (no
  // wildcard, and bare "debian" that never matches the versioned "debian-13"
  // token), so it rendered no remediation on every real host. This guards
  // the invariant across the whole library.
  it("every rule has a catch-all wildcard variant (distro=* and vendor=*)", () => {
    const missing: string[] = [];
    for (const ruleId of inYaml) {
      const meta = getRuleMetadata(ruleId);
      const variants = meta?.fix.variants ?? [];
      const hasCatchAll = variants.some(
        (v) => v.distro_match.includes("*") && v.vendor_match.includes("*"),
      );
      if (!hasCatchAll) missing.push(ruleId);
    }
    expect(
      missing,
      `These rules have no catch-all { distro_match: ["*"], vendor_match: ["*"] } variant, so resolveFix returns null (no remediation) on any host that matches no specific variant:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
