// FIX-workflow resolver. Bridges the alert row (alert_type + evidence
// + the server's persisted distro/vendor metadata) to the deepened
// YAML library's structured FIX workflow.
//
// Per CC_SPEC_02B_MINIMAL_WIRING_2026-05-17.md, this is the missing
// Phase 3 piece of CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md - the
// YAML library was shipped 2026-05-17 (38/38 rules deepened) but the
// alert card was still rendering legacy FIX_COMMANDS table content.
// This resolver makes the YAML library actually user-visible.
//
// Resolution timing: at FETCH time (called from the alerts GET endpoint),
// not at ingest time. The YAML library is the source of truth; library
// changes propagate to all rendered alerts immediately without re-bake.

import { getRuleMetadata } from "./loader.js";
import { selectVariant } from "./schema.js";
import type { Fix } from "./schema.js";
import { normalizeVendor } from "$lib/utils/vendor.js";

/** Server fields needed for variant selection. Columns persisted on
 *  the `servers` row via migration 021 + the pre-existing dmi_vendor
 *  column from migration 012. */
export interface ServerLocator {
  os_id: string | null;
  os_id_like: string | null;
  os_version_id: string | null;
  dmi_vendor: string | null;
}

/** The structured FIX content attached to each alert in the API
 *  response. Shape designed to be a superset of what the current
 *  alert card needs (just `command`) so file 02-B (proper UI redesign)
 *  can light up safe_mode / validation / rollback / impact rendering
 *  without re-shipping the resolver. */
export interface ResolvedFix {
  /** Quick-check: the canonical one-line diagnostic command. The
   *  dashboard's alert detail page renders this as the default
   *  expanded view; the rest of this struct (full FIX content)
   *  hides behind a "Show full remediation" click-through. */
  quick_check: Fix["quick_check"];
  /** Verdict prior: at-a-glance shape badge (recoverable /
   *  investigation / vendor-side). Optional - rules can opt out and
   *  the UI renders no badge. Per the Furnace static-priors spec
   *  shipped 2026-05-20. */
  verdict_prior: Fix["verdict_prior"];
  command: string;
  description: string;
  /** suggested_action: the single non-interactive, fully-substituted command
   *  an automated agent can run to remediate or safely advance this alert.
   *  Null when the alert is judgment/physical-only (no single safe command);
   *  the agent should follow quick_check + prerequisites in that case.
   *  Sourced from the selected variant's `suggested_action`, evidence-
   *  interpolated so it names the real device/pid/unit. Added for the
   *  agent-remediation surface (2026-07-05). */
  suggested_action: string | null;
  prerequisites: string[];
  safe_mode: Fix["safe_mode"];
  validation: Fix["validation"];
  rollback: Fix["rollback"];
  impact: Fix["impact"];
  variant_match: {
    distro_matched: string;
    vendor_matched: string;
    condition_matched: boolean;
  };
  /** True when the rule is post-incident forensic and has no automatic
   *  resolution path (the event already happened; the host will look
   *  healthy on the next snapshot). The dashboard UI uses this to gate
   *  the "Mark resolved (manual)" button and the endpoint uses it to
   *  reject a resolve call on a non-forensic firing alert. Sourced
   *  from RuleMetadataSchema.manual_resolve; defaults false. */
  manual_resolve: boolean;
}

/** Build the lowercase distro token (e.g. "debian-12", "ubuntu-24.04")
 *  that the YAML library's `distro_match` patterns key on.
 *
 *  Returns null when os_id is absent (server hasn't ingested since
 *  migration 021 landed, or genuinely-unknown distro). selectVariant
 *  treats null as "no distro constraint" → only `["*"]` wildcard
 *  variants match, which is the safe degradation. */
function buildDistroToken(
  osId: string | null,
  versionId: string | null,
): string | null {
  if (!osId) return null;
  return versionId ? `${osId}-${versionId}` : osId;
}

/** Normalize the DMI vendor string into a token suitable for matching
 *  against `vendor_match` patterns. Re-uses the existing dashboard
 *  vendor normalizer for the canonical mapping, then lowercases for
 *  case-insensitive glob matching downstream.
 *
 *  Logs a one-line warning when the input is non-empty but normalizeVendor
 *  couldn't canonicalize it (returns trimmed-suffix-stripped output that
 *  isn't in the known list). Per Simon's D2 ask 2026-05-17 - surfaces
 *  edge-case DMI strings in production logs so the canonical table can
 *  grow over time. */
