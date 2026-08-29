// Trend warning narration module (Stage 4).
//
// Calls the configured LLM endpoint (Gemma 4 via vLLM, OpenAI-compatible)
// with a strict JSON schema prompt, validates claim grounding, and falls back
// to a template-generated Narration when the model is unavailable or its
// output fails the validator.
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 4.

import type { Finding, Narration } from "./types";

const LLM_URL = process.env.LLM_API_URL || "";
const LLM_MODEL = process.env.LLM_MODEL || "gemma-4-26b-a4b";
const NARRATION_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are narrating a hardware trend warning for a sysadmin. The user is experienced and will verify your claims. You will be given structured evidence in JSON.

STRICT RULES:
1. Every numerical claim in your output MUST reference a specific metric from the evidence array. Never invent numbers.
2. Every drive serial, DIMM location, or host identifier in your output MUST appear in the input JSON. Never invent identifiers.
3. Do not use causal language ("caused by", "due to", "because") unless the input JSON contains a correlation_match field with a non-null value.
4. Use hedged language ("coincides with", "is consistent with", "pattern matches") for all claims without a correlation.
5. The uncertainty_statement field is mandatory. It must state what the warning does NOT establish, what other explanations are possible, and what evidence is missing.
6. Never say "will fail", "certain", or "guaranteed". Use "likely", "consistent with pre-failure behavior", or "suggests".
7. Recommended checks must be concrete commands (smartctl, ipmitool, zpool status) or specific dashboard panels.
8. Never use em-dashes. Use commas, semicolons, colons, or periods.
9. Output only the JSON object. No preamble, no markdown, no commentary.

