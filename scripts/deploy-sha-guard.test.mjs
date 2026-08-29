#!/usr/bin/env node
// The same-SHA guard, exercised as a state machine.
//
// The defect this pins: deploy.sh used to read git HEAD as "the currently
// deployed revision". `git reset --hard` moves HEAD BEFORE the build, so a
// deploy that failed at build, migration or healthcheck left HEAD at the new
// SHA while production still served the old bundle. The next run compared HEAD
// against origin/main, found them equal, printed "Already at target SHA.
// Nothing to do." and exited 0.
//
// A retry after a failed deploy therefore did nothing and reported success. The
// fix is a durable marker written only after every health check passes, and
// this file drives the four transitions that matter, including the one that was
// broken.
//
// Static-reads the shipped script for the properties that cannot be simulated
// (where the marker is written), and simulates the guard for the ones that can.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "scripts/deploy.sh"), "utf8");

let failures = 0;
const ok = (m) => console.log(`[deploy-guard] ok   ${m}`);
const fail = (m) => { failures++; console.error(`[deploy-guard] FAIL ${m}`); };
const check = (cond, m) => (cond ? ok(m) : fail(m));

// --- the shipped script's structural properties -----------------------------

check(
  /DEPLOYED_FILE="\/home\/agent\/\.glassmkr-deployed-sha"/.test(SRC),
  "a durable deployed-SHA marker exists, separate from HEAD",
);

check(
  /current_sha="\$\(cat "\$DEPLOYED_FILE"/.test(SRC),
  "the guard reads the marker rather than git HEAD",
);

// The marker must be written AFTER the healthcheck loop, not before. Position
// is the property: writing it any earlier recreates the trap.
{
  const markerWrite = SRC.indexOf('echo "$new_sha" > "$DEPLOYED_FILE"');
  const healthFail = SRC.lastIndexOf("systemd-active but /api/v1/health returned");
  check(
    markerWrite > 0 && healthFail > 0 && markerWrite > healthFail,
    "the marker is written after the last healthcheck, not before the build",
  );
}

check(
  !/^current_sha="\$\(git rev-parse HEAD\)"$/m.test(SRC),
  "HEAD is no longer treated as the deployed revision",
);

check(
  /\/home\/agent\/deploy-lib\/nginx-prune\.sh/.test(SRC),
  "the staged helper is preferred, so the deployer and its helper cannot skew",
);

// --- the guard itself, as a state machine -----------------------------------

/** Mirrors the shipped condition: skip only when the MARKER equals the target. */
function shouldSkip({ marker, target }) {
  return Boolean(marker) && marker === target;
}

const CASES = [
  {
    name: "a genuine no-op: last successful deploy is already the target",
    state: { marker: "aaa", target: "aaa" },
    skip: true,
  },
  {
    name: "a normal deploy: something newer is on main",
    state: { marker: "aaa", target: "bbb" },
    skip: false,
  },
  {
    name: "THE REGRESSION: a previous run reset to bbb and then failed, so the marker is still aaa",
    // Under the old logic HEAD was bbb, the target was bbb, and this skipped
    // while production still ran aaa.
    state: { marker: "aaa", target: "bbb", head: "bbb" },
    skip: false,
  },
  {
    name: "a box that has never completed a deploy under this scheme",
    state: { marker: "", target: "bbb", head: "bbb" },
    skip: false,
  },
];

for (const c of CASES) {
  const got = shouldSkip(c.state);
  check(got === c.skip, `${c.name} -> ${c.skip ? "skip" : "deploy"}`);
}

// A deliberate demonstration that the OLD logic fails the regression case, so
// the test is not merely asserting current behaviour.
{
  const oldLogic = ({ head, target }) => head === target;
  const regression = CASES.find((c) => c.name.startsWith("THE REGRESSION"));
  check(
    oldLogic(regression.state) === true && shouldSkip(regression.state) === false,
    "the old HEAD-based guard would have skipped that case, and the new one does not",
  );
}


