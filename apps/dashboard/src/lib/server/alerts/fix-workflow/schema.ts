// FIX workflow schema. Defines the shape of the YAML files under
// apps/dashboard/src/lib/server/alerts/rules/.
//
// Per CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md, this is the data
// model only. Evaluator semantics (which conditions trigger an
// alert) stay in TypeScript in evaluator.ts. These YAML files
// describe what to do AFTER the alert fires:
//   - prerequisites: what must be true before running the fix
//   - safe_mode: a read-only variant to confirm state first
//   - variants: the actual fix commands, distro/vendor-matched
//   - validation: how to confirm the fix worked
//   - rollback: whether/how to undo
//   - impact: blast radius + duration + irreversibility
//   - provenance: when last verified, by whom, on what
//
// The schema also carries display-meta (id, priority, title prose)
// that's static; the dynamic display fields (title with embedded
// device names, message with current values) stay in the TS
// evaluator's evaluate() function.

import { z } from "zod";

/**
 * Priority semantics in production:
 * - P0: paging-grade, escalation if not acknowledged within configured window.
 * - P1: paging-grade, no escalation default.
 * - P2: paging-grade, lower urgency. Default for "page during business hours, not at night."
 * - P3: informational / batched delivery. No paging channels (no PagerDuty, no Telegram instant).
 *   Surfaces in dashboard. May be included in daily-digest email per customer settings.
 *
 * Rule of thumb for tier selection per pattern library cross-cutting principle 1
 * (OPERATIONAL_PATTERN_LIBRARY_2026-05-18.md):
 * - Hard fault evidence: P0 or P1
 * - Capacity exhaustion imminent: P1 or P2
 * - Hygiene drift / trend warning: P3
 * - Inventory drift (firmware version, port baseline): P3 or no rule
 *
 * P0 added 2026-05-18 (RULE_AUDIT_VERDICTS_2026-05-18) for hard-fault classifiers:
 * mce_uncorrected and kernel_panic_detected.
 */
const PrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export type Priority = z.infer<typeof PrioritySchema>;

// Quick-check: the canonical "where do I start" diagnostic. One
// command (or 2-3 lines max) that gives a skilled admin/SRE a view
// of the current state of the issue. Required on every rule -
// quick_check is the default expanded view in the dashboard alert
// detail page (the full fix is a click-through). Per the 2026-05-20
// two-tier remediation UX design.
//
// Distinct from safe_mode: safe_mode is the read-only step of the
// fix workflow (often deeper, often distro-specific via variants).
// quick_check is the universal triage pointer, rule-level, same for
// every host running into this alert.
const QuickCheckSchema = z.object({
  command: z.string().min(1),
  description: z.string().min(1),
});
export type QuickCheck = z.infer<typeof QuickCheckSchema>;

// Verdict prior: a one-word, at-a-glance classification of the alert's
// remediation shape. Per the 2026-05-20 Furnace integration spec, this
// is the "static priors only, no LLM call" first step. The dashboard
// renders a coloured badge below the quick_check on each alert detail
// page so an operator immediately knows whether to dig in, escalate,
// or move on.
//
//   - "recoverable": short remediation by config change or simple
//     action; operator finishes inside a minute (e.g. ntp_not_synced,
//     no_firewall, ssh_root_password, pending_security_updates).
//   - "investigation": depends on workload and context; may be benign
//     or actionable (e.g. cpu_high, disk_space_high, listen_overflow).
//   - "vendor-side": hardware fault, vendor escalation, or out-of-band
//     coordination required; no customer-side fix (e.g. smart_failing,
//     gpu_xid_critical, ipmi_fan_failure, raid_degraded).
//
// Optional on the schema so the field can be added rule-by-rule;
// rules without it render no badge (backwards compatible).
const VerdictPriorSchema = z.enum(["recoverable", "investigation", "vendor-side"]);
export type VerdictPrior = z.infer<typeof VerdictPriorSchema>;

// Safe-mode read-only variant. Always non-destructive. Set to null
// when no read-only variant exists (rare; usually possible).
const SafeModeSchema = z
  .object({
    command: z.string().min(1),
    description: z.string().min(1),
  })
  .nullable();

