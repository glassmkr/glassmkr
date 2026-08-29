#!/usr/bin/env node
// Verifies the evidence-exhibit manifest (redesign spec section 7.4): every
// entry is complete, its artifact exists, and the recorded hash still matches
// the file. An exhibit that has drifted from the data it claims to show is
// worse than no exhibit, because the provenance line then asserts something
// false.
//
// Run from the monorepo root:
//   node scripts/check-exhibits.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "apps/site/src/lib/data/exhibits/manifest.yaml");
const req = createRequire(path.join(ROOT, "apps/site/package.json"));

const REQUIRED = [
  "id", "captured_at", "host_alias", "scenario_id", "crucible_version",
  "dashboard_commit", "source_environment", "viewport", "artifact_path",
  "sha256",
];

let failures = 0;
// Classified but unresolved. Distinct from a failure: nothing here is broken,
// but the run is not a clean pass either.
let incomplete = 0;
const fail = (msg) => { failures++; console.error(`[exhibits] FAIL ${msg}`); };
const ok = (msg) => console.log(`[exhibits] ok   ${msg}`);

if (!fs.existsSync(MANIFEST)) {
  // The manifest is committed, so "missing" means deleted, moved, or a broken
  // path, never a young repo. Treating absence as a pass let an accidental
  // deletion conceal every exhibit drift this gate blocks (Codex 2026-08-29
  // #11). Exit 2: nothing verified, a person must look.
  console.error(`[exhibits] INCOMPLETE: manifest not found at ${MANIFEST}; nothing was verified`);
  process.exit(2);
}

const yaml = req("yaml");
const doc = yaml.parse(fs.readFileSync(MANIFEST, "utf8"));
const entries = doc?.exhibits ?? [];

if (!entries.length) {
  fail("manifest parses but declares no exhibits");
}

for (const e of entries) {
  const id = e?.id ?? "(unnamed)";
  const missing = REQUIRED.filter((k) => e?.[k] === undefined || e[k] === null || e[k] === "");
  if (missing.length) {
    fail(`${id}: missing required field(s): ${missing.join(", ")}`);
    continue;
  }
  const artifact = path.join(ROOT, e.artifact_path);
  if (!fs.existsSync(artifact)) {
    fail(`${id}: artifact_path does not exist: ${e.artifact_path}`);
    continue;
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
  if (actual !== e.sha256) {
    fail(`${id}: sha256 mismatch. manifest says ${e.sha256.slice(0, 16)}..., file is ${actual.slice(0, 16)}...`);
    continue;
  }
  // A provenance line that names a Crucible version nobody released, or a
  // placeholder host, is exactly the kind of thing that ships unnoticed.
  if (/^(TBD|TODO|placeholder|example)/i.test(String(e.host_alias))) {
    fail(`${id}: host_alias looks like a placeholder: ${e.host_alias}`);
    continue;
  }
  ok(`${id}: complete, artifact present, hash matches`);
}

// --- Every public image asset must be classified -----------------------------
//
// The manifest proved that DECLARED exhibits are genuine. It said nothing about
// undeclared ones, so three hand-composed renders sat in the public static
// directory, served from glassmkr.com, and were embedded in the Crucible README
// as product screenshots. Their alert evidence, remediation commands, drive
// models and SMART values are written into the components; no host produced
// them. That is the exact thing the evidence rule exists to prevent, and the
// gate could not see it because it only looked at what the manifest listed.
//
// So the inventory is now closed: every file under static/screenshots must be
// manifested evidence or an explicitly classified illustration.
{
  const SHOTS = path.join(ROOT, "apps/site/static/screenshots");
  const ILLUS = path.join(ROOT, "apps/site/src/lib/data/exhibits/illustrations.yaml");

  const walk = (dir, base = "") => {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
      else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(e.name)) out.push(rel);
    }
    return out;
  };

  const assets = walk(SHOTS).map((r) => `static/screenshots/${r}`);
  const evidence = new Set(entries.map((e) => String(e.artifact_path ?? "").replace(/^apps\/site\//, "")));
  const illus = fs.existsSync(ILLUS) ? (yaml.parse(fs.readFileSync(ILLUS, "utf8"))?.illustrations ?? []) : [];
  const illustrated = new Map(illus.map((i) => [String(i.path), i]));

  const unclassified = assets.filter((a) => !evidence.has(a) && !illustrated.has(a));
  const missingFiles = [...illustrated.keys()].filter((p2) => !fs.existsSync(path.join(ROOT, "apps/site", p2)));

  if (unclassified.length) {
    fail(
      `${unclassified.length} public image asset(s) are neither manifested evidence nor classified illustrations:\n  ` +
      unclassified.join("\n  ") +
      "\n  Add each to exhibits/manifest.yaml with provenance, or to " +
      "exhibits/illustrations.yaml saying what it is and where it is labelled.",
    );
  } else if (assets.length) {
    ok(`all ${assets.length} public image asset(s) classified (${assets.length - illustrated.size} evidence, ${illustrated.size} illustration)`);
  }

  if (missingFiles.length) {
    fail(`illustrations.yaml lists ${missingFiles.length} file(s) that do not exist: ${missingFiles.join(", ")}`);
  }

  // An illustration nobody has labelled is an open item. Reported, not failed:
  // the asset is classified, and where it gets its caption is a separate change
  // in a separate repository.
  // An illustration displayed publicly with no label is an OPEN item, and the
  // run must not exit 0 while one exists. Reporting it and then exiting
  // successfully is how "the gate classifies the assets" turns into "the gate
  // passes", which is the same fail-open shape this repository has now fixed in
  // three separate scripts.
  //
  // Exit 2 rather than 1 because the fix is a caption in a DIFFERENT repository
  // (the Crucible README). Failing this repo's CI red for that would be wrong;
  // reporting a clean pass would be worse. 2 means: nothing is broken here,
  // something is unresolved, a person must look.
  const unlabelled = illus.filter((i) => !(i.labelled_at ?? []).length && (i.used_by ?? []).length);
  if (unlabelled.length) {
    incomplete += unlabelled.length;
    console.error(
      `[exhibits] OPEN ${unlabelled.length} illustration(s) are displayed publicly with no illustrative label:\n  ` +
      unlabelled.map((i) => `${i.path} -> ${(i.used_by ?? []).join("; ")}`).join("\n  ") +
      "\n  Each is invented output presented as a product screenshot. Add a visible" +
      "\n  caption where it is displayed, then record that location in labelled_at.",
    );
  }
  const orphans = illus.filter((i) => !(i.used_by ?? []).length);
  if (orphans.length) {
    incomplete += orphans.length;
    console.error(`[exhibits] OPEN ${orphans.length} published illustration(s) are referenced by nothing; remove them or adopt them.`);
  }
}


if (failures) {
  console.error(`[exhibits] ${failures} failure(s)`);
  process.exit(1);
}
if (incomplete) {
  console.error(`[exhibits] INCOMPLETE: ${incomplete} classified item(s) are unresolved. Exit 2 = a person must act; this run is not a pass.`);
  process.exit(2);
}
console.log("[exhibits] all checks passed");
