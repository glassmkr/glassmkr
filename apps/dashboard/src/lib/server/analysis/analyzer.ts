import { clickhouse } from "@glassmkr/db/clickhouse";

export interface AnalysisResult {
  summary: string;
  findings: Finding[];
  optimizations: string[];
  recommendations: string[];
  risk_level: "healthy" | "watch" | "warning" | "critical";
  generated_at: string;
}

interface Finding {
  category: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  urgency: "immediate" | "scheduled" | "informational";
  trend?: string;
  // Exact alert_type of the active alert this finding corresponds to, or
  // null. The UI links it to the alert row, whose curated FIX content is the
  // remediation authority. The analysis itself never carries commands: the
  // 2026-07-03 reposition dropped the old `command` field because a
  // general-purpose model emitting fixes next to tested per-distro
  // remediation was worse than linking to it.
  related_alert_type?: string | null;
  recommendation?: string;
  safety_warning?: string;
}

export interface ActiveAlertInput {
  alert_type?: string;
  severity: string;
  title: string;
  message: string;
}

// Extra context beyond the snapshot pair: the signals the alert rules cannot
// see in one place. Both optional; the analysis degrades to snapshot+alerts
// when a fetch fails.
export interface AnalysisContext {
  trendWarnings?: Array<Record<string, unknown>>;
  alertHistory?: Array<Record<string, unknown>>;
}

const LLM_URL = process.env.LLM_API_URL || "";
const LLM_MODEL = process.env.LLM_MODEL || "gemma-4-26b-a4b";

export function isLlmConfigured(): boolean {
  return !!LLM_URL;
}

const SYSTEM_PROMPT = `You are a senior bare metal server operations engineer writing a second-opinion health review of one server. Automated alert rules and trend warnings already exist and carry curated, tested remediation. Your job is ONLY the analysis they cannot do: cross-signal correlation, noise-vs-signal classification, sub-threshold observations, utilization framing, and trajectory over time.

You have: the current snapshot (CPU aggregate + per-core, RAM, swap, disks, SMART, network, RAID, IPMI sensors, security posture, ZFS, NTP, systemd, conntrack, file descriptors), the previous snapshot, the active alerts (each with its alert_type), the active trend warnings (slow-burn hardware signals from a deterministic detector), and a 7-day alert history summary (fired counts by type).

## Output structure

1. **summary** (required): 3-4 sentences. Overall utilization context (idle, moderate, or overloaded), the most important finding, whether action is needed now. A senior sysadmin's quick take, not a list of alerts.

2. **findings** (required): per-issue cards. For EACH finding:
   - "urgency": action needed NOW ("immediate"), can wait for a maintenance window ("scheduled"), or context only ("informational").
   - If it corresponds to an active alert, set "related_alert_type" to that alert's exact alert_type from the provided list, and add ONLY context the alert does not have: correlation with other signals, noise classification, trajectory, utilization perspective. Do not restate the alert or its remediation.
   - NEVER include shell commands or step-by-step fixes anywhere in your output. Remediation lives with the alert rules, which carry tested per-distro fix content; your job is judgment, not runbooks.
   - "recommendation" (optional): one strategic prose sentence, no commands. Examples: "combine the reboot with the pending kernel update in one maintenance window"; "treat as boot-time noise unless it recurs on the next snapshots".

3. **optimizations** (optional array of strings): only when the data clearly supports it (sustained underutilization, oversized disks). Do not pad with generic advice. Omit the array entirely if nothing applies.

## Safety warnings

When a recommendation implies a risky operation (SSH or firewall config changes, network interface changes, disk or partition operations, kernel changes, service restarts), include a "safety_warning": one concise, specific caution (for example: firewall changes applied over SSH need a timed revert; verify key auth from a second session before touching sshd). Not generic boilerplate.

## Analysis quality rules

- Be specific. Reference actual numbers, device names, interface names from the data.
- Classify noise vs signal. Drops on a bonded interface with an active firewall are firewall blocks, not hardware problems; boot-time counter noise is not a fault. Say so explicitly.
- Distinguish transient from persistent, and use the 7-day history: an alert type that fired many times this week is flapping or recurring; call that out.
- Correlate findings. If several signals share one root cause, write one finding, not three.
- Use the trend warnings for trajectory. If a trend warning already covers a component, reference it rather than re-deriving it.
- Check for single-core saturation in per-core CPU data (one core near 100% while others idle).
- When comparing to the previous snapshot, note trends (improving, stable, or degrading).
- If everything looks healthy, say so briefly with utilization context. Do not invent problems.
- Never use em-dashes. Use commas, semicolons, colons, or periods.
- risk_level: "healthy" (no issues), "watch" (minor items, no action needed), "warning" (action needed soon), "critical" (action needed now).

## Response format

Respond ONLY with valid JSON. No markdown fences, no explanation outside the JSON.

{
  "summary": "string (3-4 sentences)",
  "findings": [
    {
      "category": "string",
      "title": "string",
      "detail": "string (contextual analysis, not alert restatement)",
      "severity": "info|warning|critical",
      "urgency": "immediate|scheduled|informational",
      "trend": "stable|improving|degrading",
      "related_alert_type": "string or null (exact alert_type from the active alerts list when this finding corresponds to one)",
      "recommendation": "string (optional, strategic prose, no commands)",
      "safety_warning": "string (optional, required for risky recommendations)"
    }
  ],
  "optimizations": ["string (optional)"],
  "risk_level": "healthy|watch|warning|critical"
}`;