// Evidence-attribute-based variant selection. Added 2026-05-17 per
// CC_FIX_WORKFLOW_SCHEMA_CONDITION_MATCH_2026-05-17.md. Lets a variant
// match against the alert's evidence (e.g. wear band, pool state) in
// addition to distro/vendor. Optional - variants without
// condition_match still work exactly as before (match any evidence).
//
// Op set is intentionally limited: regex deferred (Q1) and compound
// conditions deferred (Q2) - if a rule needs an "X AND Y" match, the
// evaluator should compute a derived categorical attribute and the
// variant matches that single attribute.
const OP_VALUES = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin"] as const;
const OpSchema = z.enum(OP_VALUES);
export type ConditionOp = z.infer<typeof OpSchema>;

const ConditionMatchSchema = z.object({
  attribute: z.string().min(1),
  op: OpSchema,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
});
export type ConditionMatch = z.infer<typeof ConditionMatchSchema>;

// One distro/vendor/condition-matched fix variant. The UI picks the
// most specific match (more non-wildcard match dimensions => higher
// specificity). Patterns support glob: `debian-*`, `debian-12`, `*`
// for wildcard. Always keep a `["*"]` fallback variant so nodes with
// unknown distro/vendor still get a fix; in addition, rules that use
// `condition_match` MUST include at least one variant WITHOUT a
// condition_match (the fallback) so missing/null evidence still
// resolves to a variant - enforced by tests (Q3).
const VariantSchema = z.object({
  distro_match: z.array(z.string()).nonempty(),
  vendor_match: z.array(z.string()).nonempty(),
  condition_match: ConditionMatchSchema.optional(),
  command: z.string().min(1),
  description: z.string().min(1),
  // suggested_action: the single non-interactive, fully-tokenized command an
  // automated agent (or a human in a hurry) can run RIGHT NOW to remediate or
  // safely advance this alert. Distinct from `command`, which may be a
  // multi-line human-oriented workflow with placeholders and interactive
  // steps. suggested_action MUST be non-interactive (no y/n prompts, no
  // editors/pagers; `apt-get -y`, `ufw --force`, redirects/drop-ins) and MUST
  // use `{{evidence}}` tokens for every device/pid/unit/serial so it resolves
  // to the real target, never an `sdN`/`<pid>` placeholder. Optional: omit for
  // judgment/physical-only alerts (drive replacement, DIMM population) where
  // no single safe command exists - the agent follows quick_check +
  // prerequisites instead. Added 2026-07-05 (agent-remediation ladder findings:
  // weak models succeed on a literal command, fail when they must compose one).
  suggested_action: z.string().min(1).optional(),
});
export type Variant = z.infer<typeof VariantSchema>;

// Validation command that confirms the fix worked. null while the
// rule still has a TODO to backfill.
const ValidationSchema = z
  .object({
    command: z.string().min(1),
    expected_exit: z.number().int().default(0),
    description: z.string().min(1),
  })
  .nullable();

// Rollback. For destructive fixes, `available: false` with a note
// explaining why (e.g. "drive replacement is not reversible").
const RollbackSchema = z.object({
  available: z.boolean(),
  command: z.string().nullable(),
  note: z.string().min(1),
});

// Impact / blast radius summary. Furnace's narration references
// this. Prose, not structured.
const ImpactSchema = z.object({
  blast_radius: z.string().min(1),
  estimated_duration: z.string().min(1),
  irreversible_steps: z.boolean(),
});

// Research-basis taxonomy. Optional on existing rules; populated for
// rules where the audit (RULE_AUDIT_VERDICTS_2026-05-18.md) marked the
// threshold or trigger as operator-validated, vendor-sourced, derived
// from research, etc. Older rule YAMLs without this field stay valid.
//
// Values:
//   - operator-pattern: validated against an operator's fleet pattern
//     library (OPERATIONAL_PATTERN_LIBRARY_2026-05-18.md).
//   - fleet-tested: validated by Glassmkr's own validation fleet.
//   - vendor-anchor: vendor or upstream project ships the threshold
//     (kill-action or triage default), not a fleet-wide alert threshold.
//   - heuristic-from-guide: single engineering guide or blog post
//     proposes the threshold without fleet validation.
//   - research-derived: derived from an external paper, datasheet, or
//     formal study.
//   - reference: drawn from a reference source (vendor manual, RFC,
//     kernel documentation) without operator or fleet validation.
//   - validation-pending: operator pattern stated but not yet
//     validated on fleet data.
const ResearchBasisSchema = z
  .enum([
    "fleet-tested",
    "vendor-anchor",
    "heuristic-from-guide",
    "operator-pattern",
    "research-derived",
    "reference",
    "validation-pending",
  ])
  .optional();
