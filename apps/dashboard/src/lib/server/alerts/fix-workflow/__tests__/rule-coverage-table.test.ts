// B-F8 table-driven per-rule positive+negative coverage test.
//
// Deferred from Codex review B (2026-05-22). Closes the gap that ships
// today: many rules have only positive tests ("rule fires under these
// conditions") and no negative test ("rule does NOT fire when condition
// is below threshold"), which means threshold-tightening regressions
// like the listen_overflow noise-fix (PR #230) and the PSU rail
// out-of-spec fix (PR #229; signal then named psu_rail_drift) can land
// with only positive coverage and no proof the
// no-fire band is respected.
//
// This test walks every test file in alerts/__tests__/ that uses the
// `alertsOf("<rule_id>", ...)` helper, classifies each call site as
// positive (asserts a result is returned) or negative (asserts no
// result), and aggregates per rule. A rule with no positive case OR
// no negative case fails the test.
//
// Rules tested through other harnesses (cross-snapshot rules, GPU
// rules with their own per-rule positive-only tests, watchdog rules
// emitted outside the evaluator's snapshot loop) are allow-listed
// with a reason. Adding to the allow-list is a deliberate signal:
// "this rule's coverage lives in a different test file (or doesn't
// have negative-shape coverage yet); future PRs should still backfill."

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ruleRegistry } from "../loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALERTS_TESTS_DIR = join(__dirname, "..", "..", "__tests__");

interface RuleCoverage {
  positive: number;
  negative: number;
  // Test files where the rule is referenced (for diagnostics).
  files: Set<string>;
}

function buildCoverageTable(): Map<string, RuleCoverage> {
  const table = new Map<string, RuleCoverage>();
  const testFiles = readdirSync(ALERTS_TESTS_DIR).filter((f) =>
    f.endsWith(".test.ts"),
  );

  // Match an alertsOf("rule_id", ...) call. Capture: rule id + the
  // surrounding ~200 chars after it so we can read the assertion
  // shape. The lookahead window covers both same-line shapes
  // (`expect(alertsOf("X", s)).toHaveLength(0)`) and
  // destructure-on-next-line shapes (`const [a] = alertsOf("X", s);`).
  //
  // `s` flag lets `.` match newlines so multi-line assertions work.
  const callPattern = /alertsOf\("([a-z_]+)"[^;]*[\s;]/g;

  for (const file of testFiles) {
    const src = readFileSync(join(ALERTS_TESTS_DIR, file), "utf8");

    // Walk every alertsOf call site.
    for (const match of src.matchAll(callPattern)) {
      const ruleId = match[1]!;
      const startIdx = match.index!;
      // Capture roughly 200 chars after the call start; that window
      // catches the immediate `.toHaveLength(N)` / `[N]` / destructure
      // assertion that follows.
      const ctx = src.slice(startIdx, startIdx + 200);

      const isNegative =
        // Most common: same-line .toHaveLength(0)
        /\.toHaveLength\(\s*0\s*\)/.test(ctx) ||
        // Also: .toEqual([]) on the result
        /\)\s*\)\s*\.toEqual\(\s*\[\s*\]\s*\)/.test(ctx);

      if (!table.has(ruleId)) {
        table.set(ruleId, { positive: 0, negative: 0, files: new Set() });
      }
      const entry = table.get(ruleId)!;
      entry.files.add(file);
      if (isNegative) {
        entry.negative++;
      } else {
        entry.positive++;
      }
    }
  }

  return table;
}

