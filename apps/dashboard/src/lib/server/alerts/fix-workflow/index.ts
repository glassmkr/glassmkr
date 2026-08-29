// Public barrel for the FIX workflow data model.
//
// Imports under `$lib/server/alerts/fix-workflow` get:
//   - The Zod-validated rule registry (one entry per YAML file)
//   - Lookup + listing helpers
//   - The schema types for downstream typing (alert renderer, etc.)
//
// Per CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md the alert renderer
// in the file 02-B UI redesign calls getRuleMetadata(alert.type)
// to fetch the FIX workflow that goes into the redesigned alert
// card. The evaluator stays TS and isn't touched.

export { getRuleMetadata, listMetadataRuleTypes, ruleRegistry } from "./loader.js";
export { selectVariant, evaluateCondition } from "./schema.js";
export { resolveFix } from "./resolve.js";
export type { ResolvedFix, ServerLocator } from "./resolve.js";
export type {
  RuleMetadata,
  Variant,
  Priority,
  Fix,
  ConditionMatch,
  ConditionOp,
} from "./schema.js";

// Re-export the RuleMetadataSchema for tooling (e.g. scripts that
// pre-validate before commit). Most app code uses ruleRegistry
// instead since it's already validated.
export { RuleMetadataSchema } from "./schema.js";
