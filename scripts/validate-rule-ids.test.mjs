#!/usr/bin/env node
//
// Known-bad fixture for the rule gate, per the standing rule that every CI gate
// ships with a fixture proving it FAILS on a real-world defect. Without this the
// gate only ever demonstrates that today's clean corpus is clean, which is how
// both halves of this particular gate shipped broken.
//
// Two defects are reproduced, one per review round:
//   round 4 #8 - YAML that does not parse at all
//   round 5 #4 - YAML that parses but violates the production schema
//                (`priority: P9`), which passed the gate while the fix-workflow
//                loader threw `Invalid enum value` at dashboard boot.
//
// Runs the real gate as a subprocess against a temporarily corrupted copy of a
// real rule file, then restores it. The original bytes are captured up front and
// rewritten in a finally block, so an assertion failure cannot leave the working
// tree dirty.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gate = resolve(here, "validate-rule-ids.mjs");
const victim = resolve(
  here,
  "..",
  "apps/dashboard/src/lib/server/alerts/rules/psu_redundancy_loss.yaml",
);

let pass = 0;
let fail = 0;

function runGate() {
  try {
    execFileSync(process.execPath, [gate], { stdio: "pipe" });
    return { exitCode: 0, output: "" };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

function check(label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`);
  }
}

const pristine = readFileSync(victim, "utf-8");

try {
  // --- baseline: the real corpus must pass, or nothing below means anything ---
  const clean = runGate();
  check("clean corpus passes", clean.exitCode === 0, `exit=${clean.exitCode} ${clean.output.slice(0, 300)}`);

  // --- round 5 #4: parses as YAML, violates the production schema ------------
  if (!/^priority:\s*P\d\s*$/m.test(pristine)) {
    fail++;
    console.error("FAIL: fixture assumption broken, no `priority: Pn` line in psu_redundancy_loss.yaml");
  } else {
    writeFileSync(victim, pristine.replace(/^priority:\s*P\d\s*$/m, "priority: P9"));
    const bad = runGate();
    check(
      "schema-invalid rule (priority: P9) is REJECTED",
      bad.exitCode !== 0,
      `gate exited 0; a rule the dashboard cannot load would ship. output: ${bad.output.slice(0, 300)}`,
    );
    check(
      "rejection names the production schema",
      /fails the production schema/.test(bad.output),
      `output did not mention the schema: ${bad.output.slice(0, 300)}`,
    );
    writeFileSync(victim, pristine);
  }

  // --- round 4 #8: does not parse as YAML at all -----------------------------
  // An unquoted `key: value` inside a scalar, the exact shape that broke 21 test
  // files on 2026-07-31.
  writeFileSync(victim, `${pristine}\nbroken: cause: effect\n`);
  const malformed = runGate();
  check(
    "malformed YAML is REJECTED",
    malformed.exitCode !== 0,
    `gate exited 0 on YAML the loader cannot parse. output: ${malformed.output.slice(0, 300)}`,
  );
  writeFileSync(victim, pristine);
} finally {
  // Restore unconditionally: a thrown assertion must not leave the repo dirty.
  writeFileSync(victim, pristine);
}

const restored = readFileSync(victim, "utf-8");
check("fixture file restored byte-for-byte", restored === pristine);

console.log(`[validate:rules:test] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
