// Loads + validates all rule YAML files at module load. The result
// is a frozen Map<rule_type, RuleMetadata> consumed by the alert
// renderer when constructing the user-visible alert card.
//
// Strategy: use Vite's import.meta.glob to bundle every YAML file
// under ../rules/ at build time as raw strings, then parse + Zod-
// validate once at module load. A malformed YAML or schema-invalid
// rule throws synchronously here - server fails to boot, which is
// the right failure mode for a corrupt rule library (better than
// a runtime null-deref deep in the alert render path).

import { parse as parseYaml } from "yaml";
import { RuleMetadataSchema, type RuleMetadata } from "./schema.js";

// Vite glob: every *.yaml file in ../rules/, eagerly imported as
// raw text. Keys are the relative paths (e.g. "../rules/raid_degraded.yaml");
// values are the file contents.
const yamlFiles = import.meta.glob("../rules/*.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function loadRules(): ReadonlyMap<string, RuleMetadata> {
  const out = new Map<string, RuleMetadata>();
  for (const [path, raw] of Object.entries(yamlFiles)) {
    const filename = path.split("/").pop() ?? path;
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        `[fix-workflow] YAML parse failed for ${filename}: ${(err as Error).message}`,
      );
    }
    const result = RuleMetadataSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("\n");
      throw new Error(
        `[fix-workflow] Schema validation failed for ${filename}:\n${issues}`,
      );
    }
    if (out.has(result.data.id)) {
      throw new Error(
        `[fix-workflow] Duplicate rule id "${result.data.id}" in ${filename}`,
      );
    }
    out.set(result.data.id, result.data);
  }

  // Cross-rule validation (CC_SPEC_RUNTIME_SUBORDINATION_2026-05-19 §1.1-1.2):
  // each rule's subordinate_to must reference an id that exists, AND the
  // subordination graph must not contain cycles. Boot fails on either.
  // Forward-references (parent rule shipped in a follow-up PR not yet on
  // main) are intentionally allowed: a YAML can declare `subordinate_to:
  // <future_rule>` and the runtime simply never finds the parent in
  // active_alerts, so the rule emits independently. This matches the
  // PR #157 pattern where several rules pre-declare subordination to
  // cpu_pressure_high (which ships in C1-C6) and kernel_panic_detected
  // (which ships in C4). The "id must exist" check is therefore a
  // future-pointing convention but not strictly enforced here - only
  // cycle detection is critical, because a cycle would create an
  // infinite-loop hazard the moment runtime subordination tries to
  // resolve it.
  detectSubordinationCycles(out);

  return out;
}

/**
 * Detects cycles in the subordinate_to graph. A rule that subordinates
 * to itself (directly or transitively) would cause infinite recursion
 * when the runtime subordination logic tries to find the "ultimate
 * parent." Boot fails with the cycle path so the offending YAML can
 * be fixed before deploy.
 *
 * Forward-references (parent rule_id doesn't exist in the loaded set)
 * are NOT errors here - see comment in loadRules() for rationale.
 */
export function detectSubordinationCycles(
  registry: ReadonlyMap<string, RuleMetadata>,
): void {
  // Standard DFS cycle detection over a directed graph where each rule
  // points to its parent via subordinate_to. WHITE = unvisited,
  // GREY = in current DFS path, BLACK = fully explored.
  enum Mark {
    White = 0,
    Grey = 1,
    Black = 2,
  }
  const mark = new Map<string, Mark>();
  for (const id of registry.keys()) mark.set(id, Mark.White);

  function visit(id: string, path: string[]): void {
    const rule = registry.get(id);
    if (!rule || !rule.subordinate_to) {
      mark.set(id, Mark.Black);
      return;
    }
    const parent = rule.subordinate_to;
    if (!registry.has(parent)) {
      // Forward-reference; not an error. The parent will come in a
      // later PR; runtime simply won't find it in active_alerts and
      // the child rule emits independently.
      mark.set(id, Mark.Black);
      return;
    }
    const parentMark = mark.get(parent);
    if (parentMark === Mark.Grey) {
      // Cycle found. Path so far + parent closes the loop.
      const cyclePath = [...path, id, parent].join(" -> ");
      throw new Error(
        `[fix-workflow] subordination cycle detected: ${cyclePath}`,
      );
    }
    if (parentMark === Mark.Black) {
      // Already fully explored; safe to skip.
      mark.set(id, Mark.Black);
      return;
    }
    mark.set(parent, Mark.Grey);
    visit(parent, [...path, id]);
    mark.set(id, Mark.Black);
  }

  for (const id of registry.keys()) {
    if (mark.get(id) === Mark.White) {
      mark.set(id, Mark.Grey);
      visit(id, []);
    }
  }
}

/**
 * Frozen registry of rule metadata keyed by rule type (matches
 * AlertRule.type in evaluator.ts). Lookup is O(1) and the result
 * is the validated, typed RuleMetadata object.
 */
export const ruleRegistry: ReadonlyMap<string, RuleMetadata> = loadRules();

/**
 * Returns the FIX workflow metadata for a given rule type, or
 * undefined if no YAML exists for it yet. The alert renderer
 * should tolerate undefined during the migration window so a
 * not-yet-migrated rule still renders (without FIX guidance).
 */
export function getRuleMetadata(ruleType: string): RuleMetadata | undefined {
  return ruleRegistry.get(ruleType);
}

/**
 * Returns the rule types that have YAML metadata. Used by tests
 * + the field-population summary CLI to track coverage against the
 * evaluator's registered rules.
 */
export function listMetadataRuleTypes(): readonly string[] {
  return Array.from(ruleRegistry.keys()).sort();
}
