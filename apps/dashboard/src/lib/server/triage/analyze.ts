// Paste triage core: run the parsers whose detect() matches, merge their
// snapshot slices, evaluate Glassmkr's own alert rules on the result, resolve
// the fix workflows, and shape a model-visible answer.
//
// Pure and synchronous: no database, no network, no clock except what the
// evaluator itself reads. Nothing here stores or logs the pasted text.
//
// What leaves this module is deliberately narrow. Titles and summaries are the
// static rule YAML metadata, never the evaluator's dynamic titles (those embed
// paste-derived strings). Evidence is reduced to scalars, every string is
// re-sanitized, and free-text fields (raw log lines, messages, error text) are
// dropped, so a line like "ignore previous instructions" inside a matched log
// entry never reaches the model.

import crypto from "node:crypto";
import { z } from "zod";
import {
  evaluateAlerts,
  type AlertResult,
  type ServerConfig,
  type Snapshot,
} from "$lib/server/alerts/evaluator.js";
import { getRuleMetadata, listMetadataRuleTypes } from "$lib/server/alerts/fix-workflow/loader.js";
import { resolveFix, type ResolvedFix, type ServerLocator } from "$lib/server/alerts/fix-workflow/resolve.js";
import { TRIAGE_PARSERS } from "./registry.js";
import { safeIdent, safeLabel } from "./sanitize.js";
import {
  DOMAIN_SNAPSHOT_KEYS,
  type ParserResult,
  type TriageDomain,
  type TriageFormat,
  type TriageParser,
} from "./types.js";
import { captureCommandText, captureWhy, type CaptureGoal } from "./capture.js";

/**
 * collector_version stamped on the synthetic snapshot. The parsers emulate the
 * field set of Crucible 1.2.4 (FALLBACK_LATEST in $lib/server/version.ts when
 * they were written), so agentAtLeast() gates in the evaluator see a current
 * agent. Today the only gate is the filesystem_readonly mount-options path,
 * which reads `disks`, a key no parser writes. Kept as its own constant rather
 * than imported, so bumping the fallback for a release cannot silently change
 * what the paste parsers claim to emulate.
 */
export const TRIAGE_COLLECTOR_VERSION = "1.2.4";

/**
 * SEL events in a paste count regardless of age. The evaluator defaults to a
 * 30-day window measured from the server clock, which would silently drop a
 * real event from an older paste. Ten years keeps everything a BMC holds.
 */
const SEL_WINDOW_DAYS = 3650;

const MAX_FINDINGS = 30;
const MAX_OBSERVED_KEYS = 24;
const MAX_ARRAY_ITEMS = 16;
const MAX_NOTE_LENGTH = 240;

export const TRIAGE_FORMATS = [
  "smartctl_json",
  "smartctl_text",
  "zpool_status",
  "proc_mdstat",
  "mdadm_detail",
  "dmesg",
  "journalctl_kernel",
  "syslog_kernel",
  "ipmitool_sel_elist",
  "ipmitool_sel_list",
  "ipmitool_sel_info",
  "ipmitool_sdr",
  "ipmitool_sensor",
  "nvidia_smi_query",
  "nvidia_smi_nvlink_status",
] as const satisfies readonly TriageFormat[];

// Compile-time guard: TRIAGE_FORMATS must list every TriageFormat in types.ts.
type MissingFormat = Exclude<TriageFormat, (typeof TRIAGE_FORMATS)[number]>;
const _allFormatsListed: MissingFormat extends never ? true : never = true;
void _allFormatsListed;

const FORMAT_DOMAIN: Record<TriageFormat, TriageDomain> = {
  smartctl_json: "smart",
  smartctl_text: "smart",
  zpool_status: "zfs",
  proc_mdstat: "mdraid",
  mdadm_detail: "mdraid",
  dmesg: "kernel_log",
  journalctl_kernel: "kernel_log",
  syslog_kernel: "kernel_log",
  ipmitool_sel_elist: "ipmi_sel",
  ipmitool_sel_list: "ipmi_sel",
  ipmitool_sel_info: "ipmi_sel",
  ipmitool_sdr: "ipmi_sel",
  ipmitool_sensor: "ipmi_sel",
  nvidia_smi_query: "nvidia_gpu",
  nvidia_smi_nvlink_status: "nvidia_gpu",
};