// Rules tested via mechanisms other than `alertsOf()` against the main
// rules array, OR rules with known TODO coverage gaps that future PRs
// should backfill. Each entry needs a one-line reason. The allowlist
// itself is the visible worklist; chipping away at TODO(b-f8) entries
// is the follow-up workstream after this test infrastructure lands.
//
// New additions reviewed in PR diff. Removing an entry requires the
// rule to have BOTH a positive and a negative case discoverable via
// alertsOf() (or the "dead allowlist" check below catches it).
const COVERAGE_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  // ===== Cross-snapshot / out-of-band evaluators =====
  // These don't run through the main rules array; they have their own
  // test harnesses with snapshot-pair fixtures.
  ["accept_backlog_or_syn_flood", "tested in cross-snapshot-rules.test.ts via the snapshot-pair fixture pattern"],
  ["interface_errors", "evaluateInterfaceErrors() runs from ingest; tests live in interface-errors.test.ts"],
  ["unexpected_reboot", "evaluateUnexpectedReboot() needs cross-snapshot uptime; tested in unexpected-reboot-decay.test.ts"],
  ["server_unreachable", "emitted by lib/server/watchdog.ts, not the evaluator rules array"],

  // ===== GPU rules =====
  // Every GPU rule has positive cases in gpu-rules.test.ts. Negative
  // cases TODO (most use the typed GpuRuleSchema fixture which doesn't
  // trivially compose a no-fire shape).
  ["gpu_xid_critical", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_uncorrected_ecc", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_thermal_critical", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_pcie_link_degraded", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_power_cap_throttling", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_driver_or_firmware_drift", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["gpu_driver_unsafe_reboot", "positive (critical + warning) and negative cases in gpu-rules.test.ts via driver_resilience fixtures"],
  ["gpu_corrected_ecc_storm", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],
  ["nvlink_link_down", "TODO(b-f8): positive in gpu-rules.test.ts; add negative case"],

  // ===== NO TESTS — missing both positive and negative cases =====
  // These rules have no alertsOf() coverage at all yet. Many were added
  // in audit-c1-c6 / audit-c7-c10 / audit-c11-c18 batches and shipped
  // with cross-snapshot or activation-bundle tests in dedicated files
  // (c7-c10-activation.test.ts, etc.) but didn't get standard
  // alertsOf-style cases in evaluator.test.ts.
  ["cpu_pressure_high", "TODO(b-f8): cross-snapshot c-bundle covers activation; add stand-alone alertsOf positive + negative"],
  ["disk_fill_projection", "TODO(b-f8): tested in cross-snapshot-rules.test.ts via projection-fixture pattern; add alertsOf cases"],
  ["lacp_partner_lost", "TODO(b-f8): tested in c7-c10-activation.test.ts; add alertsOf positive + negative cases"],
  ["listen_overflow", "TODO(b-f8): rate-gate tested in c7-c10-activation.test.ts (PR #230); add evaluator.test.ts cases"],
  ["lvm_thinpool_metadata_high", "TODO(b-f8): tested in c11-c18-activation.test.ts; add alertsOf cases"],
  ["mce_uncorrected", "TODO(b-f8): tested in c1-c6-deferred-tunes.test.ts; add alertsOf cases"],
  // mem_pressure_high: positive + negative coverage now lives in
  // evaluator.test.ts (R-P2-4 PSI-plus-corroborator behavioral fixture).
  ["nvme_critical_warning", "TODO(b-f8): tested in c11-c18-activation.test.ts; add alertsOf cases"],
  ["service_flapping", "TODO(b-f8): tested in cross-snapshot-rules.test.ts via flap-history fixture; add alertsOf cases"],
  ["softnet_drops", "TODO(b-f8): tested in c11-c18-activation.test.ts; add alertsOf cases"],
  ["systemd_service_oom_killed", "TODO(b-f8): tested in c11-c18-activation.test.ts; add alertsOf cases"],
  ["tcp_retrans_high", "TODO(b-f8): rate-gate tested in c7-c10-activation.test.ts; add alertsOf cases"],
  ["zfs_slog_faulted", "TODO(b-f8): tested in c1-c6-deferred-tunes.test.ts; add alertsOf cases"],

  // ===== Negative-only coverage =====
  // These have alertsOf-style negative cases (healthy snapshot
  // produces no fire) but no synthetic positive snapshot. Backfilling
  // requires constructing a snapshot shape that triggers each
  // condition; doable but not trivial.
  ["cpu_iowait_high", "TODO(b-f8): negative-only; backfill positive with snap.cpu.iowait_percent above threshold"],
  // disk_io_errors: removed 2026-07-02; the SMART-join (affected_drives) tests
  // added positive alertsOf() cases, so the rule now has full coverage.
  ["interface_saturation", "TODO(b-f8): negative-only; backfill positive with snap.network[].rx/tx_rate near link_speed_mbps"],
  // kernel_needs_reboot: removed 2026-07-25; the running-newer-than-installed
  // false-positive fix added positive + negative alertsOf() cases, so the rule
  // now has full coverage.
  ["link_speed_mismatch", "TODO(b-f8): negative-only; backfill positive with snap.network[].speed_mbps below ethtool advertised"],
  // no_firewall: removed 2026-09-04; the consulted-backends message test added
  // a second positive alertsOf() case, so the rule now has full coverage.
  // oom_kills: positive + negative alertsOf coverage exists in
  // evaluator.test.ts (the R-P2-4 mem_pressure_high fixture's
  // oom-corroborator case made the existing positive explicit to the
  // scanner).
  ["pending_security_updates", "TODO(b-f8): negative-only; backfill positive with snap.security.security_updates_count > threshold"],
  // raid_degraded: positive + negative coverage now lives in evaluator.test.ts
  // (R-P2-2 ownership-note regression test fires it via snap.raid[].degraded).
  ["ssh_root_password", "TODO(b-f8): negative-only; backfill positive with snap.security.sshd.permit_root_login + password_auth = true"],
  ["unattended_upgrades_disabled", "TODO(b-f8): negative-only; backfill positive with snap.security.auto_updates.configured = false"],
]);

