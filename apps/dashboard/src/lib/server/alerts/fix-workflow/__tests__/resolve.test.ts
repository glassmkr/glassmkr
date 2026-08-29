// Tests for resolveFix() and its NULL-server-row degradation path.
//
// Per CC_SPEC_02B_MINIMAL_WIRING_2026-05-17.md test plan: 7 patterns
// representing the deepened YAML library's variant shapes, plus an
// 8th case for the NULL-server-row safe-degradation behavior. All
// tests run against the real YAML rule registry loaded at boot — they
// validate that the actual deployed YAMLs match the patterns the
// dashboard expects.

import { describe, it, expect } from "vitest";
import { resolveFix, interpolateEvidence, type ServerLocator } from "../resolve";

// Helper: build a ServerLocator for test ergonomics. All four fields
// are nullable per the migration-021 schema.
function locator(over: Partial<ServerLocator> = {}): ServerLocator {
  return {
    os_id: null,
    os_id_like: null,
    os_version_id: null,
    dmi_vendor: null,
    ...over,
  };
}

describe("resolveFix", () => {
  describe("0. suggested_action (agent-runnable non-interactive command)", () => {
    it("disk_space_high exposes a non-interactive suggested_action with {{mount}} interpolated", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: 89, mount: "/var/log", device: "/dev/sda1", available_gb: 8 },
        locator({ os_id: "debian", os_version_id: "12" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.suggested_action).toBeTruthy();
      expect(fix!.suggested_action).toContain("/var/log");
      expect(fix!.suggested_action).not.toMatch(/<mount>|<MOUNT>|\{\{/);
    });

    it("no_firewall (ufw) suggested_action is non-interactive and SSH-first", () => {
      const fix = resolveFix(
        "no_firewall",
        { source: "ufw" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix!.suggested_action).toContain("--force enable");
      expect(fix!.suggested_action).toContain("allow OpenSSH");
    });

    it("ssh_root_password suggested_action validates then reloads (non-interactive)", () => {
      const fix = resolveFix(
        "ssh_root_password",
        {},
        locator({ os_id: "debian", os_version_id: "12" })
      );
      expect(fix!.suggested_action).toContain("sshd -t");
      expect(fix!.suggested_action).toContain("reload");
    });

    it("a judgment/physical rule without suggested_action returns null (not a fabricated command)", () => {
      const fix = resolveFix(
        "nvme_wear_high",
        { device: "/dev/sdb", percent_used: 80 },
        locator({ os_id: "debian", os_version_id: "12" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.suggested_action).toBeNull();
    });
  });

  describe("1. numeric severity-band split", () => {
    it("disk_space_high gte 95 → critical variant", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: 96, mount: "/var", device: "/dev/sda1", available_gb: 0.5 },
        locator({ os_id: "ubuntu", os_version_id: "24.04", dmi_vendor: "Supermicro" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(true);
      // Critical-band content should include emergency cleanup steps
      expect(fix!.command).toMatch(/journalctl --vacuum-size=500M/);
      expect(fix!.command).toMatch(/Critical/i);
    });

    it("disk_space_high lt 95 → warning variant", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: 87, mount: "/var", device: "/dev/sda1", available_gb: 12 },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(true);
      // Warning-band content emphasises planning, not emergency
      expect(fix!.command).toMatch(/Plan cleanup|warning|growth rate/i);
    });
  });

  describe("2. enum split on operationally-meaningful attribute", () => {
    it("no_firewall source=ufw → UFW variant", () => {
      const fix = resolveFix(
        "no_firewall",
        { source: "ufw" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/ufw allow 22\/tcp/);
      expect(fix!.command).toMatch(/ufw default deny incoming/);
    });

    it("no_firewall source=firewalld → firewalld variant", () => {
      const fix = resolveFix(
        "no_firewall",
        { source: "firewalld" },
        locator({ os_id: "rocky", os_version_id: "9.6" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/systemctl enable --now firewalld/);
      expect(fix!.command).toMatch(/firewall-cmd/);
    });

    it("no_firewall source=nftables → nftables variant", () => {
      const fix = resolveFix(
        "no_firewall",
        { source: "nftables" },
        locator({ os_id: "debian", os_version_id: "13" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/nft -c -f|nft list ruleset|nftables\.conf/);
    });
  });

  describe("3. boolean condition_match", () => {
    it("ntp_not_synced synced=false → critical variant", () => {
      const fix = resolveFix(
        "ntp_not_synced",
        { synced: false, daemon_running: true, source: "chrony", daemon_name: "chronyd" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(true);
      expect(fix!.command).toMatch(/Critical|drifting/i);
      expect(fix!.command).toMatch(/chronyc -a makestep|systemctl restart systemd-timesyncd/);
    });

    it("ntp_not_synced synced=true → warning variant (daemon stopped)", () => {
      const fix = resolveFix(
        "ntp_not_synced",
        { synced: true, daemon_running: false, source: "systemd-timesyncd", daemon_name: "systemd-timesyncd" },
        locator({ os_id: "debian", os_version_id: "12" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(true);
      expect(fix!.command).toMatch(/Warning|daemon stopped|protection is gone/i);
    });
  });

  describe("4. distro-only split (no condition_match)", () => {
    it("pending_security_updates on Ubuntu → apt variant", () => {
      const fix = resolveFix(
        "pending_security_updates",
        { pendingCount: 5, distro: "ubuntu" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/sudo apt update/);
      expect(fix!.command).toMatch(/apt list --upgradable/);
    });

    it("pending_security_updates on Rocky → dnf variant", () => {
      const fix = resolveFix(
        "pending_security_updates",
        { pendingCount: 8, distro: "rocky" },
        locator({ os_id: "rocky", os_version_id: "9.6" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/dnf update --security/);
      expect(fix!.command).toMatch(/dnf updateinfo list --security/);
    });

    it("pending_security_updates on unknown distro → wildcard fallback", () => {
      const fix = resolveFix(
        "pending_security_updates",
        { pendingCount: 3, distro: "alpine" },
        locator({ os_id: "alpine", os_version_id: "3.20" })
      );
      expect(fix).not.toBeNull();
      // Fallback variant detects pkg manager dynamically via command -v
      expect(fix!.command).toMatch(/command -v apt|command -v dnf/);
    });
  });

  describe("5. missing-evidence fallback (multi-tier evaluator)", () => {
    it("psu_redundancy_loss aggregate_state=redundancy_lost → Dell Tier 1 critical variant", () => {
      const fix = resolveFix(
        "psu_redundancy_loss",
        { aggregate_state: "redundancy_lost", path: "aggregate-redundancy" },
        locator({ os_id: "rocky", os_version_id: "9.6", dmi_vendor: "Dell Inc." })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(true);
      expect(fix!.command).toMatch(/redundancy is GONE|sudo ipmitool sdr type 'Power Supply'/);
    });

    it("psu_redundancy_loss per-PSU path (no aggregate_state) → Tier 2 fallback variant", () => {
      const fix = resolveFix(
        "psu_redundancy_loss",
        { failed: [{ name: "PS1", status: "fault", value: "0" }], total_psus: 2, path: "per-psu-fault" },
        locator({ os_id: "ubuntu", os_version_id: "24.04", dmi_vendor: "Supermicro" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.condition_matched).toBe(false);
      expect(fix!.command).toMatch(/Per-PSU fault path|Walk all PSU-like sensors/i);
    });
  });

  describe("6. rule not in YAML library", () => {
    it("returns null for an invented rule type", () => {
      const fix = resolveFix(
        "something_invented_that_doesnt_exist",
        { foo: "bar" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).toBeNull();
    });
  });

  describe("7. defensive: malformed evidence", () => {
    it("evidence=undefined → wildcard fallback variant", () => {
      const fix = resolveFix(
        "disk_space_high",
        undefined,
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      // No condition_match match without evidence → fallback variant has none
      expect(fix!.variant_match.condition_matched).toBe(false);
    });

    it("evidence with NULL fields → still resolves wildcard fallback", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: null as unknown as number, mount: null as unknown as string },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      // percent_used=null evaluates condition to false → falls to wildcard
      expect(fix!.variant_match.condition_matched).toBe(false);
    });
  });

  describe("8. NULL-server-row safe degradation (Simon ask #2, 2026-05-17)", () => {
    it("NULL os_id + NULL dmi_vendor → wildcard fallback variant", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: 96, mount: "/var" },
        locator()  // everything NULL
      );
      expect(fix).not.toBeNull();
      // With NULL distro/vendor, only ["*"] variants match. disk_space_high
      // has 3 variants, all with distro_match: ["*"]; the condition_match
      // attribute filters down to the critical variant.
      expect(fix!.variant_match.condition_matched).toBe(true);
      expect(fix!.command).toMatch(/Critical path|>=95/i);
    });

    it("NULL os_id + NULL dmi_vendor on a distro-split rule → wildcard fallback variant only", () => {
      // pending_security_updates has 3 variants: debian-*, rhel-*, and *
      // With NULL distro, only the * variant matches.
      const fix = resolveFix(
        "pending_security_updates",
        { pendingCount: 5, distro: "unknown" },
        locator()  // everything NULL
      );
      expect(fix).not.toBeNull();
      // The wildcard variant uses `command -v apt` / `command -v dnf` detection
      expect(fix!.command).toMatch(/command -v apt|command -v dnf/);
    });

    it("NULL os_id but present dmi_vendor → still wildcard for distro, vendor matches its own pattern", () => {
      // ssh_root_password has distro-specific variants (debian-* and rhel-*)
      // plus a * fallback. With NULL os_id, only the * fallback matches
      // regardless of vendor.
      const fix = resolveFix(
        "ssh_root_password",
        { permitRootLogin: "yes", passwordAuthentication: "yes" },
        locator({ dmi_vendor: "Supermicro" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toMatch(/Detect the systemd unit name|UNIT=sshd|UNIT=ssh/);
    });
  });

  describe("structural invariants", () => {
    it("ResolvedFix always includes all sibling fields (not just command)", () => {
      const fix = resolveFix(
        "disk_space_high",
        { percent_used: 96 },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).toBeTruthy();
      expect(fix!.description).toBeTruthy();
      expect(Array.isArray(fix!.prerequisites)).toBe(true);
      expect(fix!.prerequisites.length).toBeGreaterThan(0);
      // safe_mode + validation may be null per rule schema, but should be defined keys
      expect(fix!).toHaveProperty("safe_mode");
      expect(fix!).toHaveProperty("validation");
      expect(fix!.rollback).toBeTruthy();
      expect(fix!.impact).toBeTruthy();
      expect(fix!.variant_match).toBeTruthy();
    });
  });

  // R-P2-1: per-alert verdict override. The evaluator can set
  // evidence.verdict_prior_override (cpu_temperature_high flips
  // vendor-side -> investigation when the temperature is load-correlated).
  describe("8. per-alert verdict_prior override", () => {
    it("cpu_temperature_high default verdict is the YAML vendor-side", () => {
      const fix = resolveFix(
        "cpu_temperature_high",
        { value: 92, load_correlated: false },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.verdict_prior).toBe("vendor-side");
    });

    it("evidence.verdict_prior_override=investigation flips the verdict", () => {
      const fix = resolveFix(
        "cpu_temperature_high",
        { value: 92, load_correlated: true, verdict_prior_override: "investigation" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.verdict_prior).toBe("investigation");
    });

    it("an invalid override value is ignored; falls back to YAML default", () => {
      const fix = resolveFix(
        "cpu_temperature_high",
        { value: 92, verdict_prior_override: "not-a-real-verdict" },
        locator({ os_id: "ubuntu", os_version_id: "24.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.verdict_prior).toBe("vendor-side");
    });
  });

  // Evidence interpolation: {{key}} tokens in a command are replaced with the
  // firing alert's scalar evidence, so the fix names the real device/component
  // instead of a placeholder. Shell vars (${VAR}) stay untouched.
  describe("9. evidence interpolation into commands", () => {
    it("interpolateEvidence: replaces {{key}}, leaves ${VAR}, unknown -> <key>", () => {
      expect(interpolateEvidence("a {{x}} b", { x: "md0" })).toBe("a md0 b");
      expect(interpolateEvidence("keep ${DEVICE}", { DEVICE: "nope" })).toBe("keep ${DEVICE}");
      expect(interpolateEvidence("{{missing}}", {})).toBe("<missing>");
      expect(interpolateEvidence("{{n}}", { n: 42 })).toBe("42");
      expect(interpolateEvidence("{{obj}}", { obj: { a: 1 } })).toBe("<obj>");
      expect(interpolateEvidence("plain", undefined)).toBe("plain");
    });

    it("raid_degraded: names the real array (/dev/md0), no leftover token", () => {
      const fix = resolveFix(
        "raid_degraded",
        { device: "md0", raid_kind: "mdadm", level: "raid1", failed_disks: ["sdb"] },
        locator({ os_id: "debian", os_version_id: "13", dmi_vendor: "Supermicro" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).not.toContain("{{");
      expect(fix!.command).not.toContain("/dev/md126");
      expect(fix!.command + fix!.quick_check.command).toContain("/dev/md0");
    });

    it("nvme_wear_high: names the real device (/dev/nvme0n1), no leftover token", () => {
      const fix = resolveFix(
        "nvme_wear_high",
        { device: "/dev/nvme0n1", percentage_used: 96, model: "Samsung PM9A3" },
        locator({ os_id: "debian", os_version_id: "13" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.command).not.toContain("{{");
      expect(fix!.command + fix!.quick_check.command).toContain("/dev/nvme0n1");
    });

    it("ipmi_sel_critical: quick-check leads with the named component", () => {
      const fix = resolveFix(
        "ipmi_sel_critical",
        { affected_components: "DIMM_A1", sensor_types: ["Memory"], critical_events: [] },
        locator({ os_id: "debian", os_version_id: "13" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.quick_check.command).toContain("DIMM_A1");
      expect(fix!.quick_check.command).not.toContain("{{affected_components}}");
    });
  });

  // Regression for a real defect found in review on 2026-07-29: a rule declared
  // `distro_match: ["ubuntu"]` instead of `["ubuntu-*"]`. buildDistroToken emits
  // `${os_id}-${os_version_id}`, so a bare family name matches NOTHING and every
  // versioned host silently falls through to the `["*"]` wildcard variant. That is
  // invisible in normal use (a workflow still resolves) and is only caught by
  // asserting WHICH variant matched, which nothing did before this block.
  describe("distro_match patterns must be globs, not bare family names", () => {
    // Subject moved 2026-07-30. These originally used ipmi_monitoring_unavailable,
    // which was where the bare-family-name bug was found; that rule has since been
    // repointed at an unresponsive BMC and its remediation is deliberately
    // distro-agnostic (one ["*"] variant), so it can no longer exercise the glob
    // path. The guard is what matters, not the subject, so it now runs against
    // kernel_needs_reboot, which genuinely splits by package manager. Deleting
    // these would have removed the only assertion in the suite that checks WHICH
    // variant matched.
    it("kernel_needs_reboot: Ubuntu 22.04 selects a distro variant, not the wildcard", () => {
      const fix = resolveFix(
        "kernel_needs_reboot",
        { running_kernel: "6.8.0-100-generic", installed_kernel: "6.8.0-107-generic" },
        locator({ os_id: "ubuntu", os_version_id: "22.04" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.distro_matched).not.toBe("*");
    });

    it("kernel_needs_reboot: Rocky 9.8 selects a distro variant, not the wildcard", () => {
      const fix = resolveFix(
        "kernel_needs_reboot",
        { running_kernel: "5.14.0-503.el9", installed_kernel: "5.14.0-511.el9" },
        locator({ os_id: "rocky", os_version_id: "9.8" })
      );
      expect(fix).not.toBeNull();
      expect(fix!.variant_match.distro_matched).not.toBe("*");
    });

    it("ipmi_monitoring_unavailable: no workflow step resets the BMC", () => {
      // An earlier draft's wildcard variant ended with
      // `ipmitool mc info || ipmitool mc reset cold`, so a package-version problem
      // could get an operator to reset a BMC, against Crucible's own doctor
      // guidance. Assert across every variant, including the wildcard that an
      // unknown distro still lands on.
      for (const loc of [
        locator({ os_id: "ubuntu", os_version_id: "22.04" }),
        locator({ os_id: "rocky", os_version_id: "9.8" }),
        locator(),
      ]) {
        const fix = resolveFix(
          "ipmi_monitoring_unavailable",
          { bmc_device_node: "/dev/ipmi0", probe_status: "failed" },
          loc
        );
        expect(fix).not.toBeNull();
        const allText = [
          fix!.command,
          fix!.quick_check.command,
          fix!.safe_mode?.command ?? "",
        ].join("\n");
        expect(allText).not.toContain("mc reset");
      }
    });
  });
});