const DOMAIN_GOAL: Record<TriageDomain, CaptureGoal> = {
  smart: "all_disks",
  zfs: "zfs",
  mdraid: "raid_md",
  kernel_log: "kernel_errors",
  ipmi_sel: "bmc_events",
  nvidia_gpu: "gpu",
};

const SUBJECT_KINDS = ["drive", "md_array", "zfs_pool", "gpu", "bmc", "kernel"] as const;
type SubjectKind = (typeof SUBJECT_KINDS)[number];

const DOMAIN_KIND: Record<TriageDomain, SubjectKind> = {
  smart: "drive",
  zfs: "zfs_pool",
  mdraid: "md_array",
  kernel_log: "kernel",
  ipmi_sel: "bmc",
  nvidia_gpu: "gpu",
};

// What a finding is about, when that differs from the domain that fed the rule
// (disk_io_errors comes from the kernel log but is about a drive).
const RULE_KIND: Record<string, SubjectKind> = {
  smart_failing: "drive",
  drive_smart_unreadable: "drive",
  nvme_wear_high: "drive",
  nvme_critical_warning: "drive",
  disk_io_errors: "drive",
  raid_degraded: "md_array",
  zfs_pool_unhealthy: "zfs_pool",
  zfs_scrub_errors: "zfs_pool",
  zfs_slog_faulted: "zfs_pool",
  gpu_xid_critical: "gpu",
  nvlink_link_down: "gpu",
  ipmi_sel_critical: "bmc",
  ipmi_sel_full: "bmc",
  ipmi_fan_failure: "bmc",
  psu_redundancy_loss: "bmc",
  filesystem_readonly: "kernel",
  mce_uncorrected: "kernel",
};

const SEVERITY_RANK: Record<AlertResult["severity"], number> = { critical: 0, warning: 1, info: 2 };

// ---------------------------------------------------------------------------
// Output contract (also the MCP tool's outputSchema)
// ---------------------------------------------------------------------------

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const analysisOutputShape = {
  input: z.object({
    formats: z.array(z.enum(TRIAGE_FORMATS)),
    bytes: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    sha256_prefix: z.string().regex(/^[0-9a-f]{12}$/),
    subjects: z.number().int().nonnegative(),
  }).strict(),
  findings: z.array(
    z.object({
      rule_id: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
      title: z.string(),
      subject: z.object({
        kind: z.enum(SUBJECT_KINDS),
        id: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
      }).strict(),
      summary: z.string(),
      observed: z.record(scalar),
      fix: z.object({
        quick_check: z.object({ command: z.string(), explanation: z.string() }).strict().optional(),
        steps: z.array(z.object({ title: z.string(), command: z.string().optional() }).strict()).optional(),
        verdict_prior: z.string().optional(),
      }).strict().nullable(),
    }).strict(),
  ),
  checked_no_signal: z.array(z.object({ rule_id: z.string(), title: z.string() }).strict()),
  not_determinable: z.array(z.object({ signal: z.string(), reason: z.string() }).strict()),
  next_capture: z.array(z.object({ goal: z.string(), command: z.string(), why: z.string() }).strict()),
  notes: z.array(z.string()),
  continuous_monitoring: z.object({
    docs_url: z.literal("https://glassmkr.com/docs/getting-started?ref=mcp-triage"),
    source_url: z.literal("https://github.com/glassmkr/crucible"),
  }).strict(),
};

export const analysisOutputSchema = z.object(analysisOutputShape).strict();
export type TriageAnalysis = z.infer<typeof analysisOutputSchema>;
type Finding = TriageAnalysis["findings"][number];
type Observed = Finding["observed"];

export interface AnalyzeOptions {
  /** os-release ID (ubuntu, debian, rhel, ...) for distro-specific fix variants. */
  distro?: string;
  /** Caller's guess at the format. Runs that domain's parser even if detect() missed. */
  formatHint?: TriageFormat;
  /** Parser list. Defaults to the registry; tests pass small fakes. */
  parsers?: readonly TriageParser[];
}