// --- the rollback bootstrap, run for real ---------------------------------
//
// Reported in review: on the FIRST deploy under the marker scheme there is no
// deployed marker, and the old code left $ROLLBACK_FILE untouched. It then
// either did not exist, or still held a value written by the HEAD-based logic,
// which is worse: the rollback command printed at the end would check out an
// arbitrary revision while claiming to restore the last good one.
//
// The block is EXTRACTED from the shipped script between its markers and run
// with stub `curl` and `git`, so this exercises the deployed text rather than a
// copy of it.
import { execFileSync } from "node:child_process";
import os from "node:os";

{
  const src = SRC.split("# --- rollback-bootstrap:begin ---")[1]?.split("# --- rollback-bootstrap:end ---")[0];
  check(Boolean(src), "the rollback bootstrap block is delimited for extraction");

  /**
   * Run the real block with a stubbed service and git.
   * `served` is what /api/v1/version reports; null means no answer at all.
   */
  const runBootstrap = ({ marker, served, known = true, stale = null, override = false, rollbackSha = null }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-rollback-"));
    const rollbackFile = path.join(dir, "rollback");
    if (stale !== null) fs.writeFileSync(rollbackFile, stale);
    const harness = [
      "set -uo pipefail",
      override ? "ALLOW_NO_ROLLBACK=1" : "ALLOW_NO_ROLLBACK=0",
      rollbackSha === null ? "" : `ROLLBACK_SHA=${JSON.stringify(rollbackSha)}`,
      `ROLLBACK_FILE=${JSON.stringify(rollbackFile)}`,
      `current_sha=${JSON.stringify(marker ?? "")}`,
      // Stubs. curl answers as the running dashboard would; git decides whether
      // the revision is an object this repository actually knows.
      served === null
        ? "curl() { return 7; }"
        : `curl() { printf '%s' '{"dashboard":{"version":"1.0.0","git_sha":"${served}"}}'; }`,
      `git() { [ "$1" = "cat-file" ] && return ${known ? 0 : 1}; return 0; }`,
      src,
      'echo "ROLLBACK_FILE_CONTENT=$(cat ' + JSON.stringify(rollbackFile) + ' 2>/dev/null || echo NONE)"',
    ].join("\n");
    let out = "";
    let code = 0;
    try {
      out = execFileSync("bash", ["-c", harness], { encoding: "utf8" });
    } catch (e) {
      out = String(e.stdout ?? "");
      code = e.status ?? 1;
    }
    const recorded = fs.existsSync(rollbackFile) ? fs.readFileSync(rollbackFile, "utf8").trim() : "NONE";
    fs.rmSync(dir, { recursive: true, force: true });
    return { out, code, recorded };
  };

  const GOOD = "a".repeat(39) + "1";
  const OLD = "b".repeat(39) + "2";

  // 1. Normal case: the marker exists and is the rollback target.
  check(runBootstrap({ marker: OLD, served: GOOD }).recorded === OLD,
    "with a deployed marker present, the marker is the rollback target");

  // 2. THE REPORTED GAP: no marker, so bootstrap from what is actually serving.
  {
    const r = runBootstrap({ marker: null, served: GOOD });
    check(r.recorded === GOOD, "with no marker, the rollback target is bootstrapped from the running service");
    check(/from the running service/.test(r.out), "and the run names where the target came from");
  }

  // 3. THE FAIL-OPEN. The service does not answer, so there is no rollback
  //    target. The deploy must ABORT, not continue with a warning: the success
  //    message would otherwise print `$0 $(cat <missing>)`, which expands to a
  //    bare `$0` and deploys origin/main. A rollback command that deploys
  //    forward is worse than no rollback command.
  {
    const r = runBootstrap({ marker: null, served: null, stale: OLD });
    check(r.code !== 0, "an unreachable service ABORTS the first marker deploy rather than continuing");
    check(r.recorded === "NONE", "and the stale rollback file is removed rather than left to mislead");
    // The forward-deploy warning lives in the SUCCESS message, which is where an
    // operator reads it; the abort path simply refuses to proceed.
    check(/deploys origin\/main, which is forward, not back/.test(SRC),
      "the success message warns that a bare re-run deploys forward rather than back");
  }

  // 4. A malformed answer is not accepted as a revision, and also aborts.
  for (const [served, label] of [["unknown", 'a git_sha of "unknown"'], ["abc123", "a short or malformed SHA"]]) {
    const r = runBootstrap({ marker: null, served, stale: OLD });
    check(r.recorded === "NONE" && r.code !== 0, `${label} is refused and aborts`);
  }

  // 5. A well-formed SHA this repository does not have is refused too: rolling
  //    back to an object git cannot check out is not a rollback target.
  {
    const r = runBootstrap({ marker: null, served: GOOD, known: false, stale: OLD });
    check(r.recorded === "NONE" && r.code !== 0, "a revision unknown to the repository is refused and aborts");
  }

  // --- THE PRINTED RECOVERY COMMAND MUST ACTUALLY RECOVER --------------------
  //
  // The previous version printed an instruction to write the rollback file by
  // hand and re-run with the override. On that re-run the probe failed again,
  // the script deleted the file BEFORE reading the override, and continued with
  // no target: the recovery instruction destroyed the thing it asked for.
  {
    // Exactly what the failure message now tells an operator to run, with the
    // service still down so the probe cannot rescue it.
    const r = runBootstrap({ marker: null, served: null, rollbackSha: GOOD });
    check(r.code === 0, "the printed ROLLBACK_SHA recovery command succeeds with the service still down");
    check(r.recorded === GOOD, "and the operator's target SURVIVES into the rollback file");
    check(/supplied by the operator/.test(r.out), "and the run says where the target came from");
  }

  // A supplied target must be validated, not taken on faith.
  for (const [sha, label] of [["abc123", "a short SHA"], ["z".repeat(40), "a non-hex SHA"]]) {
    const r = runBootstrap({ marker: null, served: null, rollbackSha: sha });
    check(r.code !== 0, `ROLLBACK_SHA rejects ${label}`);
  }
  {
    const r = runBootstrap({ marker: null, served: null, rollbackSha: GOOD, known: false });
    check(r.code !== 0, "ROLLBACK_SHA rejects a revision this checkout does not contain");
  }

  // The marker still wins: a stale operator value cannot override a real
  // deployed revision.
  {
    const r = runBootstrap({ marker: OLD, served: GOOD, rollbackSha: "f".repeat(40) });
    check(r.recorded === OLD, "the deployed marker takes precedence over ROLLBACK_SHA");
  }

  // And a validated operator target is never deleted.
  {
    const r = runBootstrap({ marker: null, served: null, rollbackSha: GOOD, stale: OLD });
    check(r.recorded === GOOD, "a validated operator target replaces a stale file rather than being deleted with it");
  }

  // 6. The explicit human override, and only that, allows it to continue.
  {
    const r = runBootstrap({ marker: null, served: null, override: true });
    check(r.code === 0, "ALLOW_NO_ROLLBACK=1 lets a human proceed deliberately");
    check(/continuing without a verified rollback target/.test(r.out), "and says so");
  }
}

// The success message must not print a rollback command whose argument can
// vanish. `$0 $(cat <missing>)` becomes a bare `$0`, and deploy.sh defaults its
// target to origin/main, so the documented rollback deploys forward.
check(
  !/To roll back:  \$0 \\\$\(cat/.test(SRC),
  "the success message never prints a rollback command built from an unchecked file read",
);
check(
  /NO ROLLBACK TARGET is recorded, so no rollback command is printed/.test(SRC),
  "and it says plainly when there is no rollback target instead of printing an empty one",
);

if (failures) {
  console.error(`[deploy-guard] ${failures} failing check(s)`);
  process.exit(1);
}
console.log("[deploy-guard] all deploy SHA-guard checks pass");