// Serialize calls to the LLM. There is one self-hosted Gemma instance on a
// single L4 GPU, so firing several analyses at once (e.g. "analyze" clicked on
// 3 servers) only contends for it. Running one at a time (FIFO) keeps each
// request isolated, which is the safe behavior for a single-slot llama-server,
// and avoids holding several 120s sockets open at once. A failed call does not
// stall the queue. Caveat: this serializes within one Node process only; if the
// dashboard ever runs multiple workers, requests on different workers can still
// race, so the per-request prompt is also capped (buildAnalysisPrompt) to fit
// the context window on its own.
let llmQueue: Promise<unknown> = Promise.resolve();
function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = llmQueue.then(fn, fn);
  llmQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function analyzeServerHealth(
  currentSnapshot: Record<string, unknown>,
  previousSnapshot: Record<string, unknown> | null,
  activeAlerts: ActiveAlertInput[],
  serverName: string,
  context: AnalysisContext = {}
): Promise<AnalysisResult> {
  const userPrompt = buildAnalysisPrompt(currentSnapshot, previousSnapshot, activeAlerts, serverName, context);

  const response = await runSerialized(() =>
    fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        // Output reservation. Kept well under the context window so the system
        // prompt + the (capped) snapshot + this all fit; the analysis JSON
        // fits comfortably in 3072.
        max_tokens: 3072,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(120000),
    })
  );

  const rawText = await response.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(rawText); } catch { throw new Error("LLM returned non-JSON: " + rawText.substring(0, 200)); }

  // llama.cpp returns an error object when the request exceeds context size
  if (data.error && typeof data.error === "object") {
    const err = data.error as { message?: string };
    throw new Error("LLM error: " + (err.message || JSON.stringify(data.error)));
  }

  const choices = data.choices as Array<{ message?: { content?: string; reasoning_content?: string } }> | undefined;
  const msg = choices?.[0]?.message;
  // Gemma 4 puts the response in reasoning_content with an empty content field.
  const content = msg?.content || msg?.reasoning_content;
  if (!content) throw new Error("Empty LLM response");

  const result = parseLlmResponse(content);
  sanitizeFindings(result, activeAlerts);
  result.generated_at = new Date().toISOString();
  return result;
}

/**
 * Post-parse guardrails, exported for tests. (1) Findings must never carry
 * commands: any `command`/`action` field the model emits despite the prompt
 * (old habit, prompt drift) is stripped, so the UI can never render model
 * remediation next to the alerts' curated FIX content. (2) related_alert_type
 * is grounded against the actual active set, so the UI never links to an
 * alert that is not firing.
 */
export function sanitizeFindings(result: AnalysisResult, activeAlerts: ActiveAlertInput[]): void {
  const activeTypes = new Set(activeAlerts.map((a) => a.alert_type).filter(Boolean));
  for (const f of result.findings) {
    const bag = f as unknown as Record<string, unknown>;
    delete bag.command;
    delete bag.action;
    if (f.related_alert_type != null && !activeTypes.has(f.related_alert_type)) {
      f.related_alert_type = null;
    }
  }
}

// Parse the LLM response content. Strips ```json fences if present and throws
// a descriptive error on garbage output.
export function parseLlmResponse(content: string): AnalysisResult {
  const cleaned = content.replace(/```json\n?|```\n?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM returned non-JSON content: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM response is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== "string") throw new Error("LLM response missing summary");
  if (!Array.isArray(obj.findings)) throw new Error("LLM response missing findings array");
  const validRisk = ["healthy", "watch", "warning", "critical"];
  if (typeof obj.risk_level !== "string" || !validRisk.includes(obj.risk_level)) {
    throw new Error(`LLM risk_level must be one of ${validRisk.join(", ")}`);
  }
  return {
    summary: obj.summary,
    findings: obj.findings as AnalysisResult["findings"],
    optimizations: Array.isArray(obj.optimizations) ? obj.optimizations as string[] : [],
    recommendations: Array.isArray(obj.recommendations) ? obj.recommendations as string[] : [],
    risk_level: obj.risk_level as AnalysisResult["risk_level"],
    generated_at: "",
  };
}

// Exposed for tests. Real callers go through analyzeServerHealth.
export { buildAnalysisPrompt };