// ---------------------------------------------------------------------------
// Snapshot merge
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isEmptyScalar(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Merge one parser's value into the accumulated one. Two domains can share a
 * container (kernel_log writes gpu.tier1.xid_events, nvidia_gpu writes
 * gpu.tier1.gpus), so objects merge key by key and arrays concatenate.
 * Booleans OR together: a parser that saw data marks its container available,
 * and another parser that did not see that part must not switch it off.
 * Other scalars keep the first non-empty value.
 */
function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) return [...existing, ...incoming];
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const out: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) out[k] = mergeValue(out[k], v);
    return out;
  }
  if (typeof existing === "boolean" && typeof incoming === "boolean") return existing || incoming;
  return isEmptyScalar(existing) ? incoming : existing;
}

function mergeSlices(results: ParserResult[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const result of results) {
    // A parser may only write the keys its domain owns; anything else is a
    // parser bug and is ignored rather than allowed to wake an unrelated rule.
    for (const key of DOMAIN_SNAPSHOT_KEYS[result.domain]) {
      const value = (result.snapshot as Record<string, unknown>)[key];
      if (value === undefined) continue;
      merged[key] = mergeValue(merged[key], value);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * evaluateAlerts already catches a rule that throws and logs it with
 * console.error("Alert rule <type> error:", err). A partial snapshot is exactly
 * where that can happen, so the call is wrapped to learn WHICH rules threw (they
 * did not check anything and must not be reported as "no matching signal") and
 * to keep the error object, which can quote snapshot values, out of the log.
 * The call is synchronous, so swapping console.error cannot catch anyone else's
 * output.
 */
function evaluateCapturingFailures(
  snapshot: Snapshot,
  config: ServerConfig,
): { results: AlertResult[]; failed: string[] } {
  const failed: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const m = typeof args[0] === "string" ? /^Alert rule (\S+) error:$/.exec(args[0]) : null;
    if (m) {
      failed.push(m[1]);
      return;
    }
    original(...args);
  };
  try {
    const results = evaluateAlerts(snapshot, config);
    return { results, failed };
  } catch {
    // Outside the per-rule guard (phase bookkeeping). Report every rule as
    // unevaluated rather than crash the tool call.
    return { results: [], failed: ["*"] };
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// Evidence shaping
// ---------------------------------------------------------------------------

// Free text, raw log lines, internal bookkeeping, or values that only make
// sense for a live agent. Never shown.
const DROP_KEYS = new Set([
  "raw_line",
  "raw_message",
  "message",
  "recommendation",
  "fix_commands",
  "note",
  "errors_text",
  "details",
  "options",
  "parser_quality",
  "severity_reason",
  "window_days",
  "events_outside_window",
  "log_full_event",
  "triggering_signals",
  "verdict_prior_override",
]);

// Short human labels that legitimately contain spaces (drive and GPU models,
// SCSI sense keys, SEL component names). Everything else must be a single
// token; a string with whitespace in any other field is treated as free text.
const LABEL_KEYS = new Set(["model", "gpu_name", "sense_key", "xid_summary", "affected_components"]);

const SUBJECT_ID_KEYS = ["device", "pool", "controller", "pci_bdf", "gpu_uuid"] as const;
const SUBJECT_MODEL_KEYS = ["model", "gpu_name"] as const;

// The smartctl parser names a drive read through a RAID controller the way
// Crucible does: "/dev/bus/0[sat+megaraid,8]" (path, then the smartctl -d
// type). safeIdent would drop the brackets and the comma and print a device
// that does not exist, so this one validated shape is kept whole. It is never
// interpolated into a fix command (see fixEvidence).
const PASSTHROUGH_DEVICE = /^\/dev\/[A-Za-z0-9/_.-]{1,48}\[(?:sat\+)?(?:megaraid|cciss|3ware|aacraid|areca|marvell),\d{1,4}\]$/;

// The smartctl parser's stand-in when a text paste never names its device.
const UNKNOWN_DEVICE = /^unknown-device(?:-\d+)?$/;

function cleanDevice(value: string): string {
  const v = value.trim();
  return PASSTHROUGH_DEVICE.test(v) ? v : safeIdent(v, 64);
}

function cleanString(key: string, value: string): string {
  if (LABEL_KEYS.has(key)) return safeLabel(value, 64);
  if (/\s/.test(value.trim())) return "";
  if (key === "device") return cleanDevice(value);
  return safeIdent(value.trim(), 64);
}

// Rules that report several components at once list them as objects
// (failed_fans, faulted_slogs, unreadable_devices, affected_dimms). Only each
// item's name is kept, joined into one list, so the answer says WHICH fan or
// disk failed without carrying any of the item's other fields. Without this
// the whole array was dropped and drive_smart_unreadable, ipmi_fan_failure and
// zfs_slog_faulted named nothing at all.
const ITEM_ID_KEYS = ["device", "vdev", "label"] as const;

// Lists whose items are named by a `name` that may hold spaces, with the real
// length of that name. Explicit per list: a generic cap would cut a GPU model
// in drifted_models to a misleading fragment, and a generous one would let a
// sentence ride along in a 16-byte sensor name.
const NAMED_ITEM_LISTS: Record<string, number> = {
  failed_fans: 16, // ipmi_fan_failure: an IPMI SDR id is at most 16 bytes
  failed: 16, // psu_redundancy_loss per-PSU path: IPMI sensor names
  drifted_models: 64, // gpu_driver_or_firmware_drift: GPU product names
};

function itemName(listKey: string, item: Record<string, unknown>): string {
  for (const key of ITEM_ID_KEYS) {
    const v = item[key];
    if (typeof v !== "string" || !v.trim()) continue;
    return key === "device" ? cleanDevice(v) : safeIdent(v.trim(), 64);
  }
  const max = NAMED_ITEM_LISTS[listKey];
  // Commas would blur the joined list.
  if (max && typeof item.name === "string") return safeLabel(item.name, max).replace(/,/g, " ").trim();
  return "";
}

/** The one value every item shares for `key`, or "" when absent or mixed. */
function sharedItemValue(items: Record<string, unknown>[], key: string): string {
  const values = new Set(items.map((i) => (typeof i[key] === "string" ? safeIdent((i[key] as string).trim(), 64) : "")));
  if (values.size !== 1) return "";
  return [...values][0];
}

/** Scalar-only, sanitized copy of a rule's evidence. */
function sanitizeEvidence(evidence: Record<string, unknown>): Observed {
  const out: Observed = {};
  let count = 0;
  let sharedPool = "";
  for (const [key, value] of Object.entries(evidence)) {
    if (count >= MAX_OBSERVED_KEYS) break;
    if (DROP_KEYS.has(key) || !/^[A-Za-z0-9_]{1,48}$/.test(key)) continue;
    let clean: string | number | boolean | null | undefined;
    if (value === null) clean = null;
    else if (typeof value === "number") clean = Number.isFinite(value) ? value : undefined;
    else if (typeof value === "boolean") clean = value;
    else if (typeof value === "string") clean = cleanString(key, value) || undefined;
    else if (Array.isArray(value)) {
      // Short lists of identifiers (failed members, link ids, flag names) are
      // joined into one token list; lists of objects keep only each item's
      // name; anything with prose is dropped.
      if (value.length === 0 || value.length > MAX_ARRAY_ITEMS) continue;
      if (value.every(isPlainObject)) {
        const items = value.map((item) => itemName(key, item)).filter(Boolean);
        if (items.length !== value.length) continue;
        clean = items.join(",");
        // zfs_slog_faulted names its pool only inside each item.
        sharedPool ||= sharedItemValue(value, "pool");
      } else {
        if (!value.every((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) continue;
        const items = value
          .map((v) => (typeof v === "number" ? String(v) : /\s/.test(v.trim()) ? "" : safeIdent(v.trim(), 64)))
          .filter(Boolean);
        clean = items.length > 0 ? items.join(",") : undefined;
      }
    }
    if (clean === undefined) continue;
    out[key] = clean;
    count += 1;
  }
  if (sharedPool && out.pool === undefined) out.pool = sharedPool;
  return out;
}

/**
 * Evidence for resolveFix. A placeholder device ("unknown-device", the paste
 * never named it) or a controller passthrough id (brackets are a shell glob)
 * would produce a command that cannot run as printed, so the device is left
 * out and the fix template renders its own `<device>` placeholder instead.
 */
function fixEvidence(evidence: Observed): Observed {
  const device = evidence.device;
  if (typeof device !== "string" || !(UNKNOWN_DEVICE.test(device) || PASSTHROUGH_DEVICE.test(device))) return evidence;
  const { device: _omit, ...rest } = evidence;
  void _omit;
  return rest;
}

function subjectKind(ruleId: string, observed: Observed, ruleDomain: TriageDomain | undefined): SubjectKind {
  if (ruleId === "ecc_errors") return observed.source === "edac" ? "kernel" : "bmc";
  if (RULE_KIND[ruleId]) return RULE_KIND[ruleId];
  if (ruleId.startsWith("gpu_")) return "gpu";
  return ruleDomain ? DOMAIN_KIND[ruleDomain] : "kernel";
}

function pickString(observed: Observed, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const v = observed[key];
    if (typeof v === "string" && v && v !== "unknown") return { key, value: v };
  }
  return null;
}

function buildFix(fix: ResolvedFix | null): Finding["fix"] {
  if (!fix) return null;
  const steps: NonNullable<NonNullable<Finding["fix"]>["steps"]> = [];
  for (const p of fix.prerequisites) steps.push({ title: `Before you start: ${p}` });
  if (fix.safe_mode) steps.push({ title: "Confirm the current state (read-only)", command: fix.safe_mode.command });
  steps.push({ title: "Remediation", command: fix.command });
  if (fix.validation) steps.push({ title: "Confirm the fix worked", command: fix.validation.command });
  const out: NonNullable<Finding["fix"]> = {
    quick_check: { command: fix.quick_check.command, explanation: fix.quick_check.description },
    steps,
  };
  if (fix.verdict_prior) out.verdict_prior = fix.verdict_prior;
  return out;
}

function shapeFinding(
  alert: AlertResult,
  ruleDomain: TriageDomain | undefined,
  locator: ServerLocator,
): Finding {
  const meta = getRuleMetadata(alert.type);
  const safeEvidence = sanitizeEvidence(alert.evidence ?? {});
  const kind = subjectKind(alert.type, safeEvidence, ruleDomain);

  const subject: Finding["subject"] = { kind };
  const used = new Set<string>();
  const id = pickString(safeEvidence, SUBJECT_ID_KEYS);
  if (id) {
    subject.id = id.value;
    used.add(id.key);
  }
  const model = pickString(safeEvidence, SUBJECT_MODEL_KEYS);
  if (model) {
    subject.model = model.value;
    used.add(model.key);
  }
  const serial = pickString(safeEvidence, ["serial"]);
  if (serial) {
    subject.serial = serial.value;
    used.add(serial.key);
  }

  const observed: Observed = {};
  for (const [k, v] of Object.entries(safeEvidence)) if (!used.has(k)) observed[k] = v;

  let fix: Finding["fix"] = null;
  try {
    // The sanitized evidence, not the raw one: resolveFix interpolates
    // {{key}} tokens into commands, and only re-sanitized values may land there.
    fix = buildFix(resolveFix(alert.type, fixEvidence(safeEvidence), locator));
  } catch {
    fix = null;
  }

  return {
    rule_id: alert.type,
    severity: alert.severity,
    title: meta?.title ?? alert.type,
    subject,
    summary: (meta?.summary ?? "").trim(),
    observed,
    fix,
  };
}

// Timestamps and counters that differ between otherwise identical events.
const VOLATILE_KEY = /timestamp|_iso$|^age_|^events_in_window$/;

function findingKey(f: Finding): string {
  const stable = Object.entries(f.observed)
    .filter(([k]) => !VOLATILE_KEY.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([f.rule_id, f.severity, f.subject, stable]);
}

/** Collapse repeats (fifty identical NVMe resets) into one finding with a count. */
function dedupeFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, { finding: Finding; n: number }>();
  for (const f of findings) {
    const key = findingKey(f);
    const hit = byKey.get(key);
    if (hit) hit.n += 1;
    else byKey.set(key, { finding: f, n: 1 });
  }
  return [...byKey.values()].map(({ finding, n }) =>
    n > 1 ? { ...finding, observed: { ...finding.observed, occurrences: n } } : finding,
  );
}

// ---------------------------------------------------------------------------
// Event timing
// ---------------------------------------------------------------------------

function hasUnknownTimes(snapshot: Record<string, unknown>): boolean {
  const unknown = (ts: unknown) => typeof ts !== "string" || ts === "" || Number.isNaN(Date.parse(ts));
  const dmesg = snapshot.dmesg_events as { events?: Array<{ timestamp_iso?: unknown }> } | undefined;
  if (Array.isArray(dmesg?.events) && dmesg.events.some((e) => unknown(e?.timestamp_iso))) return true;
  const tier1 = (snapshot.gpu as { tier1?: { xid_events?: Array<{ timestamp_iso?: unknown }> } } | undefined)?.tier1;
  if (Array.isArray(tier1?.xid_events) && tier1.xid_events.some((e) => unknown(e?.timestamp_iso))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function countLines(text: string): number {
  if (text === "") return 0;
  const parts = text.split(/\r\n|\n|\r/);
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

// Parser notes are built from constants and counts by contract; this only
// strips control and bidi characters and bounds the length as a backstop.
function cleanNote(message: string): string {
  return message.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
}

function safeDetect(parser: TriageParser, text: string): boolean {
  try {
    return parser.detect(text) === true;
  } catch {
    return false;
  }
}

function normalizeDistro(distro: string | undefined): string | null {
  const id = safeIdent((distro ?? "").trim().toLowerCase(), 32).replace(/[^a-z0-9._-]/g, "");
  return id || null;
}

const CONTINUOUS_MONITORING = {
  docs_url: "https://glassmkr.com/docs/getting-started?ref=mcp-triage",
  source_url: "https://github.com/glassmkr/crucible",
} as const;

/** Analyze pasted command output with Glassmkr's alert rules. */
export function analyzeOutput(text: string, opts: AnalyzeOptions = {}): TriageAnalysis {
  const parsers = opts.parsers ?? TRIAGE_PARSERS;
  const hintDomain = opts.formatHint ? FORMAT_DOMAIN[opts.formatHint] : undefined;
  const notes: string[] = [];

  // 1. Detect and parse.
  const parsed: Array<{ parser: TriageParser; result: ParserResult; detected: boolean }> = [];
  for (const parser of parsers) {
    const detected = safeDetect(parser, text);
    if (!detected && parser.domain !== hintDomain) continue;
    try {
      parsed.push({ parser, result: parser.parse(text), detected });
    } catch {
      notes.push(`The ${parser.domain} reader failed on this input and was skipped.`);
    }
  }

  const formats: TriageFormat[] = [];
  for (const { result } of parsed) {
    for (const f of result.formats ?? []) if (!formats.includes(f)) formats.push(f);
    for (const n of result.notes ?? []) {
      const note = cleanNote(String(n?.message ?? ""));
      if (note && !notes.includes(note)) notes.push(note);
    }
  }

  // 2. Only parsers that recognised something take part in evaluation, so a
  // garbage paste never earns a "checked, no matching signal" line.
  const active = parsed.filter(({ result }) => (result.subjects ?? 0) > 0);
  const subjects = active.reduce((sum, { result }) => sum + result.subjects, 0);

  const allow: string[] = [];
  const ruleDomain = new Map<string, TriageDomain>();
  for (const { parser, result } of active) {
    // rules_checked can only narrow the parser's own list, never widen it.
    const checked = Array.isArray(result.rules_checked)
      ? parser.rules.filter((r) => result.rules_checked!.includes(r))
      : parser.rules;
    for (const rule of checked) {
      if (!ruleDomain.has(rule)) ruleDomain.set(rule, parser.domain);
      if (!allow.includes(rule)) allow.push(rule);
    }
  }

  // 3. Evaluate with every other rule muted.
  const merged = mergeSlices(active.map(({ result }) => result));
  let alerts: AlertResult[] = [];
  let failed: string[] = [];
  if (allow.length > 0) {
    const allowSet = new Set(allow);
    const snapshot = { collector_version: TRIAGE_COLLECTOR_VERSION, ...merged } as unknown as Snapshot;
    const evaluation = evaluateCapturingFailures(snapshot, {
      muted_rules: listMetadataRuleTypes().filter((t) => !allowSet.has(t)),
      ipmi_sel_critical_window_days: SEL_WINDOW_DAYS,
    });
    // Belt and braces: a rule without YAML metadata cannot be muted by type,
    // so anything outside the allowlist is dropped here too.
    alerts = evaluation.results.filter((a) => allowSet.has(a.type));
    failed = evaluation.failed;
    for (const rule of failed) {
      if (rule === "*") {
        notes.push("The rules could not be evaluated on this input; nothing was checked.");
      } else if (allowSet.has(rule)) {
        notes.push(`Rule ${safeIdent(rule, 64)} could not be evaluated on this input and was skipped.`);
        console.warn(JSON.stringify({ evt: "triage_rule_error", rule: safeIdent(rule, 64) }));
      }
    }
  }

  // 4. Shape findings.
  const locator: ServerLocator = {
    os_id: normalizeDistro(opts.distro),
    os_id_like: null,
    os_version_id: null,
    dmi_vendor: null,
  };
  const shaped = alerts.map((a) => shapeFinding(a, ruleDomain.get(a.type), locator));
  const ordered = dedupeFindings(shaped)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
  const findings = ordered.slice(0, MAX_FINDINGS);
  if (ordered.length > findings.length) {
    notes.push(`${ordered.length - findings.length} more findings were left out of this answer; paste a smaller section to see them.`);
  }

  // 5. What ran and found nothing, and what one paste cannot say.
  const fired = new Set(alerts.map((a) => a.type));
  const skipped = new Set(failed);
  const checked_no_signal = skipped.has("*")
    ? []
    : allow
        .filter((rule) => !fired.has(rule) && !skipped.has(rule))
        .map((rule) => ({ rule_id: rule, title: getRuleMetadata(rule)?.title ?? rule }));

  const not_determinable: TriageAnalysis["not_determinable"] = [];
  for (const { parser } of active) {
    for (const item of parser.notDeterminable) {
      if (!not_determinable.some((n) => n.signal === item.signal)) {
        not_determinable.push({ signal: item.signal, reason: item.reason });
      }
    }
  }
  if (hasUnknownTimes(merged)) {
    not_determinable.push({
      signal: "event_timing",
      reason: "Some events in this paste carry relative (time since boot) or no timestamps, so how long ago they happened cannot be determined from the paste alone.",
    });
  }

  return {
    input: {
      formats,
      bytes: Buffer.byteLength(text, "utf8"),
      lines: countLines(text),
      sha256_prefix: crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12),
      subjects,
    },
    findings,
    checked_no_signal,
    not_determinable,
    // A parser forced by the format hint that found nothing was never
    // recognised, so it must not prompt "recognised but unreadable".
    next_capture: nextCapture(
      parsed.filter(({ detected, result }) => detected || result.subjects > 0).map(({ result }) => result),
      active.map(({ result }) => result),
      findings,
    ),
    notes,
    continuous_monitoring: { ...CONTINUOUS_MONITORING },
  };
}

// ---------------------------------------------------------------------------
// Next capture
// ---------------------------------------------------------------------------

const NOTHING_RECOGNISED_GOALS: CaptureGoal[] = ["all_disks", "raid_md", "zfs", "kernel_errors", "bmc_events", "gpu"];

function nextCapture(
  detected: ParserResult[],
  active: ParserResult[],
  findings: Finding[],
): TriageAnalysis["next_capture"] {
  const out: TriageAnalysis["next_capture"] = [];
  const add = (goal: CaptureGoal, why: string) => {
    if (out.some((o) => o.goal === goal)) return;
    out.push({ goal, command: captureCommandText(goal), why });
  };

  if (active.length === 0) {
    for (const r of detected) {
      add(DOMAIN_GOAL[r.domain], "This output was recognised but could not be read in full; capture it again with this command and paste the complete output.");
    }
    if (detected.length === 0) {
      for (const goal of NOTHING_RECOGNISED_GOALS) add(goal, captureWhy(goal));
    }
    return out;
  }

  const domains = new Set(active.map((r) => r.domain));
  const formats = new Set(active.flatMap((r) => r.formats));
  const fired = new Set(findings.map((f) => f.rule_id));

  for (const r of detected) {
    if (!domains.has(r.domain)) {
      add(DOMAIN_GOAL[r.domain], "Part of this paste was recognised but could not be read in full; capture it again with this command.");
    }
  }
  if (domains.has("mdraid") && !formats.has("mdadm_detail")) add("raid_md", captureWhy("raid_md"));
  if (domains.has("ipmi_sel") && !formats.has("ipmitool_sel_info")) {
    add("bmc_events", "ipmitool sel info shows whether the BMC event log is full and has stopped recording.");
  }
  if (domains.has("nvidia_gpu") && !formats.has("nvidia_smi_nvlink_status")) add("nvlink", captureWhy("nvlink"));

  const driveFinding = ["raid_degraded", "zfs_pool_unhealthy", "zfs_scrub_errors", "disk_io_errors", "filesystem_readonly"]
    .some((r) => fired.has(r));
  if (driveFinding && !domains.has("smart")) {
    add("all_disks", "SMART data shows whether the disk behind this finding is failing.");
  }
  if ((domains.has("smart") || driveFinding) && !domains.has("kernel_log")) {
    add("kernel_errors", captureWhy("kernel_errors"));
  }
  if (domains.has("nvidia_gpu") && !domains.has("kernel_log")) {
    add("kernel_errors", "GPU Xid events are written to the kernel log, not to nvidia-smi.");
  }
  if (fired.has("gpu_xid_critical") && !domains.has("nvidia_gpu")) add("gpu", captureWhy("gpu"));
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Content text
// ---------------------------------------------------------------------------

/** The short model-visible text block that accompanies structuredContent. */
export function renderAnalysisText(analysis: TriageAnalysis): string {
  const lines: string[] = [];
  // Keyed on subjects, not formats: a recognised format with nothing readable
  // in it (`zpool status -x`, a cut-off paste) ran no rule either, and must not
  // claim it was checked.
  if (analysis.input.subjects === 0) {
    if (analysis.input.formats.length === 0) {
      lines.push("No supported command output was recognised in this paste, so no rule was checked.");
    } else {
      lines.push(`Recognised ${analysis.input.formats.join(", ")}, but it held nothing the rules can read (for example a one-line summary or a cut-off paste), so no rule was checked.`);
    }
    lines.push("Run one of the commands in next_capture on the server and paste the output.");
    return lines.join("\n");
  }
  const read = analysis.input.formats.length > 0 ? analysis.input.formats.join(", ") : "the pasted output";
  lines.push(`Read ${read} (${analysis.input.subjects} subject(s)) and checked it with Glassmkr's alert rules.`);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of analysis.findings) counts[f.severity] += 1;
  if (analysis.findings.length === 0) {
    lines.push("No rule matched: no matching signal in this output. That is not a health verdict; it covers only what this paste shows.");
  } else {
    lines.push(`${analysis.findings.length} finding(s): ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info.`);
    for (const f of analysis.findings) {
      const who = [f.subject.kind, f.subject.id, f.subject.serial ? `S/N ${f.subject.serial}` : ""].filter(Boolean).join(" ");
      lines.push(`- [${f.severity}] ${f.title} (${who})`);
    }
  }
  if (analysis.checked_no_signal.length > 0) {
    lines.push(`${analysis.checked_no_signal.length} other rule(s) ran and found no matching signal in this output.`);
  }
  if (analysis.not_determinable.some((n) => n.signal === "event_timing")) {
    lines.push("Times unknown: some events have relative or missing timestamps, so their age cannot be judged from this paste.");
  }
  return lines.join("\n");
}