export type ResearchBasis = z.infer<typeof ResearchBasisSchema>;

// Provenance for trust. `tester` accepts any string so community
// contributions can be tagged with the contributor's name later.
const ProvenanceSchema = z.object({
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "last_verified must be ISO date YYYY-MM-DD",
  }),
  tested_on: z.array(z.string()).nonempty(),
  tester: z.string().min(1),
  source_note: z.string().min(1),
  research_basis: ResearchBasisSchema,
});

// The full FIX workflow.
const FixSchema = z.object({
  quick_check: QuickCheckSchema,
  // verdict_prior is the at-a-glance shape badge. Optional so existing
  // rules without an assignment validate; renderer treats absent as
  // "show no badge."
  verdict_prior: VerdictPriorSchema.optional(),
  prerequisites: z.array(z.string()),
  safe_mode: SafeModeSchema,
  variants: z.array(VariantSchema),
  validation: ValidationSchema,
  rollback: RollbackSchema,
  impact: ImpactSchema,
  provenance: ProvenanceSchema,
});
export type Fix = z.infer<typeof FixSchema>;

// The top-level rule metadata document. Matches the structure in
// the spec's example: `id`, `priority`, then `fix:`. The
// `rule_evaluation:` placeholder from the spec is intentionally
// omitted - evaluation logic stays in TypeScript in evaluator.ts.
//
// `title` and `summary` are short prose used as the display label
// in the alert card header. They're static (one per rule); the
// dynamic title (with embedded server name, device, current value)
// is constructed by the TS evaluator's evaluate() function.
// Incident-grouping primitive (2026-05-18, RULE_AUDIT_VERDICTS).
// A rule that fires alongside a higher-level classifier on the same
// incident can declare either:
//   - subordinate_to: <classifier_rule_id> - explicit hierarchy.
//     When the parent rule fires on the same host within the
//     correlation window, this rule's emission demotes to
//     evidence-only (no separate page).
//   - incident_group: { group_id, correlation_window_seconds }
//     - symmetric correlation. Rules sharing a group_id on the same
//     host fire as one incident if any triggers within the window.
// A rule may have either field, not both.
const IncidentGroupSchema = z.object({
  group_id: z.string().regex(/^[a-z][a-z0-9_]*$/, {
    message: "group_id must be lowercase snake_case",
  }),
  // Bounds 60-3600 per CC_SPEC_RUNTIME_SUBORDINATION_2026-05-19 §1.4.
  // Lower bound prevents same-snapshot-tick races; upper bound prevents
  // unrelated incidents an hour apart getting silently grouped.
  correlation_window_seconds: z.number().int().min(60).max(3600).default(300),
});
export type IncidentGroup = z.infer<typeof IncidentGroupSchema>;

// Cross-snapshot pre-pass declaration. Optional. When a rule's YAML
// includes this block, the alert ingest path's pre-pass loads the
// declared window of snapshots (and, if correlate_with is set, the
// matching active_alerts rows) BEFORE evaluateAlerts iterates rules.
// The rule's evaluate() function then receives the data via its
// optional ctx parameter. Rules without this block evaluate as today.
//
// Per CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §2.1 + locked
// decision 6 (pre-pass shape; sync per-rule iteration unchanged).
//
// Enum stays in sync with SnapshotColumn in
// $lib/server/cross_snapshot/types.ts.
const SnapshotColumnSchema = z.enum([
  "timestamp",
  "uptime_seconds",
  "smart",
  "disks",
  "ipmi",
  "network",
  "zfs",
  "io_latency",
  "cpu",
  "memory",
  "psi",
  "vmstat",
  "reboot_evidence",
  "hardware_raid",
  "ecc_edac",
  "security",
]);

const TimeWindowSchema = z.object({
  fromSecondsAgo: z.number().int().positive(),
  toSecondsAgo: z.number().int().nonnegative().optional(),
});