describe("FIX-workflow rule coverage table (B-F8)", () => {
  const table = buildCoverageTable();

  it("every YAML rule has at least one positive and one negative test (or an explicit allowlist entry)", () => {
    const gaps: string[] = [];

    for (const ruleId of ruleRegistry.keys()) {
      if (COVERAGE_ALLOWLIST.has(ruleId)) continue;

      const cov = table.get(ruleId);
      if (!cov) {
        gaps.push(
          `${ruleId}: NO TESTS — add either an alertsOf("${ruleId}", ...) case in evaluator.test.ts or allowlist with a reason`,
        );
        continue;
      }
      if (cov.positive === 0) {
        gaps.push(
          `${ruleId}: 0 positive cases (negative-only is suspicious; add a positive case)`,
        );
      }
      if (cov.negative === 0) {
        gaps.push(
          `${ruleId}: 0 negative cases (no proof the no-fire band holds; add an expect(alertsOf("${ruleId}", ...)).toHaveLength(0) case)`,
        );
      }
    }

    if (gaps.length > 0) {
      throw new Error(
        `B-F8 coverage gaps (${gaps.length}):\n  - ${gaps.join("\n  - ")}\n\n` +
          `Each gap is either: (a) add a missing positive/negative case in evaluator.test.ts (preferred), ` +
          `or (b) add an entry to COVERAGE_ALLOWLIST in this file with a reason ` +
          `(e.g. "tested via cross-snapshot fixture in foo.test.ts").`,
      );
    }
  });

  it("allowlist does not contain rules that actually have full coverage (dead allowlist entries)", () => {
    const dead: string[] = [];
    for (const ruleId of COVERAGE_ALLOWLIST.keys()) {
      const cov = table.get(ruleId);
      if (cov && cov.positive > 0 && cov.negative > 0) {
        dead.push(
          `${ruleId}: has ${cov.positive} positive + ${cov.negative} negative cases via alertsOf(); remove from COVERAGE_ALLOWLIST`,
        );
      }
    }
    if (dead.length > 0) {
      throw new Error(
        `Dead allowlist entries (${dead.length}):\n  - ${dead.join("\n  - ")}`,
      );
    }
  });

  it("allowlist does not contain rule IDs that no longer exist in the registry", () => {
    const stale: string[] = [];
    for (const ruleId of COVERAGE_ALLOWLIST.keys()) {
      if (!ruleRegistry.has(ruleId)) {
        stale.push(ruleId);
      }
    }
    expect(
      stale,
      `COVERAGE_ALLOWLIST has IDs not in the rule registry:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  // Diagnostic output: when the suite is run with VERBOSE_COVERAGE=1,
  // print the full table. Not an assertion, just a print. Helps when
  // backfilling negative cases to know where to start.
  it("(diagnostic) emits a coverage table summary when VERBOSE_COVERAGE=1", () => {
    if (process.env.VERBOSE_COVERAGE !== "1") return;
    const rows: Array<{ rule: string; pos: number; neg: number; status: string }> = [];
    for (const ruleId of ruleRegistry.keys()) {
      const cov = table.get(ruleId);
      const inAllowlist = COVERAGE_ALLOWLIST.has(ruleId);
      const pos = cov?.positive ?? 0;
      const neg = cov?.negative ?? 0;
      const status =
        inAllowlist
          ? "allowlisted"
          : pos === 0
            ? "MISSING positive"
            : neg === 0
              ? "MISSING negative"
              : "covered";
      rows.push({ rule: ruleId, pos, neg, status });
    }
    rows.sort((a, b) => a.rule.localeCompare(b.rule));
    // eslint-disable-next-line no-console
    console.log("\nB-F8 rule coverage table:\n");
    // eslint-disable-next-line no-console
    console.log(rows.map((r) => `  ${r.rule.padEnd(38)} pos=${r.pos} neg=${r.neg}  ${r.status}`).join("\n"));
  });
});
