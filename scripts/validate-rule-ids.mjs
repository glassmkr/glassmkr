#!/usr/bin/env node
//
// Validate that the rule ID manifest at RULES.json agrees with both:
//   1. The Dashboard server-side evaluator at apps/dashboard/src/lib/server/alerts/evaluator.ts
//   2. The Crucible collector's rule list (rule-ids.json: from a sibling
//      checkout at ../collector/rule-ids.json, or from node_modules once
//      @glassmkr/crucible >= 0.8.0 is added as a devDependency).
//
// Run: `pnpm validate:rules` (root package.json script).
// Exits non-zero if any drift is detected. Prints every drift case.
//
// Maintenance discipline: when you add or remove a rule, update RULES.json
// first, then update either the collector (src/alerts/rules.ts +
// rule-ids.json) or Dashboard (evaluator.ts). CI catches mismatches.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/**
 * Load and schema-check RULES.json. Returns parsed manifest or exits 1
 * on structural errors. The drift comparison only makes sense if the
 * manifest itself is well-formed, so we validate it first.
 */
function loadManifest() {
  const raw = readFileSync(resolve(repoRoot, "RULES.json"), "utf-8");
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.error(`RULES.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const schemaErrors = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    schemaErrors.push("Top-level value must be an object.");
  } else {
    if (!Array.isArray(parsed.rules)) {
      schemaErrors.push("Field 'rules' must be an array.");
    } else {
      const seenIds = new Map(); // id -> first index
      const validSides = new Set(["collector", "dashboard", "both"]);
      for (let i = 0; i < parsed.rules.length; i++) {
        const e = parsed.rules[i];
        const where = `rules[${i}]`;
        if (!e || typeof e !== "object" || Array.isArray(e)) {
          schemaErrors.push(`${where}: must be an object`);
          continue;
        }
        if (typeof e.id !== "string" || e.id.length === 0) {
          schemaErrors.push(`${where}: 'id' must be a non-empty string`);
          continue;
        }
        if (!/^[a-z][a-z0-9_]*$/.test(e.id)) {
          schemaErrors.push(`${where} (id='${e.id}'): id must be lower_snake_case starting with a letter`);
        }
        if (!validSides.has(e.side)) {
          schemaErrors.push(`${where} (id='${e.id}'): 'side' must be one of collector|dashboard|both, got ${JSON.stringify(e.side)}`);
        }
        if (seenIds.has(e.id)) {
          schemaErrors.push(`${where} (id='${e.id}'): duplicate id, also at rules[${seenIds.get(e.id)}]`);
        } else {
          seenIds.set(e.id, i);
        }
        if (e.notes !== undefined && typeof e.notes !== "string") {
          schemaErrors.push(`${where} (id='${e.id}'): 'notes' must be a string when present`);
        }
      }
    }
  }

  if (schemaErrors.length > 0) {
    console.error("RULES.json schema errors:");
    for (const e of schemaErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  return parsed;
}

/**
 * Extract rule IDs from the Dashboard sources by regex on the source files.
 * Avoids the cost of compiling and loading the TS module just to enumerate.
 *
 * Two sources, both server-side:
 *   - apps/dashboard/src/lib/server/alerts/evaluator.ts (snapshot-driven rules):
 *     `type: "<id>",`
 *   - apps/dashboard/src/lib/server/watchdog.ts (cross-snapshot rules):
 *     `alert_type: "<id>",` and `'<id>'` SQL literals
 *
 * The Phase 1 audit only scanned the evaluator and missed the watchdog,
 * which is why server_unreachable was absent from the original manifest.
 * Both sources are now checked.
 */
function loadForgeRuleIds() {
  const ids = new Set();

  const evaluatorPath = resolve(repoRoot, "apps/dashboard/src/lib/server/alerts/evaluator.ts");
  const evaluatorRaw = readFileSync(evaluatorPath, "utf-8");
  const evaluatorRe = /^\s*type:\s*["']([a-z_][a-z0-9_]*)["']/gm;
  let m;
  while ((m = evaluatorRe.exec(evaluatorRaw)) !== null) ids.add(m[1]);

  const watchdogPath = resolve(repoRoot, "apps/dashboard/src/lib/server/watchdog.ts");
  if (existsSync(watchdogPath)) {
    const watchdogRaw = readFileSync(watchdogPath, "utf-8");
    // Match `alert_type: "<id>"` (object literal in the dispatched payload)
    // and `'<id>'` adjacent to alert_type SQL filter (`alert_type = '<id>'`).
    const watchdogRe = /alert_type[:\s=]+["']([a-z_][a-z0-9_]*)["']/g;
    while ((m = watchdogRe.exec(watchdogRaw)) !== null) ids.add(m[1]);
  }

  return ids;
}

function loadCollectorRuleIds() {
  const candidates = [
    resolve(repoRoot, "..", "collector", "rule-ids.json"),
    resolve(repoRoot, "node_modules", "@glassmkr", "crucible", "rule-ids.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf-8");
    const obj = JSON.parse(raw);
    return new Set(obj.rule_ids);
  }
  return null;
}

/**
 * Parse every rule YAML, exactly as the fix-workflow loader does at boot.
 *
 * WHY THIS IS HERE. `loader.ts` eagerly parses all of ../rules/*.yaml at module
 * load and throws on the first malformed file, so a bad rule takes the dashboard
 * down at import. This validator never opened those files, which meant
 * `pnpm validate:rules` reported OK on a rule that could not be loaded at all: an
 * unquoted `summary: cause: effect` passes here and fails 21 test files with a
 * YAMLParseError. Exactly that mistake has been made twice on this repo, both times
 * caught by the test suite rather than by the gate whose name implies it checks
 * rules. Adversarial review round 4, finding #8.
 */
async function checkRuleYamlParses(errors) {
  const dir = resolve(here, "..", "apps/dashboard/src/lib/server/alerts/rules");
  if (!existsSync(dir)) return 0;
  // `yaml` is a dashboard dependency and pnpm does not hoist it to the root, so
  // resolve it from that workspace. If it cannot be resolved we ERROR rather than
  // skip: a check that quietly does nothing is precisely the defect being fixed.
  let parseYaml;
  try {
    const requireFromDashboard = createRequire(resolve(here, "..", "apps/dashboard/package.json"));
    parseYaml = requireFromDashboard("yaml").parse;
  } catch (err) {
    errors.push(`Could not load the yaml parser to validate rule files (run pnpm install): ${String(err && err.message ? err.message : err).split("\n")[0]}`);
    return 0;
  }
  // Load the PRODUCTION schema rather than re-describing it here. Parsing the YAML
  // proves only that it is syntactically valid; the fix-workflow loader additionally
  // runs RuleMetadataSchema.safeParse and throws at import when that fails, so a
  // syntactically fine but schema-invalid rule (`priority: P9`) still crashed the
  // dashboard at boot while this gate reported OK. Round 4's finding #8 fixed half of
  // this; round 5's #4 is the other half. A second copy of the schema here would
  // reintroduce the same class of bug the moment the two drift, so import the real
  // one through vite, which can load the TypeScript module.
  const schemaPath = resolve(here, "..", "apps/dashboard/src/lib/server/alerts/fix-workflow/schema.ts");
  let RuleMetadataSchema = null;
  let vite = null;
  try {
    // pnpm does not hoist vite to the root any more than it hoists yaml, so resolve
    // it from the dashboard workspace and import it by file URL.
    const requireFromDashboard2 = createRequire(resolve(here, "..", "apps/dashboard/package.json"));
    const { createServer } = await import(pathToFileURL(requireFromDashboard2.resolve("vite")).href);
    vite = await createServer({
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true },
      appType: "custom",
    });
    ({ RuleMetadataSchema } = await vite.ssrLoadModule(schemaPath));
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).split("\n")[0];
    errors.push(`Could not load the production RuleMetadataSchema, so rules cannot be schema-checked (run pnpm install): ${msg}`);
  } finally {
    if (vite) await vite.close();
  }

  const files = readdirSync(dir).filter(f => f.endsWith(".yaml"));
  for (const f of files) {
    const full = resolve(dir, f);
    let parsed;
    try {
      parsed = parseYaml(readFileSync(full, "utf-8"));
    } catch (err) {
      const msg = String(err && err.message ? err.message : err).split("\n")[0];
      errors.push(`Rule YAML ${f} is malformed, so the dashboard would fail to boot: ${msg}`);
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      errors.push(`Rule YAML ${f} did not parse to an object (the fix-workflow loader would throw at boot)`);
      continue;
    }
    if (!RuleMetadataSchema) continue;
    const result = RuleMetadataSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      errors.push(`Rule YAML ${f} fails the production schema, so the dashboard would fail to boot: ${issues}`);
    }
  }
  return files.length;
}

async function main() {
  const manifest = loadManifest();
  const forgeIds = loadForgeRuleIds();
  const collectorIds = loadCollectorRuleIds();
  const errors = [];
  const warnings = [];

  const yamlCount = await checkRuleYamlParses(errors);

  const manifestById = new Map(manifest.rules.map(e => [e.id, e]));
  const expectedCollector = new Set(manifest.rules.filter(e => e.side === "collector" || e.side === "both").map(e => e.id));
  const expectedForge = new Set(manifest.rules.filter(e => e.side === "dashboard" || e.side === "both").map(e => e.id));

  // ---- Dashboard cross-check (always runs) ----
  for (const id of forgeIds) {
    if (!manifestById.has(id)) {
      errors.push(`Dashboard evaluator emits '${id}' but RULES.json does not list it`);
      continue;
    }
    const entry = manifestById.get(id);
    if (entry.side === "collector") {
      errors.push(`Dashboard evaluator emits '${id}' but RULES.json marks it collector-only`);
    }
  }
  for (const id of expectedForge) {
    if (!forgeIds.has(id)) {
      errors.push(`RULES.json expects Dashboard to evaluate '${id}' but evaluator.ts does not`);
    }
  }

  // ---- Collector cross-check (only if rule-ids.json is available) ----
  if (collectorIds) {
    for (const id of collectorIds) {
      if (!manifestById.has(id)) {
        errors.push(`Collector emits '${id}' but RULES.json does not list it`);
        continue;
      }
      const entry = manifestById.get(id);
      if (entry.side === "dashboard") {
        errors.push(`Collector emits '${id}' but RULES.json marks it Dashboard-only`);
      }
    }
    for (const id of expectedCollector) {
      if (!collectorIds.has(id)) {
        errors.push(`RULES.json expects collector to evaluate '${id}' but rule-ids.json does not list it`);
      }
    }
  } else {
    warnings.push(
      "Crucible rule-ids.json not found at sibling ../collector/rule-ids.json or in node_modules. " +
      "Collector cross-check skipped. To enable: clone glassmkr/crucible alongside this repo, " +
      "or add @glassmkr/crucible as a devDependency once 0.8.0 is published."
    );
  }

  if (warnings.length > 0) {
    console.warn("Warnings:");
    for (const w of warnings) console.warn(`  - ${w}`);
    console.warn();
  }

  if (errors.length > 0) {
    console.error("Rule ID drift detected:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error();
    console.error(`Manifest: ${manifest.rules.length} rules`);
    console.error(`Dashboard: ${forgeIds.size} unique IDs in evaluator.ts`);
    if (collectorIds) console.error(`Collector: ${collectorIds.size} unique IDs in rule-ids.json`);
    process.exit(1);
  }

  console.log(`OK: ${manifest.rules.length} manifest entries, ${forgeIds.size} Dashboard IDs${collectorIds ? `, ${collectorIds.size} collector IDs` : ""}, ${yamlCount} rule YAML file(s) parse.`);
}

main();