JSON schema:
{
  "headline": "string, max 120 chars",
  "evidence_summary": "string, max 400 chars",
  "uncertainty_statement": "string, max 300 chars",
  "recommended_checks": ["string, max 200 chars", "..."] (1 to 3 items),
  "recommended_actions": ["string, max 200 chars", "..."] (1 to 3 items)
}`;

export function isNarrationConfigured(): boolean {
  return !!LLM_URL;
}

/**
 * Produce a narration for a trend warning finding. Tries the LLM first;
 * falls back to a deterministic template on any error or validation failure.
 */
export async function narrate(finding: Finding, hostname: string): Promise<Narration> {
  if (!isNarrationConfigured()) {
    return templateFallback(finding, hostname);
  }

  try {
    const llmOutput = await callLlm(finding, hostname);
    const parsed = parseLlmNarration(llmOutput);
    const validation = validateNarration(parsed, finding);
    if (!validation.valid) {
      console.warn(`[trend-warnings] narration validation failed (${validation.reason}), using template`);
      return templateFallback(finding, hostname);
    }
    return parsed;
  } catch (err: any) {
    console.warn(`[trend-warnings] narration failed: ${err?.message ?? err}, using template`);
    return templateFallback(finding, hostname);
  }
}

async function callLlm(finding: Finding, hostname: string): Promise<string> {
  const userPrompt = buildNarrationPrompt(finding, hostname);

  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(NARRATION_TIMEOUT_MS),
  });

  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("LLM returned non-JSON: " + raw.slice(0, 200));
  }
  if (data.error) {
    throw new Error("LLM error: " + (data.error.message || JSON.stringify(data.error)));
  }
  const msg = data.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning_content;
  if (!content) throw new Error("Empty LLM response");
  return content;
}

export function buildNarrationPrompt(finding: Finding, hostname: string): string {
  const payload = {
    server_hostname: hostname,
    warning_type: finding.type,
    severity: finding.severity,
    resource: finding.resource,
    evidence: finding.contributing_metrics,
    correlation_match: finding.correlation_match,
    tree_ranker_score: finding.tree_ranker_score,
    projected_timeline: finding.projected_timeline,
    evidence_summary_raw: finding.evidence_summary,
  };
  return `Narrate this trend warning. Respond with the JSON object only.\n\n${JSON.stringify(payload, null, 2)}`;
}

export function parseLlmNarration(content: string): Narration {
  const cleaned = content.replace(/```json\n?|```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("narration is not an object");
  }
  const n = parsed as Record<string, unknown>;
  if (typeof n.headline !== "string") throw new Error("missing headline");
  if (typeof n.evidence_summary !== "string") throw new Error("missing evidence_summary");
  if (typeof n.uncertainty_statement !== "string") throw new Error("missing uncertainty_statement");
  if (!Array.isArray(n.recommended_checks)) throw new Error("missing recommended_checks");
  if (!Array.isArray(n.recommended_actions)) throw new Error("missing recommended_actions");
  return {
    headline: n.headline,
    evidence_summary: n.evidence_summary,
    uncertainty_statement: n.uncertainty_statement,
    recommended_checks: (n.recommended_checks as unknown[]).map(String).slice(0, 3),
    recommended_actions: (n.recommended_actions as unknown[]).map(String).slice(0, 3),
  };
}

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;
const COMMON_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 30, 60, 90, 100, 168, 720]);

export function validateNarration(
  narration: Narration,
  finding: Finding
): { valid: boolean; reason?: string } {
  // Required fields
  if (!narration.headline || !narration.uncertainty_statement) {
    return { valid: false, reason: "missing required field" };
  }
  if (narration.recommended_checks.length < 1) {
    return { valid: false, reason: "recommended_checks must have at least one item" };
  }
  if (narration.recommended_actions.length < 1) {
    return { valid: false, reason: "recommended_actions must have at least one item" };
  }
  if (narration.headline.length > 200) return { valid: false, reason: "headline too long" };

  // Claim grounding: every number in narration text must appear in evidence
  // or be a "common" number (small integer, common time window).
  const narrationText = [
    narration.headline,
    narration.evidence_summary,
    narration.uncertainty_statement,
  ].join(" ");

  const evidenceNumbers = collectNumbers(finding);

  const matches = narrationText.match(NUMBER_RE) || [];
  for (const m of matches) {
    const n = parseFloat(m);
    if (COMMON_NUMBERS.has(n)) continue;
    if (!evidenceNumbers.has(n)) {
      // Allow numbers that are close (within 1%) to an evidence number
      // to handle rounding like "9.47%" vs 9.47.
      let close = false;
      for (const e of evidenceNumbers) {
        if (e === 0) continue;
        if (Math.abs((n - e) / e) < 0.01) { close = true; break; }
      }
      if (!close) return { valid: false, reason: `number ${n} not grounded in evidence` };
    }
  }

  // Identifier grounding: drive serials must match the resource
  if (finding.resource.serial) {
    const serialRe = /\b([A-Z0-9]{6,})\b/g;
    const serials = narrationText.match(serialRe) || [];
    for (const s of serials) {
      // Skip tokens that are just numeric (likely values, not identifiers)
      if (/^\d+$/.test(s)) continue;
      // If it looks like a serial and doesn't match ours, reject
      if (
        s.length >= 8 &&
        /[A-Z]/.test(s) &&
        s !== finding.resource.serial &&
        s !== finding.resource.model
      ) {
        return { valid: false, reason: `invented identifier ${s}` };
      }
    }
  }

  // Causal language only allowed when a correlation matched
  if (!finding.correlation_match) {
    const causal = ["caused by", "due to", "because of", "results in"];
    const lower = narrationText.toLowerCase();
    for (const phrase of causal) {
      if (lower.includes(phrase)) {
        return { valid: false, reason: "unsupported causal language" };
      }
    }
  }

  // Absolute-claim language is never allowed
  const absolutes = ["will fail", "is guaranteed", "certain to fail"];
  const lower = narrationText.toLowerCase();
  for (const phrase of absolutes) {
    if (lower.includes(phrase)) {
      return { valid: false, reason: "absolute-claim language" };
    }
  }

  return { valid: true };
}

function collectNumbers(finding: Finding): Set<number> {
  const out = new Set<number>();
  for (const m of finding.contributing_metrics) {
    out.add(m.current);
    out.add(m.baseline);
    out.add(m.delta_1d);
    out.add(m.delta_7d);
    out.add(m.delta_30d);
    out.add(m.burst_max_7d);
  }
  if (finding.tree_ranker_score != null) out.add(finding.tree_ranker_score);
  // Include numbers referenced in the machine-generated evidence_summary
  const evMatches = finding.evidence_summary.match(NUMBER_RE) || [];
  for (const m of evMatches) out.add(parseFloat(m));
  return out;
}

/**
 * Deterministic fallback narration. Used when the LLM is unavailable or
 * produced output that failed the validator.
 */
export function templateFallback(finding: Finding, hostname: string): Narration {
  const resourceLabel = finding.resource.name || finding.resource.serial || finding.resource.kind;
  const headline = `${prettyWarningType(finding.type)} on ${resourceLabel}`;

  const metricLines = finding.contributing_metrics
    .map((m) => {
      // Point-in-time deviation metrics (window === "current", e.g.
      // psu_rail_out_of_spec) have no meaningful time-delta; rendering a
      // "7-day change +0" misleads. Frame them against their baseline
      // (nominal) instead.
      if (m.window === "current") {
        return `${m.name} is ${formatNumber(m.current)} (nominal ${formatNumber(m.baseline)})`;
      }
      const sign = m.delta_7d >= 0 ? "+" : "";
      return `${m.name} is ${formatNumber(m.current)} (7-day change ${sign}${formatNumber(m.delta_7d)})`;
    })
    .join(". ");

  const evidence_summary = metricLines || finding.evidence_summary;

  const correlationText = finding.correlation_match
    ? `Correlation: ${finding.correlation_match}. Two independent signals match the pattern.`
    : `This warning is based on a single signal class and has not been corroborated by an independent measurement.`;
  const uncertainty_statement = `${correlationText} Verify with the recommended checks before acting. Other explanations may apply; the warning does not establish imminent failure.`;

  return {
    headline: headline.slice(0, 120),
    evidence_summary: evidence_summary.slice(0, 400),
    uncertainty_statement: uncertainty_statement.slice(0, 300),
    recommended_checks: getDefaultChecksFor(finding),
    recommended_actions: getDefaultActionsFor(finding),
  };
}

function prettyWarningType(t: string): string {
  return t.replace(/_/g, " ");
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

function getDefaultChecksFor(finding: Finding): string[] {
  const kind = finding.resource.kind;
  const dev = finding.resource.name || "/dev/sdX";
  if (finding.type.startsWith("smart_")) {
    return [
      `sudo smartctl -a ${dev}`,
      `sudo zpool status -v`,
      `sudo dmesg -T | grep -i ${dev.replace("/dev/", "")}`,
    ];
  }
  if (finding.type.startsWith("nvme_")) {
    return [
      `sudo nvme smart-log ${dev}`,
      `sudo nvme error-log ${dev}`,
      `sudo dmesg -T | grep -i nvme`,
    ];
  }
  if (finding.type === "drive_disappeared") {
    return [
      `lsblk -o NAME,SERIAL,SIZE,MODEL  # is the disk enumerating right now?`,
      `sudo smartctl --scan ; sudo smartctl -a ${dev}  # does the OS still see it?`,
      `sudo dmesg -T | grep -iE "ata|nvme|scsi|i/o error|link" | tail -50  # bus resets / link drops around when it vanished`,
      `Confirm whether the disk was removed on purpose (hot-swap / decommission) before treating this as a fault.`,
    ];
  }
  if (finding.type === "disk_fill_imminent" || finding.type === "disk_fill_projection") {
    return [
      `df -h ${dev}`,
      `du -sh ${dev}/* | sort -h | tail -20`,
    ];
  }
  if (finding.type === "ecc_ce_burst" || finding.type === "ecc_ce_accelerating") {
    return [
      `sudo ras-mc-ctl --errors`,
      `sudo edac-util -v`,
    ];
  }
  if (finding.type === "psu_rail_out_of_spec") {
    return [
      `sudo ipmitool sdr type Voltage`,
      `sudo ipmitool sel elist | tail -30`,
    ];
  }
  if (finding.type === "host_instability") {
    return [
      `last -x reboot shutdown | head -20  # recent reboot/shutdown history`,
      `sudo journalctl --list-boots | tail -10 ; sudo journalctl -b -1 -p err --no-pager | tail -50`,
      `sudo ipmitool sel elist | tail -40  # BMC log for power / voltage / thermal events around the crashes`,
    ];
  }
  if (finding.type === "host_reporting_gaps") {
    return [
      `systemctl status glassmkr-crucible  # is the agent running?`,
      `sudo journalctl -u glassmkr-crucible --since "3 days ago" --no-pager | tail -50  # agent errors / restarts`,
      `curl -sS -o /dev/null -w "%{http_code} %{time_total}s\\n" https://app.glassmkr.com/api/v1/health  # egress to the ingest endpoint`,
      `last -x reboot | head  # confirm the host did NOT reboot (uptime stayed up)`,
    ];
  }
  if (finding.type === "psu_rail_voltage_drift") {
    return [
      `sudo ipmitool sdr type Voltage  # current rail readings`,
      `sudo ipmitool sdr elist full | grep -i volt  # per-rail thresholds + status`,
      `sudo ipmitool sel elist | tail -30  # any power / voltage events logged`,
    ];
  }
  if (finding.type === "fan_rpm_decline") {
    return [
      `sudo ipmitool sdr type Fan`,
      `sudo ipmitool sdr type Temperature`,
    ];
  }
  if (finding.type === "nic_errors") {
    return [
      `sudo ethtool -S ${finding.resource.name}`,
      `ip -s link show ${finding.resource.name}`,
    ];
  }
  if (finding.type === "alert_flapping") {
    return [
      `Open this server's alert history (Alerts then All) and look at the fired timestamps for ${finding.resource.name}: a steady cadence points to an idle or power-management cycle, irregular bursts to a real intermittent fault.`,
      `Check whether each fire coincides with the host being idle versus under load (for GPU rules, idle ASPM link downshift and power-capping are expected and harmless).`,
    ];
  }
  return [`Review ${kind} ${dev} in the dashboard`];
}

