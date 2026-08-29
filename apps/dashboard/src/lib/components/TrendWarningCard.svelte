<script lang="ts">
  import { api } from "$lib/utils/api";
  import { getToasts } from "$lib/stores/toast.svelte";
  import { timeAgo } from "$lib/utils/time";

  interface Narration {
    headline: string;
    evidence_summary: string;
    uncertainty_statement: string;
    recommended_checks: string[];
    recommended_actions: string[];
  }

  interface Warning {
    id: number;
    server_id: string;
    warning_type: string;
    resource_identifier: string;
    severity: "high" | "medium";
    urgency_tier: "imminent" | "soon" | "scheduled" | "watch";
    correlation_match: string | null;
    tree_ranker_score: number | null;
    contributing_metrics: any;
    evidence_summary: string;
    narration: Narration | string | null;
    projected_timeline: string | null;
    first_detected_at: string;
    last_updated_at: string;
    notified_at: string | null;
    user_feedback: string | null;
  }

  interface Props {
    warning: Warning;
    oncancel?: () => void;
    onfeedback?: () => void;
    isDemo?: boolean;
  }

  let { warning, oncancel, onfeedback, isDemo = false }: Props = $props();
  const toast = getToasts();
  let busy = $state(false);

  function parseNarration(n: any): Narration | null {
    if (!n) return null;
    if (typeof n === "string") {
      try { return JSON.parse(n); } catch { return null; }
    }
    return n;
  }

  let narration = $derived(parseNarration(warning.narration));

  let metrics = $derived.by(() => {
    const m = warning.contributing_metrics;
    if (!m) return [];
    if (typeof m === "string") { try { return JSON.parse(m); } catch { return []; } }
    return m;
  });

  let tierLabel = $derived(({
    imminent: "Imminent",
    soon: "Soon",
    scheduled: "Scheduled",
    watch: "Watch",
  } as const)[warning.urgency_tier]);

  async function submitFeedback(value: "valuable" | "false_positive") {
    if (busy) return;
    busy = true;
    try {
      await api(`/api/v1/trend-warnings/${warning.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback: value }),
      });
      toast.show(
        value === "valuable" ? "Marked as valuable" : "Marked as false positive",
        "success"
      );
      onfeedback?.();
    } catch (err: any) {
      toast.show(err?.message || "Failed to submit feedback", "error");
    } finally {
      busy = false;
    }
  }

  async function dismiss() {
    if (busy) return;
    if (!confirm("Dismiss this warning?")) return;
    busy = true;
    try {
      await api(`/api/v1/trend-warnings/${warning.id}/feedback`, { method: "DELETE" });
      toast.show("Warning dismissed", "success");
      oncancel?.();
    } catch (err: any) {
      toast.show(err?.message || "Failed to dismiss", "error");
    } finally {
      busy = false;
    }
  }
</script>

<article class="tw-card tier-{warning.urgency_tier}" id="warning-{warning.id}">
  <header class="tw-header">
    <div class="tw-tier-row">
      <span class="tw-tier tw-tier-{warning.urgency_tier}">{tierLabel}</span>
      <span class="tw-severity">{warning.severity}</span>
      {#if warning.correlation_match}
        <span class="tw-corr">Correlation: {warning.correlation_match}</span>
      {:else}
        <span class="tw-corr tw-corr-none">Single signal</span>
      {/if}
    </div>
    <h3 class="tw-headline">{narration?.headline ?? warning.warning_type.replace(/_/g, " ")}</h3>
    <div class="tw-meta">
      <span>{warning.resource_identifier}</span>
      <span>&middot;</span>
      <span>First detected {timeAgo(warning.first_detected_at)}</span>
      {#if warning.projected_timeline}
        <span>&middot;</span>
        <span>Projected: {warning.projected_timeline}</span>
      {/if}
    </div>
  </header>

  <section class="tw-body">
    <p class="tw-summary">{narration?.evidence_summary ?? warning.evidence_summary}</p>

    {#if narration?.uncertainty_statement}
      <p class="tw-uncertainty">
        <strong>Important context:</strong> {narration.uncertainty_statement}
      </p>
    {/if}

    {#if metrics.length > 0}
      <div class="tw-metrics">
        {#each metrics as m}
          <div class="tw-metric">
            <span class="tw-metric-name">{m.name}</span>
            <span class="tw-metric-value">{m.current}</span>
            {#if m.window === "current"}
              <!-- Point-in-time deviation metric (e.g. psu_rail_out_of_spec):
                   no meaningful 7-day delta, so show the nominal baseline
                   instead of a misleading "7d +0" badge. -->
              <span class="tw-metric-delta">nominal {m.baseline}</span>
            {:else if m.delta_7d !== undefined}
              <span class="tw-metric-delta" class:pos={m.delta_7d > 0} class:neg={m.delta_7d < 0}>
                7d {m.delta_7d >= 0 ? "+" : ""}{m.delta_7d}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if narration?.recommended_checks && narration.recommended_checks.length > 0}
      <div class="tw-list">
        <h4>Next checks</h4>
        <ul>
          {#each narration.recommended_checks as c}
            <li><code>{c}</code></li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if narration?.recommended_actions && narration.recommended_actions.length > 0}
      <div class="tw-list">
        <h4>Recommended actions</h4>
        <ul>
          {#each narration.recommended_actions as a}
            <li>{a}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  <footer class="tw-footer">
    {#if warning.user_feedback}
      <span class="tw-feedback-tag">
        Feedback: {warning.user_feedback === "valuable" ? "Valuable" : "False positive"}
      </span>
    {:else if isDemo}
      <!-- Rating and dismissing are writes, so they 403 for the shared
           read-only demo tenant. Say what the controls would do instead of
           offering three buttons that can only produce an error toast. -->
      <span class="tw-demo-note">
        In your own account you would rate this warning valuable or a false
        positive, which feeds the precision tally, or dismiss it. Those are
        disabled in the read-only demo.
      </span>
    {:else}
      <button class="btn btn-small" disabled={busy} onclick={() => submitFeedback("valuable")}>
        Mark valuable
      </button>
      <button class="btn btn-small" disabled={busy} onclick={() => submitFeedback("false_positive")}>
        False positive
      </button>
    {/if}
    {#if !isDemo}
      <button class="btn btn-small btn-ghost" disabled={busy} onclick={dismiss}>Dismiss</button>
    {/if}
  </footer>
</article>

<style>
  .tw-demo-note { font-size: 13px; color: var(--text-tertiary); line-height: 1.55; max-width: 68ch; }
  .tw-card {
    background: #121417;
    border: 1px solid #313742;
    border-left-width: 4px;
    border-radius: 4px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .tw-card.tier-imminent { border-left-color: #E5564B; }
  .tw-card.tier-soon { border-left-color: #E0A93B; }
  .tw-card.tier-scheduled { border-left-color: #3B82F6; }
  /* The same value as the hardcoded hex that used to be here, taken from the
     token that owns it. */
  .tw-card.tier-watch { border-left-color: var(--status-offline); opacity: 0.85; }

  .tw-tier-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .tw-tier {
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
  }
  .tw-tier-imminent  { color: #E5564B; background: #2A1517; }
  .tw-tier-soon      { color: #E0A93B; background: #2A2412; }
  .tw-tier-scheduled { color: #3B82F6; background: #111726; }
  .tw-tier-watch     { color: #A2A9B4; background: #181B1F; }
  .tw-severity {
    color: #F5A623;
    font-weight: 600;
  }
  .tw-corr {
    color: #A2A9B4;
    font-weight: 500;
  }
  .tw-corr-none {
    color: var(--text-tertiary);
  }
  .tw-headline {
    font-size: 16px;
    font-weight: 600;
    color: #ECEEF1;
    margin: 4px 0 6px;
  }
  .tw-meta {
    display: flex;
    gap: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .tw-body {
    margin-top: 12px;
  }
  .tw-summary {
    color: #ECEEF1;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .tw-uncertainty {
    color: #A2A9B4;
    font-size: 13px;
    line-height: 1.55;
    border-left: 2px solid #313742;
    padding-left: 12px;
    margin: 0 0 12px;
    font-style: italic;
  }
  .tw-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .tw-metric {
    background: #0B0C0E;
    border: 1px solid #313742;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .tw-metric-name { color: #A2A9B4; }
  .tw-metric-value { color: #ECEEF1; font-weight: 600; }
  .tw-metric-delta { color: var(--text-tertiary); }
  .tw-metric-delta.pos { color: #E5564B; }
  .tw-metric-delta.neg { color: #46B98A; }

  .tw-list { margin-bottom: 12px; }
  .tw-list h4 {
    font-size: 12px;
    font-weight: 600;
    color: #A2A9B4;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 6px;
  }
  .tw-list ul {
    margin: 0;
    padding-left: 18px;
    color: #ECEEF1;
    font-size: 13px;
    line-height: 1.6;
  }
  .tw-list code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: #ECEEF1;
  }
  .tw-footer {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #313742;
  }
  .tw-feedback-tag {
    color: #A2A9B4;
    font-size: 12px;
    font-style: italic;
  }
</style>