function buildAnalysisPrompt(
  current: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  alerts: ActiveAlertInput[],
  serverName: string,
  context: AnalysisContext = {}
): string {
  let prompt = `Analyze the health of server "${serverName}".\n\nCurrent snapshot:\n`;
  // Compact (not pretty-printed) JSON, then capped. The system prompt + this
  // snapshot must fit the model's context window; a very large host (many
  // disks, full SMART attribute tables, long systemd unit lists) can otherwise
  // overflow it and llama.cpp returns "Context size has been exceeded". Pretty-
  // printing roughly doubled the size for no gain, so it is dropped. The fields
  // most worth the model's attention (cpu, memory, disks, smart, network, ipmi)
  // are serialized first so a truncation drops the least-critical tail
  // (systemd, file descriptors) first. Alerts are appended after the cap below
  // and are always included. The cap is sized for the documented single-slot
  // 16384-token llama-server (see docs/runbooks/llm-server-bringup.md): it
  // never trims a normal host, only a pathological one.
  let snapshotJson = JSON.stringify({
    cpu: current.cpu_user_percent != null ? {
      user: current.cpu_user_percent, system: current.cpu_system_percent,
      iowait: current.cpu_iowait_percent, load_1m: current.load_1m
    } : current.cpu,
    memory: current.ram_used_mb != null ? {
      used_mb: current.ram_used_mb, total_mb: current.ram_total_mb,
      swap_used_mb: current.swap_used_mb
    } : current.memory,
    disks: current.disks,
    smart: current.smart,
    network: current.network,
    ipmi: current.ipmi,
    os_alerts: current.os_alerts || { oom_kills: current.oom_kills_recent, zombies: current.zombie_processes },
    security: current.security,
    zfs: current.zfs,
    ntp: current.ntp,
    conntrack: current.conntrack,
    systemd: current.systemd,
    file_descriptors: current.file_descriptors,
  });
  const SNAPSHOT_CHAR_CAP = 16000;
  if (snapshotJson.length > SNAPSHOT_CHAR_CAP) {
    snapshotJson = snapshotJson.slice(0, SNAPSHOT_CHAR_CAP) + ' ...[truncated to fit the model context window]"}';
  }
  prompt += snapshotJson;

  if (previous) {
    prompt += `\n\nPrevious snapshot:\n`;
    prompt += JSON.stringify({
      cpu: { user: previous.cpu_user_percent, system: previous.cpu_system_percent, iowait: previous.cpu_iowait_percent },
      memory: { used_mb: previous.ram_used_mb, total_mb: previous.ram_total_mb },
    }, null, 2);
  }

  if (alerts.length > 0) {
    prompt += `\n\nActive alerts (${alerts.length}):\n`;
    for (const alert of alerts) {
      // alert_type included so the model can ground findings' related_alert_type.
      const typeTag = alert.alert_type ? ` alert_type=${alert.alert_type}` : "";
      prompt += `- [${alert.severity}]${typeTag} ${alert.title}: ${alert.message}\n`;
    }
  }

  // The two context blocks the rules cannot see in one place. Each gets its
  // own modest cap: they ride in the same 16k-token context window as the
  // snapshot and must never crowd it out.
  const trendWarnings = context.trendWarnings ?? [];
  if (trendWarnings.length > 0) {
    prompt += `\n\nActive trend warnings (${trendWarnings.length}) (slow-burn signals; detection is deterministic, reference rather than re-derive):\n`;
    let twJson = JSON.stringify(trendWarnings);
    if (twJson.length > 4000) twJson = twJson.slice(0, 4000) + ' ...[truncated]';
    prompt += twJson;
  }

  const alertHistory = context.alertHistory ?? [];
  if (alertHistory.length > 0) {
    prompt += `\n\nAlert history, last 7 days (fired counts by type; a high count means flapping or recurring):\n`;
    let ahJson = JSON.stringify(alertHistory);
    if (ahJson.length > 2000) ahJson = ahJson.slice(0, 2000) + ' ...[truncated]';
    prompt += ahJson;
  }

  return prompt;
}

export async function storeAnalysis(serverId: string, analysis: AnalysisResult, trigger: string): Promise<void> {
  await clickhouse.insert({
    table: "analyses",
    values: [{
      server_id: serverId,
      timestamp: Date.now(),
      summary: analysis.summary,
      findings: JSON.stringify(analysis.findings),
      recommendations: JSON.stringify(analysis.recommendations),
      risk_level: analysis.risk_level,
      trigger,
    }],
    format: "JSONEachRow",
  });
}

export async function getRecentAnalyses(serverId: string, limit = 10): Promise<AnalysisResult[]> {
  const result = await clickhouse.query({
    query: `SELECT * FROM analyses WHERE server_id = {server_id:String} ORDER BY timestamp DESC LIMIT {limit:UInt32}`,
    query_params: { server_id: serverId, limit },
    format: "JSONEachRow",
  });
  const rows: any[] = await result.json();
  return rows.map((r) => ({
    summary: r.summary,
    findings: typeof r.findings === "string" && r.findings ? JSON.parse(r.findings) : r.findings || [],
    optimizations: [],
    recommendations: typeof r.recommendations === "string" && r.recommendations ? JSON.parse(r.recommendations) : r.recommendations || [],
    risk_level: r.risk_level,
    generated_at: r.timestamp,
  }));
}