const CountWindowSchema = z.object({
  count: z.number().int().positive(),
});

const CrossSnapshotCorrelateSchema = z.object({
  rule_ids: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
  // Same bounds as IncidentGroupSchema.correlation_window_seconds; the
  // pre-pass and the runtime subordination logic share the same
  // operational time horizon.
  window_seconds: z.number().int().min(60).max(3600),
});

const CrossSnapshotSchema = z.object({
  window: z.union([TimeWindowSchema, CountWindowSchema]),
  columns: z.array(SnapshotColumnSchema).min(1),
  // Alert-side default: parsed. Rules consume typed objects, not raw
  // JSON strings. Trend-warnings (the other consumer) calls readWindow
  // directly with parsed: false; this default does not affect it.
  parsed: z.boolean().default(true),
  correlate_with: CrossSnapshotCorrelateSchema.optional(),
});
export type CrossSnapshot = z.infer<typeof CrossSnapshotSchema>;

export const RuleMetadataSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, {
      message: "id must be lowercase snake_case",
    }),
    priority: PrioritySchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    fix: FixSchema,
    // Incident-grouping fields are optional. See IncidentGroupSchema
    // comment for semantics. Validated by .refine() below to ensure
    // a rule does not declare both forms.
    subordinate_to: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, {
        message: "subordinate_to must be a lowercase snake_case rule id",
      })
      .optional(),
    incident_group: IncidentGroupSchema.optional(),
    // Cross-snapshot pre-pass declaration (Phase 2). Optional. See
    // CrossSnapshotSchema comment.
    cross_snapshot: CrossSnapshotSchema.optional(),
    // Post-incident forensic rules describe an event that already
    // completed (unexpected_reboot, OOM kills, MCE, systemd service
    // failed). By the time the alert reaches the dashboard, the host's
    // next snapshot will likely look healthy, but there is no automatic
    // "we're still seeing the problem" signal to clear the alert.
    // manual_resolve: true gates the UI on showing a "Mark resolved
    // (manual)" action that takes a required resolution note. See
    // CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md for the UX. Schema only
    // here; the UI lands in a follow-up PR. The dispatcher and
    // resolution endpoint do not need to know about this flag, the
    // alert detail page does.
    manual_resolve: z.boolean().optional(),
  })
  .refine(
    (r) => !(r.subordinate_to !== undefined && r.incident_group !== undefined),
    {
      message:
        "rule may declare either subordinate_to OR incident_group, not both",
      path: ["incident_group"],
    },
  );
export type RuleMetadata = z.infer<typeof RuleMetadataSchema>;

/**
 * Selects the most-specific matching variant for a given node's
 * distro + vendor + alert evidence. Specificity = number of
 * non-wildcard match dimensions (max 3: distro + vendor + condition).
 * Ties broken by array order (earlier wins).
 *
 * The `evidence` arg is optional - callers that don't have evidence
 * (or rules that don't use `condition_match`) work exactly as before.
 * Returns null if no variant matches (which shouldn't happen if every
 * rule has a wildcard fallback without `condition_match`).
 */
export function selectVariant(
  variants: readonly Variant[],
  node: { distro: string | null; vendor: string | null },
  evidence?: Record<string, unknown>,
): Variant | null {
  type Scored = { variant: Variant; specificity: number };
  const matches: Scored[] = [];

  for (const v of variants) {
    if (!matchAny(v.distro_match, node.distro)) continue;
    if (!matchAny(v.vendor_match, node.vendor)) continue;
    if (v.condition_match && !evaluateCondition(v.condition_match, evidence)) continue;
    // Specificity: more non-wildcard match dimensions = more specific.
    const dWild = v.distro_match.includes("*") ? 0 : 1;
    const vWild = v.vendor_match.includes("*") ? 0 : 1;
    const hasCondition = v.condition_match ? 1 : 0;
    matches.push({ variant: v, specificity: dWild + vWild + hasCondition });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.specificity - a.specificity);
  return matches[0]!.variant;
}

