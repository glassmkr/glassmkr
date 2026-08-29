<script lang="ts">
  import { api } from "$lib/utils/api";
  import { getToasts } from "$lib/stores/toast.svelte";
  import { onDestroy } from "svelte";

  interface Props {
    serverId: string;
    plan: string;
    freeAnalysisUsed?: boolean;
    isDemo?: boolean;
  }

  let { serverId, plan, freeAnalysisUsed = false, isDemo = false }: Props = $props();
  const toast = getToasts();

  let analyzing = $state(false);
  // Human-readable queue state shown while an analysis is in flight, e.g.
  // "Queued: 2 ahead, ~50s" or "Analyzing...". Empty when idle.
  let queueMsg = $state("");
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let result = $state<any>(null);
  let loadingLatest = $state(true);
  // svelte-ignore state_referenced_locally

  // P0-03 resolution, 2026-08-29: hosted has no paid tier, so the
  // one-free-analysis meter and its upgrade prompt are retired. The only gate
  // left is the demo: running an analysis is a POST, which 403s for the shared
  // read-only demo tenant, so the button stays disabled there rather than
  // offering an action whose only possible outcome is an error toast.
  let canAnalyze = $derived(!isDemo);

  // Only treat `result` as an analysis if it carries a recognizable field.
  // Guards against a non-analysis object rendering as a phantom "UNKNOWN"
  // result, e.g. a stale client bundle that mistook the queue-handle POST
  // response ({ job_id, status, ... }) for an analysis across a deploy.
  let hasAnalysis = $derived(
    !!result &&
      (result.summary != null ||
        result.findings != null ||
        result.risk_level != null ||
        result.generated_at != null)
  );

  const riskColors: Record<string, string> = {
    healthy: "green", watch: "blue", warning: "yellow", critical: "red",
    low: "green", medium: "yellow", high: "red",
  };

  function riskColor(level: string): string {
    return riskColors[level?.toLowerCase()] ?? "green";
  }

  // Severity -> CSS colour for the finding's status dot + left edge. Replaces
  // the old emoji icons (which read as dated next to the rest of the UI).
  function sevColor(sev: string): string {
    switch (sev?.toLowerCase()) {
      case "critical": case "high": return "var(--red)";
      case "warning": case "medium": return "var(--yellow)";
      default: return "var(--blue)";
    }
  }

  function parseField(val: any): any[] {
    if (!val) return [];
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return []; }
    }
    if (Array.isArray(val)) return val;
    return [];
  }

  async function loadLatest() {
    try {
      const data: any = await api(`/api/v1/servers/${serverId}/analyses?limit=1`);
      const analyses = data.analyses ?? [];
      if (analyses.length > 0) {
        result = analyses[0];
      }
    } catch {
      // No analyses yet, that's fine
    } finally {
      loadingLatest = false;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  // Format the queue label from a status payload (POST or poll response).
  function queueLabel(s: { status?: string; position?: number; estimated_seconds?: number }): string {
    if (s.status === "running") return "Analyzing...";
    if ((s.position ?? 0) > 0) {
      const eta = s.estimated_seconds ? `, ~${s.estimated_seconds}s` : "";
      return `Queued: ${s.position} ahead${eta}`;
    }
    return "Queued, starting shortly";
  }

  // Poll the job until it finishes. There is one shared GPU, so a job may wait
  // behind others; this surfaces the wait (position + ETA) instead of the old
  // silent hold-open request. Runs until done/error or the component unmounts.
  async function pollJob(jobId: string) {
    try {
      const s: any = await api(`/api/v1/servers/${serverId}/analyze?job_id=${encodeURIComponent(jobId)}`);
      if (s.status === "queued" || s.status === "running") {
        queueMsg = queueLabel(s);
        pollTimer = setTimeout(() => pollJob(jobId), 2500);
      } else if (s.status === "done") {
        stopPolling();
        analyzing = false;
        queueMsg = "";
        await loadLatest();
        toast.show("Analysis complete", "success");
      } else {
        // error
        stopPolling();
        analyzing = false;
        queueMsg = "";
        toast.show(s.error || "Analysis failed", "error");
      }
    } catch (err: any) {
      // Job pruned (404) or a transient network error: stop and surface it
      // rather than spinning forever.
      stopPolling();
      analyzing = false;
      queueMsg = "";
      toast.show(err.message || "Lost track of the analysis", "error");
    }
  }

  async function runAnalysis() {
    analyzing = true;
    queueMsg = "Queued...";
    try {
      const data: any = await api(`/api/v1/servers/${serverId}/analyze`, {
        method: "POST",
      });
      if (data.job_id) {
        // Async (session) path: poll the queue for progress.
        queueMsg = queueLabel(data);
        pollJob(data.job_id);
      } else if (data.analysis) {
        // Synchronous fallback (should not happen for a session caller).
        result = data.analysis;
        analyzing = false;
        queueMsg = "";
        toast.show("Analysis complete", "success");
      } else {
        // Unexpected shape: do not leave the button stuck spinning.
        analyzing = false;
        queueMsg = "";
        toast.show("Analysis could not be started", "error");
      }
    } catch (err: any) {
      analyzing = false;
      queueMsg = "";
      toast.show(err.message || "Analysis failed", "error");
    }
  }

  $effect(() => {
    if (serverId) loadLatest();
  });

  onDestroy(stopPolling);
</script>

<!-- Flat section, matching its siblings (Security Posture, IPMI). No .card
     wrapper: AI Analysis is not a highlighted block, just another section. -->
<div class="analysis-panel">
  <h3>AI Analysis</h3>

  {#if loadingLatest}
    <p class="muted">Loading analysis...</p>
  {:else if hasAnalysis}
    <div class="result">
      <div class="risk-header">
        <span class="tag tag-{riskColor(result.risk_level)}">
          {(result.risk_level || "unknown").toUpperCase()}
        </span>
        {#if result.timestamp || result.generated_at}
          <span class="analysis-time">
            {new Date(result.timestamp || result.generated_at).toLocaleString()}
          </span>
        {/if}
      </div>

      {#if result.summary}
        <p class="summary">{result.summary}</p>
      {/if}

      {#each parseField(result.findings) as finding}
        <div class="finding" style="--sev:{sevColor(finding.severity ?? 'info')}">
          <span class="sev-dot"></span>
          <div class="finding-content">
            <div class="finding-header">
              <strong>{finding.title ?? "Finding"}</strong>
              {#if finding.urgency}
                <span class="urgency urgency-{finding.urgency}">{finding.urgency}</span>
              {/if}
              {#if finding.trend}
                <span class="trend">({finding.trend})</span>
              {/if}
            </div>
            {#if finding.detail}
              <p class="finding-detail">{finding.detail}</p>
            {/if}
            {#if finding.safety_warning}
              <div class="safety-warning">
                <span class="safety-icon">&#9888;&#65039;</span>
                <span>{finding.safety_warning}</span>
              </div>
            {/if}
            {#if finding.related_alert_type}
              <!-- Remediation authority stays with the alert's curated FIX
                   content; the analysis links there instead of emitting its
                   own commands (2026-07-03 reposition). -->
              <a class="rel-alert" href="#alerts">
                Covered by the <code>{finding.related_alert_type}</code> alert; see its remediation &uarr;
              </a>
            {/if}
            {#if finding.recommendation}
              <div class="finding-tip">
                <span class="tip-label">TIP</span> {finding.recommendation}
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if parseField(result.optimizations).length > 0}
        <div class="optimizations">
          <h4>Optimization suggestions</h4>
          <ul>
            {#each parseField(result.optimizations) as opt}
              <li>{typeof opt === "string" ? opt : JSON.stringify(opt)}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each parseField(result.recommendations) as rec}
        <div class="rec-item">
          <p>{typeof rec === "string" ? rec : rec.text ?? JSON.stringify(rec)}</p>
        </div>
      {/each}

      {#if canAnalyze}
        <button class="btn btn-small mt-2" onclick={runAnalysis} disabled={analyzing} aria-busy={analyzing}>
          {analyzing ? "Working..." : "Re-analyze"}
        </button>
        {#if analyzing && queueMsg}
          <p class="queue-status">{queueMsg}</p>
        {/if}
      {:else if isDemo}
        <p class="analysis-note mt-2">Re-running an analysis is disabled in the read-only demo. This is a captured result.</p>
      {/if}
    </div>
  {:else}
    {#if canAnalyze}
      <p class="muted">Run an AI analysis to get health insights and recommendations for this server.</p>
      <button class="btn mt-2" onclick={runAnalysis} disabled={analyzing} aria-busy={analyzing}>
        {analyzing ? "Working..." : "Analyze Now"}
      </button>
      {#if analyzing && queueMsg}
        <p class="queue-status">{queueMsg}</p>
      {/if}
    {:else if isDemo}
      <p class="muted">AI analysis reads this host's recent snapshots and returns findings and recommendations. Running one is disabled in the read-only demo; other hosts in this sample carry a captured result you can read.</p>
    {/if}
  {/if}
</div>

<style>
  h3 { font-size: 16px; font-weight: 600; margin-bottom: 14px; }
  .upgrade-prompt { text-align: center; padding: 20px 0; font-size: 13px; color: var(--text-secondary); }
  .risk-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .analysis-time { font-size: 12px; color: var(--text-tertiary); }
  /* Live queue/progress line under the button while an analysis is in flight. */
  .queue-status { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; }
  .summary { font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6; }
  .finding {
    display: flex; gap: 10px; padding: 12px 14px; margin-bottom: 10px;
    background: var(--surface); border: 1px solid var(--surface-border);
    border-left: 3px solid var(--sev, var(--surface-border)); border-radius: 4px;
  }
  .sev-dot {
    flex-shrink: 0; width: 9px; height: 9px; border-radius: 50%;
    margin-top: 5px; background: var(--sev, var(--blue));
  }
  .finding-content { flex: 1; min-width: 0; }
  .finding-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .finding strong { font-size: 13px; }
  .urgency { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 2px; background: var(--elevated); color: var(--text-tertiary); }
  .urgency-immediate { background: rgba(229, 86, 75, 0.15); color: var(--red); }
  .urgency-scheduled { background: rgba(224, 169, 59, 0.15); color: var(--yellow); }
  .urgency-informational { background: rgba(59, 130, 246, 0.15); color: var(--blue); }
  .trend { font-size: 12px; color: var(--text-tertiary); }
  .safety-warning {
    display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; padding: 8px 12px;
    background: rgba(229, 86, 75, 0.08); border: 1px solid rgba(229, 86, 75, 0.25); border-radius: 4px;
    font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  }
  .safety-icon { flex-shrink: 0; font-size: 14px; }
  .finding-detail { font-size: 13px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.5; }
  /* Finding maps to a firing alert: link to that alert's curated remediation
     rather than emitting a command here (2026-07-03 reposition). */
  .rel-alert {
    display: inline-flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
    margin-top: 8px; font-size: 12px; color: var(--text-secondary);
    text-decoration: none; line-height: 1.5;
  }
  .rel-alert:hover { color: var(--text-primary); }
  .rel-alert code {
    font-size: 12px; padding: 1px 6px; border-radius: 4px;
    background: var(--elevated); color: var(--accent);
  }
  .finding-tip {
    margin-top: 6px; padding: 8px 12px; font-size: 12px; color: var(--text-tertiary);
    line-height: 1.5; border-left: 2px solid var(--accent);
  }
  .tip-label { color: var(--accent); font-size: 12px; font-weight: 600; }
  .rec-item { margin-bottom: 10px; padding-left: 12px; border-left: 2px solid var(--surface-border); }
  .rec-item p { font-size: 13px; color: var(--text-secondary); }
  .muted { font-size: 13px; color: var(--text-tertiary); }
  .analysis-note { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; }
  .analysis-upgrade {
    text-align: center;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
  }
  .analysis-upgrade p { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
  .optimizations { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--surface-border); }
  .optimizations h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); margin-bottom: 8px; }
  .optimizations ul { list-style: none; padding: 0; margin: 0; }
  .optimizations li { font-size: 13px; color: var(--text-secondary); padding: 4px 0 4px 16px; position: relative; line-height: 1.5; }
  .optimizations li::before { content: "\2192"; position: absolute; left: 0; color: var(--accent); }
</style>