function getDefaultActionsFor(finding: Finding): string[] {
  if (finding.type.startsWith("smart_")) {
    return [
      `Confirm before acting: run sudo smartctl -a and check whether the flagged attribute is still climbing and whether reallocated or uncorrectable counts are growing (a flat count across batches usually means it was remapped or transient).`,
      `Back up and schedule replacement only if it keeps climbing or the kernel log shows read/write errors; otherwise keep trending it.`,
    ];
  }
  if (finding.type === "nvme_critical_warning") {
    return [
      `Back up critical data on this device: an NVMe critical_warning bit is an authoritative controller signal, not a soft trend.`,
      `Confirm with sudo nvme smart-log and plan replacement; a set critical_warning bit does not clear on its own.`,
    ];
  }
  if (finding.type === "drive_disappeared") {
    return [
      `Confirm before acting: if the disk was pulled on purpose (hot-swap, decommission, re-cabling), dismiss this warning; telemetry cannot tell an intentional removal from a fault.`,
      `If it was NOT expected, reseat the drive and its cabling/backplane and re-check enumeration; an unplanned de-enumeration is usually a failed disk, a loose connection, or a controller/backplane fault, and (unlike a RAID member drop) nothing else will alert on it.`,
    ];
  }
  if (finding.type === "disk_fill_imminent") {
    return [
      `Reclaim space immediately or expand the volume`,
      `Identify the largest growing directories with du`,
    ];
  }
  if (finding.type === "disk_fill_projection") {
    return [
      `Plan volume expansion or cleanup within the projected window`,
    ];
  }
  if (finding.type === "ecc_ce_burst" || finding.type === "ecc_ce_accelerating") {
    return [
      `Confirm before acting: these are correctable errors (handled by ECC and often transient). Verify they are isolated to one DIMM and that no uncorrectable (UE) errors have appeared before treating it as failing hardware.`,
      `Reseat or replace the flagged DIMM at the next maintenance window only if the bursts persist on the same DIMM or any uncorrectable error appears.`,
    ];
  }
  if (finding.type === "psu_rail_out_of_spec") {
    return [
      `Verify PSU health via IPMI and prepare a redundant PSU swap if supported`,
    ];
  }
  if (finding.type === "host_instability") {
    return [
      `Treat as suspect hardware: correlate the crash timestamps with the BMC event log for power, voltage, or thermal faults`,
      `If the crashes recur with no software cause, schedule proactive replacement or migrate workloads off this host before it fails permanently`,
    ];
  }
  if (finding.type === "host_reporting_gaps") {
    return [
      `The host stayed powered (uptime kept climbing), so this is lost visibility, not failing hardware: check the agent and the network path first`,
      `If the agent is crashing or restarting, capture its logs and restart or upgrade it; if egress is the problem, confirm outbound 443 to app.glassmkr.com`,
    ];
  }
  if (finding.type === "psu_rail_voltage_drift") {
    return [
      `Keep trending the rail; a continued walk away from baseline points to ageing PSU or VRM capacitors`,
      `If the drift accelerates or the rail nears the +/-5% spec edge, plan a PSU (or board, for an on-board rail) replacement before it fails`,
    ];
  }
  if (finding.type === "fan_rpm_decline") {
    return [
      `Inspect fan for obstructions and prepare a replacement`,
    ];
  }
  if (finding.type === "nic_errors") {
    return [
      `Inspect the cable, port, and transceiver on the affected interface`,
    ];
  }
  if (finding.type === "alert_flapping") {
    return [
      `If the condition is expected for this host type (e.g. a marketplace GPU box idling), apply the marketplace_gpu host profile or mute ${finding.resource.name} to stop the recurring noise.`,
      `If it is a genuine intermittent fault, treat the recurrence itself (not any single fire) as the signal and investigate the underlying component.`,
    ];
  }
  return [`Investigate the affected resource and verify with the recommended checks`];
}