function buildVendorToken(rawDmiVendor: string | null): string | null {
  if (!rawDmiVendor) return null;
  const canonical = normalizeVendor(rawDmiVendor);
  if (!canonical) return null;
  // The known canonical list (must mirror CANONICAL_BY_PREFIX in
  // $lib/utils/vendor.ts). Mismatches mean normalizeVendor fell to
  // its trimmed-unknown fallback, which we log so the table grows.
  const KNOWN = new Set([
    "GIGABYTE",
    "Supermicro",
    "ASRockRack",
    "ASUS",
    "Dell",
    "HPE",
    "Lenovo",
    "Inspur",
  ]);
  if (!KNOWN.has(canonical)) {
    console.warn(
      `[fix-workflow] normalizeVendor returned unknown canonical "${canonical}" for raw DMI vendor "${rawDmiVendor}". Variant matching will use the unknown token; add a mapping to $lib/utils/vendor.ts if this should canonicalize.`,
    );
  }
  return canonical.toLowerCase();
}

/** Replace `{{key}}` tokens in a remediation command with scalar values from
 *  the firing alert's evidence, so the fix names the actual affected device or
 *  component (e.g. `/dev/md0`, `DIMM_A1`) instead of a `md126`/`sdN`-style
 *  placeholder the operator has to mentally substitute.
 *
 *  Shell variables (`${VAR}`) are deliberately NOT touched: those are
 *  operator-supplied inputs the command intends them to set. Only the distinct
 *  double-brace token is substituted, so this is safe to run over every
 *  command (rules without tokens are returned unchanged). An unknown or
 *  non-scalar key renders as `<key>` so the command still reads as a template
 *  rather than leaking `[object Object]` or a raw token. */
export function interpolateEvidence(
  text: string,
  evidence: Record<string, unknown> | undefined,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_full, key: string) => {
    const v = evidence?.[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    return `<${key}>`;
  });
}

/** Main entry point. Resolve the alert's FIX content from the YAML
 *  library. Returns null when:
 *    - The rule type isn't in the YAML library (defensive - currently
 *      all 38 rule types are covered, but the caller falls back to
 *      the legacy evidence.fix_commands path so future-added rule
 *      types don't break the card).
 *    - selectVariant can't find any matching variant (also defensive -
 *      every rule has a wildcard fallback by schema invariant, so
 *      this branch should be unreachable in practice).
 *
 *  Throws on no exceptions; all error paths return null. The caller
 *  is expected to attach a `fix_workflow` field to each alert in the
 *  response, or omit it when this returns null. */
export function resolveFix(
  alert_type: string,
  evidence: Record<string, unknown> | undefined,
  server: ServerLocator,
): ResolvedFix | null {
  const rule = getRuleMetadata(alert_type);
  if (!rule) return null;

  const distro = buildDistroToken(server.os_id, server.os_version_id);
  const vendor = buildVendorToken(server.dmi_vendor);

  const variant = selectVariant(rule.fix.variants, { distro, vendor }, evidence);
  if (!variant) return null;

  // Per-alert verdict override. The YAML `verdict_prior` is the static
  // default for the rule, but an evaluator can set a context-dependent
  // verdict in evidence (R-P2-1: cpu_temperature_high flips vendor-side
  // -> investigation when the temperature is load-correlated). Honour the
  // override only when it is a valid verdict value; otherwise fall back to
  // the YAML default.
  const overrideRaw = evidence?.verdict_prior_override;
  const verdict_prior =
    typeof overrideRaw === "string" &&
    (["recoverable", "investigation", "vendor-side"] as const).includes(overrideRaw as never)
      ? (overrideRaw as typeof rule.fix.verdict_prior)
      : rule.fix.verdict_prior;

  // Interpolate `{{key}}` evidence tokens into every command-bearing block, so
  // a tokenised command renders with the real device/component regardless of
  // which block it lives in (and blocks without tokens pass through unchanged).
  // Each block is spread with its own concrete type so it keeps that type;
  // `${VAR}` shell vars are untouched. rollback.command is nullable, so guard.
  const interp = (cmd: string) => interpolateEvidence(cmd, evidence);
  const { quick_check: qc, safe_mode: sm, validation: val, rollback: rb } = rule.fix;

  return {
    quick_check: { ...qc, command: interp(qc.command) },
    verdict_prior,
    command: interp(variant.command),
    description: variant.description,
    suggested_action: variant.suggested_action ? interp(variant.suggested_action) : null,
    prerequisites: rule.fix.prerequisites,
    safe_mode: sm ? { ...sm, command: interp(sm.command) } : sm,
    validation: val ? { ...val, command: interp(val.command) } : val,
    rollback: rb ? { ...rb, command: rb.command == null ? rb.command : interp(rb.command) } : rb,
    impact: rule.fix.impact,
    variant_match: {
      distro_matched: variant.distro_match.join(", "),
      vendor_matched: variant.vendor_match.join(", "),
      condition_matched: variant.condition_match !== undefined,
    },
    manual_resolve: rule.manual_resolve === true,
  };
}