// NULL value handling (2026-05-17, file 02-B-minimal wiring): callers
// reading from the servers row may legitimately have NULL distro / vendor
// for hosts that haven't ingested since migration 021 landed (or for
// genuinely-unknown hardware where DMI is absent). Treat NULL as "no
// constraint on this axis" - only the `["*"]` wildcard pattern matches.
// Servers without distro info safely fall through to each rule's wildcard
// fallback variant rather than failing to match anything.
//
// Case-insensitive match (2026-05-17, same wiring): /etc/os-release
// `ID` is canonically lowercase but vendor strings from DMI are
// arbitrary-cased ("GIGABYTE", "Gigabyte Technology Co., Ltd.",
// "Super Micro Computer, Inc."). The YAML library's vendor_match
// patterns are written in mixed case (e.g. "Gigabyte-*", "ASRock-*"
// in kernel_vulnerabilities.yaml). Both sides are lowercased here so
// pattern-vs-value comparison is robust regardless of authoring case.
// Glob semantics (2026-05-18, second iteration): a `"x-*"` pattern
// now ALSO matches a bare `"x"` token, not just `"x-<suffix>"`. The
// original implementation required the dash literal, which broke two
// real-world cases observed on the validation fleet:
//
//   (a) distro tokens from older Crucible builds (<= 0.10.1) that
//       didn't emit os_version_id; Dashboard's buildDistroToken falls
//       to bare `os_id` ("debian", "ubuntu") when version is absent.
//       `"debian-*"` then needs to match `"debian"`.
//
//   (b) vendor tokens where Dashboard only persists the bare DMI
//       vendor ("gigabyte" canonical). Authors wrote
//       `["Gigabyte-*", "ASRock-*"]` expecting vendor-model pairs,
//       but the data shape is vendor-only. `"Gigabyte-*"` must
//       match `"gigabyte"`.
//
// In both cases the author intent was clearly "this vendor / distro
// family, any version / model." Requiring an explicit dash literal
// silently fell through to the wildcard fallback variant on every
// alert detail page.
function matchAny(patterns: readonly string[], value: string | null): boolean {
  if (value === null || value === undefined) {
    return patterns.includes("*");
  }
  const v = value.toLowerCase();
  for (const pat of patterns) {
    if (pat === "*") return true;
    const p = pat.toLowerCase();
    if (p === v) return true;
    if (p.endsWith("-*")) {
      const stem = p.slice(0, -2); // "debian-*" -> "debian"
      // Match "stem-anything" OR a bare "stem" token.
      if (v === stem || v.startsWith(stem + "-")) return true;
    }
  }
  return false;
}

/**
 * Evaluates a single condition_match against an evidence object.
 * Returns true only if the evidence has the named attribute AND the
 * operator yields true. Type mismatches (e.g. `gt` against a string
 * value) silently return false (Q4) - the rule's wildcard fallback
 * variant (Q3, enforced by tests) catches these cases. A console
 * warning is emitted so the mismatch is visible in journalctl.
 *
 * Exported for direct testing in __tests__/schema.test.ts.
 */
export function evaluateCondition(
  cond: ConditionMatch,
  evidence: Record<string, unknown> | undefined,
): boolean {
  if (!evidence) return false;
  const actual = evidence[cond.attribute];
  if (actual === undefined || actual === null) return false;

  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof cond.value !== "number") {
        // Type mismatch: silent skip + log per Q4.
        console.warn(
          `[fix-workflow] condition_match type mismatch on attribute "${cond.attribute}": ` +
            `op "${cond.op}" expects numeric; got actual=${typeof actual}, value=${typeof cond.value}. ` +
            `Variant excluded; fallback variant should catch this.`,
        );
        return false;
      }
      if (cond.op === "gt") return actual > cond.value;
      if (cond.op === "gte") return actual >= cond.value;
      if (cond.op === "lt") return actual < cond.value;
      return actual <= cond.value; // lte
    }
    case "in":
      if (!Array.isArray(cond.value)) {
        console.warn(
          `[fix-workflow] condition_match type mismatch on attribute "${cond.attribute}": ` +
            `op "in" expects array value; got ${typeof cond.value}.`,
        );
        return false;
      }
      return cond.value.includes(actual as never);
    case "nin":
      if (!Array.isArray(cond.value)) {
        console.warn(
          `[fix-workflow] condition_match type mismatch on attribute "${cond.attribute}": ` +
            `op "nin" expects array value; got ${typeof cond.value}.`,
        );
        return false;
      }
      return !cond.value.includes(actual as never);
  }
}
