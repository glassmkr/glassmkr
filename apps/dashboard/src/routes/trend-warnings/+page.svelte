<script lang="ts">
  import { URGENCY_TIERS, URGENCY_BASIS } from "$lib/trend-urgency";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { api } from "$lib/utils/api";
  import { timeAgo } from "$lib/utils/time";
  import { toServerSlug } from "$lib/utils/server-slug";
  import { getToasts } from "$lib/stores/toast.svelte";

  const toast = getToasts();
  let customer = $derived($page.data.customer);
  // Read-only demo tenant: feedback/restore mutations are blocked
  // server-side, so hide the per-row action buttons.
  let isDemo = $derived(customer?.isDemo === true);

  // Tab state. URL-sync via ?tab=... for deep linking.
  // 2026-05-20: added "acknowledged" tab so operators can review
  // previously-dismissed warnings (the old "Dismiss" button buried
  // them with no way back to inspect what was acted on).
  // 2026-05-21: added "pending-feedback" tab so the "N pending your
  // feedback" count in settings has a reachable surface; previously
  // those warnings were invisible if also resolved (issue raised).
  let activeTab = $state<
    "active" | "pending-feedback" | "acknowledged" | "track-record"
  >("active");

  // -------- Active Warnings data --------
  // Schema correction 2026-05-21: the trend_warnings table has
  // `warning_type` (e.g. smart_187_growing) and `evidence_summary`
  // (the LLM-narrated body), not `title` / `summary`. The prior
  // interface mis-typed the row and rendered blank cells; fixed
  // here + at the three render sites below to consume the real
  // columns. Title is humanised from warning_type at render time
  // (snake_case -> spaces); evidence_summary renders as the body
  // text. Matches the per-server TrendWarningCard rendering.
  interface ActiveWarning {
    id: string;
    server_id: string;
    server_name: string;
    server_hostname: string;
    warning_type: string;
    evidence_summary: string;
    urgency_tier: "imminent" | "soon" | "scheduled" | string;
    severity: string;
    first_detected_at: string;
    user_feedback: string | null;
    user_feedback_at: string | null;
    dismissed_at: string | null;
    // resolved_at is set when the daily evaluator marks the underlying
    // signal as no longer present (cross-snapshot recovery). On the
    // Pending feedback tab we use this to split rows into "live"
    // (still actionable; expanded by default) and "stale" (already
    // auto-cleared; collapsed by default + AUTO-CLEARED badge instead
    // of urgency_tier per Decision (c) 2026-05-21).
    resolved_at: string | null;
  }
  let activeWarnings = $state<ActiveWarning[]>([]);
  let loadingActive = $state(true);
  let activeError = $state<string | null>(null);

  // -------- Acknowledged Warnings data --------
  let acknowledgedWarnings = $state<ActiveWarning[]>([]);
  let loadingAcked = $state(true);
  let ackedError = $state<string | null>(null);

  // -------- Pending-feedback Warnings data (2026-05-21) --------
  // notified_at IS NOT NULL AND user_feedback IS NULL. Overlaps with
  // the other tabs; the point is to make the "N pending your feedback"
  // settings line clickable rather than dead text.
  let pendingWarnings = $state<ActiveWarning[]>([]);
  let loadingPending = $state(true);
  // Stale = notified + unrated + resolved_at IS NOT NULL. The
  // underlying signal already cleared; rating is optional. Collapsed
  // by default per Decision (c) 2026-05-21 so the operator focuses
  // on live unrated rows.
  let stalePendingExpanded = $state(false);
  let livePendingWarnings = $derived(
    pendingWarnings.filter((w) => !w.resolved_at),
  );
  let stalePendingWarnings = $derived(
    pendingWarnings.filter((w) => !!w.resolved_at),
  );
  let pendingError = $state<string | null>(null);

  // -------- Track Record data --------
  let trackRecord = $state<any>(null);
  let evaluations = $state<any>(null);
  let loadingTrack = $state(true);
  let trackError = $state<string | null>(null);

  // Shared fetch for the three status buckets (active / pending_feedback /
  // acknowledged); the per-bucket loaders below just thread state + a label.
  async function fetchWarnings(
    status: string,
    fallbackMsg: string,
  ): Promise<{ warnings: ActiveWarning[]; error: string | null }> {
    try {
      const r: any = await api(`/api/v1/trend-warnings/active?status=${status}`);
      return { warnings: (r.warnings ?? []) as ActiveWarning[], error: null };
    } catch (err: any) {
      return { warnings: [], error: err?.message ?? fallbackMsg };
    }
  }

  async function loadActive() {
    loadingActive = true;
    const r = await fetchWarnings("active", "Failed to load active warnings.");
    activeWarnings = r.warnings;
    activeError = r.error;
    loadingActive = false;
  }

  async function loadPending() {
    loadingPending = true;
    const r = await fetchWarnings(
      "pending_feedback",
      "Failed to load pending-feedback warnings.",
    );
    pendingWarnings = r.warnings;
    pendingError = r.error;
    loadingPending = false;
  }

  async function loadAcknowledged() {
    loadingAcked = true;
    const r = await fetchWarnings(
      "acknowledged",
      "Failed to load acknowledged warnings.",
    );
    acknowledgedWarnings = r.warnings;
    ackedError = r.error;
    loadingAcked = false;
  }

  async function loadTrackRecord() {
    loadingTrack = true;
    trackError = null;
    try {
      const [tr, ev] = await Promise.all([
        api("/api/v1/trend-warnings/track-record"),
        api("/api/v1/trend-warnings/evaluations"),
      ]);
      trackRecord = tr;
      evaluations = ev;
    } catch (err: any) {
      trackError = err?.message ?? "Failed to load track record.";
    } finally {
      loadingTrack = false;
    }
  }

  onMount(() => {
    // Honor ?tab=... on first load for deep linking.
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "track-record") activeTab = "track-record";
    else if (t === "acknowledged") activeTab = "acknowledged";
    else if (t === "pending-feedback") activeTab = "pending-feedback";
  });

  $effect(() => {
    if (customer) {
      loadActive();
      loadPending();
      loadAcknowledged();
      loadTrackRecord();
    }
  });

  function setTab(t: "active" | "pending-feedback" | "acknowledged" | "track-record") {
    activeTab = t;
    // Update URL without full navigation so deep links stay shareable.
    const url = new URL(window.location.href);
    if (t === "active") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    history.replaceState({}, "", url.toString());
  }

  // -------- Feedback actions (Confirm + Acknowledge) --------
  //
  // 2026-05-20: pre-fix the Confirm button POSTed user_feedback but
  // left dismissed_at NULL — the warning stayed in Active so from
  // the operator's view "Confirm did nothing". Dismiss DELETE'd the
  // row from Active but left no way to view what was dismissed.
  //
  // Post-fix both buttons go through POST /feedback which now also
  // sets dismissed_at = NOW(). The only difference between them is
  // which user_feedback value is recorded for track-record analytics:
  //   Confirm     -> feedback="valuable" (the alert mattered)
  //   Acknowledge -> feedback="false_positive" (not actionable / noise)
  // Both move the row from Active -> Acknowledged tab.
  async function ack(w: ActiveWarning, kind: "valuable" | "false_positive") {
    const label = kind === "valuable" ? "Confirmed" : "Acknowledged";
    try {
      await api(`/api/v1/trend-warnings/${w.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback: kind }),
      });
      toast.show(`${label}.`, "success");
      // Refresh all the lists; the warning leaves Active + Pending
      // and lands in Acknowledged. Track Record stat also moves.
      await Promise.all([loadActive(), loadPending(), loadAcknowledged(), loadTrackRecord()]);
    } catch (err: any) {
      toast.show(err?.message ?? "Action failed.", "error");
    }
  }

  // Restore an acknowledged warning back to Active. Clears
  // user_feedback + dismissed_at via POST {feedback: null}.
  async function unack(w: ActiveWarning) {
    try {
      await api(`/api/v1/trend-warnings/${w.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback: null }),
      });
      toast.show("Moved back to Active.", "success");
      await Promise.all([loadActive(), loadPending(), loadAcknowledged(), loadTrackRecord()]);
    } catch (err: any) {
      toast.show(err?.message ?? "Action failed.", "error");
    }
  }

  function urgencyClass(tier: string): string {
    if (tier === "imminent") return "urgency-imminent";
    if (tier === "soon") return "urgency-soon";
    if (tier === "scheduled") return "urgency-scheduled";
    return "urgency-other";
  }
</script>

<svelte:head>
  <title>Trend Warnings | Glassmkr Dashboard</title>
</svelte:head>

<div class="container">
  <h1 class="page-title">Trend Warnings</h1>
  <p class="page-desc">
    Early warning system for fleet-wide trends. Every host is evaluated
    {URGENCY_BASIS.cadence}, and warnings appear here when a signal keeps
    moving in the wrong direction.
  </p>

  <!-- The four urgency words appeared on every warning and were defined
       nowhere a user could read them. The definitions come from
       $lib/trend-urgency, which a unit test drives against the rule that
       assigns the tiers, so this legend cannot drift away from behaviour. -->
  <details class="basis">
    <summary>What these warnings are, and what the urgency words mean</summary>
    <div class="basis-body">
      <p>{URGENCY_BASIS.method}</p>
      <p>{URGENCY_BASIS.persistence}</p>
      <dl class="tier-legend">
        {#each URGENCY_TIERS as t}
          <div class="tier-legend-row">
            <dt><span class="tier-chip urgency-{t.tier}">{t.label}</span></dt>
            <dd>{t.meaning}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </details>

    <!-- Tab nav -->
    <nav class="tab-nav" aria-label="Trend warnings sections">
      <button
        class="tab"
        class:active={activeTab === "active"}
        onclick={() => setTab("active")}
        aria-current={activeTab === "active" ? "page" : undefined}
      >Active ({activeWarnings.length})</button>
      {#if pendingWarnings.length > 0}
        <button
          class="tab"
          class:active={activeTab === "pending-feedback"}
          onclick={() => setTab("pending-feedback")}
          aria-current={activeTab === "pending-feedback" ? "page" : undefined}
          title="Warnings the system notified you about but you haven't yet rated as valuable or false-positive. Count shows live unrated only; stale (auto-resolved) rows are collapsed inside the tab."
        >Pending feedback ({livePendingWarnings.length}{#if stalePendingWarnings.length > 0} + {stalePendingWarnings.length} stale{/if})</button>
      {/if}
      <button
        class="tab"
        class:active={activeTab === "acknowledged"}
        onclick={() => setTab("acknowledged")}
        aria-current={activeTab === "acknowledged" ? "page" : undefined}
      >Acknowledged ({acknowledgedWarnings.length})</button>
      <button
        class="tab"
        class:active={activeTab === "track-record"}
        onclick={() => setTab("track-record")}
        aria-current={activeTab === "track-record" ? "page" : undefined}
      >Track Record</button>
    </nav>

    {#if activeTab === "active"}
      <section class="section card">
        {#if loadingActive}
          <p class="muted">Loading active warnings...</p>
        {:else if activeError}
          <p class="error">Error: {activeError}</p>
        {:else if activeWarnings.length === 0}
          <div class="empty-state">
            <h3>No active warnings</h3>
            <p class="desc">
              Your fleet's signals are within normal thresholds. Evaluation
              continues {URGENCY_BASIS.cadence} and warnings appear here when
              patterns suggest emerging issues.
            </p>
          </div>
        {:else}
          <div class="warnings-table">
            <div class="warnings-row warnings-head">
              <div>Server</div>
              <div>Warning</div>
              <div>Urgency</div>
              <div>First seen</div>
              <div>Actions</div>
            </div>
            {#each activeWarnings as w (w.id)}
              <div class="warnings-row">
                <div class="cell-server">
                  <a
                    href={`/server/${toServerSlug({ hostname: w.server_hostname, name: w.server_name, id: w.server_id })}`}
                  >{w.server_name}</a>
                  {#if w.server_hostname && w.server_hostname !== w.server_name}
                    <span class="hostname">{w.server_hostname}</span>
                  {/if}
                </div>
                <div class="cell-title">
                  <strong>{w.warning_type.replace(/_/g, " ")}</strong>
                  {#if w.evidence_summary}<div class="summary">{w.evidence_summary}</div>{/if}
                </div>
                <div>
                  <span class={`urgency ${urgencyClass(w.urgency_tier)}`}>
                    {w.urgency_tier}
                  </span>
                </div>
                <div>{timeAgo(w.first_detected_at)}</div>
                <div class="cell-actions">
                  {#if !isDemo}
                    <button
                      class="btn btn-small"
                      onclick={() => ack(w, "valuable")}
                      title="Confirm this warning matters and move to Acknowledged"
                    >Confirm</button>
                    <button
                      class="btn btn-small"
                      onclick={() => ack(w, "false_positive")}
                      title="Acknowledge as not actionable (false positive); moves to Acknowledged"
                    >Acknowledge</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {:else if activeTab === "pending-feedback"}
      <section class="section card">
        <p class="desc" style="margin-bottom: 12px;">
          You were notified about these warnings; the system is still
          waiting for you to rate whether they were valuable or false
          positives. Rating them improves the precision estimate.
        </p>
        {#if loadingPending}
          <p class="muted">Loading pending-feedback warnings...</p>
        {:else if pendingError}
          <p class="error">Error: {pendingError}</p>
        {:else if pendingWarnings.length === 0}
          <div class="empty-state">
            <h3>Nothing awaiting your feedback</h3>
            <p class="desc">
              Every notified warning has been rated. Track Record's
              precision estimate is current.
            </p>
          </div>
        {:else}
          {#if livePendingWarnings.length > 0}
            <h3 class="subgroup-heading">Live ({livePendingWarnings.length})</h3>
            <p class="desc subgroup-desc">Still firing as of the last evaluation cycle. Rating is most informative on these.</p>
            <div class="warnings-table">
              <div class="warnings-row warnings-head">
                <div>Server</div>
                <div>Warning</div>
                <div>Urgency</div>
                <div>First seen</div>
                <div>Rate</div>
              </div>
              {#each livePendingWarnings as w (w.id)}
                <div class="warnings-row">
                  <div class="cell-server">
                    <a
                      href={`/server/${toServerSlug({ hostname: w.server_hostname, name: w.server_name, id: w.server_id })}`}
                    >{w.server_name}</a>
                    {#if w.server_hostname && w.server_hostname !== w.server_name}
                      <span class="hostname">{w.server_hostname}</span>
                    {/if}
                  </div>
                  <div class="cell-title">
                    <strong>{w.warning_type.replace(/_/g, " ")}</strong>
                    {#if w.evidence_summary}<div class="summary">{w.evidence_summary}</div>{/if}
                  </div>
                  <div>
                    <span class={`urgency ${urgencyClass(w.urgency_tier)}`}>
                      {w.urgency_tier}
                    </span>
                  </div>
                  <div>{timeAgo(w.first_detected_at)}</div>
                  <div class="cell-actions">
                    <button
                      class="btn btn-small"
                      onclick={() => ack(w, "valuable")}
                      title="Confirm this warning was valuable (preceded a real problem)"
                    >Valuable</button>
                    <button
                      class="btn btn-small"
                      onclick={() => ack(w, "false_positive")}
                      title="Mark as false positive (warning was not actionable)"
                    >False positive</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          {#if stalePendingWarnings.length > 0}
            <button
              type="button"
              class="stale-toggle"
              onclick={() => (stalePendingExpanded = !stalePendingExpanded)}
              aria-expanded={stalePendingExpanded}
            >
              <span class="caret">{stalePendingExpanded ? "▾" : "▸"}</span>
              Stale ({stalePendingWarnings.length}) — auto-resolved before you rated; rating is optional
            </button>
            {#if stalePendingExpanded}
              <p class="desc subgroup-desc">The underlying signal cleared on its own (the daily evaluator auto-resolved the warning). Rating these still helps calibrate precision but the warning is no longer actionable on the server.</p>
              <div class="warnings-table stale-table">
                <div class="warnings-row warnings-head">
                  <div>Server</div>
                  <div>Warning</div>
                  <div>State</div>
                  <div>First seen</div>
                  <div>Rate</div>
                </div>
                {#each stalePendingWarnings as w (w.id)}
                  <div class="warnings-row stale-row">
                    <div class="cell-server">
                      <a
                        href={`/server/${toServerSlug({ hostname: w.server_hostname, name: w.server_name, id: w.server_id })}`}
                      >{w.server_name}</a>
                      {#if w.server_hostname && w.server_hostname !== w.server_name}
                        <span class="hostname">{w.server_hostname}</span>
                      {/if}
                    </div>
                    <div class="cell-title">
                      <strong>{w.warning_type.replace(/_/g, " ")}</strong>
                      {#if w.evidence_summary}<div class="summary">{w.evidence_summary}</div>{/if}
                    </div>
                    <div>
                      <span class="urgency urgency-stale" title={`Auto-resolved ${w.resolved_at ? timeAgo(w.resolved_at) : ""}`}>
                        auto-cleared
                      </span>
                    </div>
                    <div>{timeAgo(w.first_detected_at)}</div>
                    <div class="cell-actions">
                      <button
                        class="btn btn-small"
                        onclick={() => ack(w, "valuable")}
                        title="Confirm this warning was valuable (preceded a real problem)"
                      >Valuable</button>
                      <button
                        class="btn btn-small"
                        onclick={() => ack(w, "false_positive")}
                        title="Mark as false positive (warning was not actionable)"
                      >False positive</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {/if}
      </section>
    {:else if activeTab === "acknowledged"}
      <section class="section card">
        {#if loadingAcked}
          <p class="muted">Loading acknowledged warnings...</p>
        {:else if ackedError}
          <p class="error">Error: {ackedError}</p>
        {:else if acknowledgedWarnings.length === 0}
          <div class="empty-state">
            <h3>No acknowledged warnings</h3>
            <p class="desc">
              Warnings you Confirm or Acknowledge from the Active tab
              land here. They stay until the daily evaluator marks them
              resolved (signal returned to normal).
            </p>
          </div>
        {:else}
          <div class="warnings-table">
            <div class="warnings-row warnings-head">
              <div>Server</div>
              <div>Warning</div>
              <div>Feedback</div>
              <div>Acknowledged</div>
              <div>Actions</div>
            </div>
            {#each acknowledgedWarnings as w (w.id)}
              <div class="warnings-row">
                <div class="cell-server">
                  <a
                    href={`/server/${toServerSlug({ hostname: w.server_hostname, name: w.server_name, id: w.server_id })}`}
                  >{w.server_name}</a>
                  {#if w.server_hostname && w.server_hostname !== w.server_name}
                    <span class="hostname">{w.server_hostname}</span>
                  {/if}
                </div>
                <div class="cell-title">
                  <strong>{w.warning_type.replace(/_/g, " ")}</strong>
                  {#if w.evidence_summary}<div class="summary">{w.evidence_summary}</div>{/if}
                </div>
                <div>
                  {#if w.user_feedback === "valuable"}
                    <span class="feedback-pill feedback-confirmed">Confirmed</span>
                  {:else if w.user_feedback === "false_positive"}
                    <span class="feedback-pill feedback-fp">False positive</span>
                  {:else}
                    <span class="feedback-pill">Acknowledged</span>
                  {/if}
                </div>
                <div>{w.dismissed_at ? timeAgo(w.dismissed_at) : "-"}</div>
                <div class="cell-actions">
                  {#if !isDemo}
                    <button
                      class="btn btn-small"
                      onclick={() => unack(w)}
                      title="Move back to Active"
                    >Restore</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <section class="section card">
        {#if loadingTrack}
          <p class="muted">Loading track record...</p>
        {:else if trackError}
          <p class="error">Error: {trackError}</p>
        {:else if !trackRecord}
          <p class="muted">No track record data available yet.</p>
        {:else}
          <p class="desc">Last {trackRecord.window_days} days across your account.</p>

          {#if evaluations && evaluations.batches > 0}
            <div class="stats-cards">
              <div class="stat-card">
                <div class="stat-value">{evaluations.candidates_considered.toLocaleString()}</div>
                <div class="stat-label">Candidates evaluated</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{evaluations.batches.toLocaleString()}</div>
                <div class="stat-label">Batches run</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{evaluations.warnings_emitted}</div>
                <div class="stat-label">Warnings emitted</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{trackRecord.warnings_confirmed}</div>
                <div class="stat-label">Confirmed valuable</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{trackRecord.warnings_dismissed}</div>
                <div class="stat-label">Dismissed</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{trackRecord.warnings_pending}</div>
                <div class="stat-label">Pending feedback</div>
              </div>
            </div>

            {#if trackRecord.precision_estimate !== null}
              {@const rated = trackRecord.warnings_confirmed + trackRecord.warnings_dismissed}
              <p class="desc">
                Current estimated precision:
                <strong>{Math.round(trackRecord.precision_estimate * 100)}%</strong>
                ({trackRecord.warnings_confirmed} of {rated} rated).
              </p>
              {#if rated < 10}
                <!-- A single confirmed warning rendered as "100%" reads as a
                     performance claim. It is not one: it is one observation.
                     Say so at the point the number is shown rather than hoping
                     the reader does the arithmetic. -->
                <p class="desc low-sample">
                  {rated} rating{rated === 1 ? "" : "s"} is too few to estimate
                  precision. Treat this as a running tally, not a measurement;
                  it will move sharply with the next rating either way.
                </p>
              {/if}
            {/if}

            {#if trackRecord.warnings_that_preceded_alert > 0}
              <p class="desc">
                <strong>{trackRecord.warnings_that_preceded_alert}</strong>
                warning{trackRecord.warnings_that_preceded_alert === 1 ? "" : "s"}
                preceded a matching hardware alert within 30 days.
              </p>
            {/if}

            {#if evaluations.last_evaluated_at}
              <p class="muted">
                Last batch:
                {new Date(evaluations.last_evaluated_at).toUTCString()}
              </p>
            {/if}
          {:else}
            {#if isDemo}
              <!-- The sample fleet is a capture: its warnings were seeded, not
                   produced by a batch, so there are no evaluation rows behind
                   them. Saying "no batches have run yet" under four visible
                   warnings reads as a broken page rather than as a property of
                   a sample. -->
              <p class="muted">
                The sample fleet is a captured snapshot, so it has no batch
                history behind it. In your own account this tab shows how many
                hosts were evaluated, how many warnings were raised, and how
                the ones you rated turned out.
              </p>
            {:else}
              <p class="muted">
                No batches have run yet. The system runs {URGENCY_BASIS.cadence};
                check back after the next batch.
              </p>
            {/if}
          {/if}
        {/if}
      </section>
    {/if}
</div>

<style>
  .basis { margin: 0 0 20px; border: 1px solid var(--surface-border); border-radius: 4px; }
  .basis summary {
    cursor: pointer;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .basis summary:hover { color: var(--text-primary); }
  .basis-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px; }
  .basis-body p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-width: 76ch; }
  .tier-legend { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .tier-legend-row { display: grid; grid-template-columns: 8.5rem 1fr; gap: 12px; align-items: baseline; }
  .tier-legend dd { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
  .tier-chip {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 2px;
    border: 1px solid currentColor;
  }
  .low-sample { color: var(--text-tertiary); }
  @media (max-width: 640px) {
    .tier-legend-row { grid-template-columns: 1fr; gap: 4px; }
  }
  .container { margin: 0 auto; }
  .page-title { font-size: 28px; font-weight: 600; margin-bottom: 4px; }
  .page-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; }

  .section { margin-bottom: 20px; padding: 24px; }

  /* Free-tier upsell card — same idiom as /settings/keys. */
  .upsell-card { background: rgba(255, 107, 53, 0.04); border-color: rgba(255, 107, 53, 0.25); }
  .upsell-row { display: flex; justify-content: space-between; gap: 24px; align-items: center; }

  /* Tab nav */
  .tab-nav { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--surface-border); }
  .tab {
    background: transparent; border: none; padding: 10px 16px;
    font-family: var(--font-sans); font-size: 13px; font-weight: 500;
    color: var(--text-secondary); cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  /* Active warnings table */
  .warnings-table { display: flex; flex-direction: column; font-size: 13px; }
  .warnings-row {
    display: grid;
    grid-template-columns: 1.4fr 2fr 0.8fr 1fr auto;
    gap: 12px; padding: 12px 8px;
    border-bottom: 1px solid var(--surface-border);
    align-items: center;
  }
  .warnings-row:last-child { border-bottom: none; }
  .warnings-head { font-weight: 600; color: var(--text-tertiary); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .cell-server a { color: var(--text-primary); font-weight: 500; }
  .cell-server .hostname { display: block; font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
  .cell-title strong { color: var(--text-primary); }
  .cell-title .summary { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
  .cell-actions { display: flex; gap: 6px; justify-content: flex-end; }

  /* Urgency badges */
  .urgency { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .urgency-imminent  { background: rgba(229, 86, 75, 0.15); color: #f87171; }
  .urgency-soon      { background: rgba(224, 169, 59, 0.15); color: #fb923c; }
  .urgency-scheduled { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
  .urgency-other     { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }
  /* Stale: warning auto-resolved before operator rated. De-emphasised
     vs the live badges; not red/orange because the underlying signal
     has already cleared. */
  .urgency-stale {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-tertiary);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    cursor: help;
  }

  .subgroup-heading {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    margin: 16px 0 4px;
  }
  .subgroup-desc {
    font-size: 12.5px;
    color: var(--text-tertiary);
    margin-bottom: 10px;
  }
  .stale-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    padding: 6px 10px;
    background: transparent;
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12.5px;
    cursor: pointer;
    font-weight: 500;
  }
  .stale-toggle:hover { color: var(--text-primary); border-color: rgba(255, 255, 255, 0.18); }
  .stale-toggle .caret { color: var(--text-tertiary); font-size: 12px; width: 10px; }
  .stale-table { opacity: 0.85; margin-top: 8px; }
  .stale-row { background: rgba(255, 255, 255, 0.015); }

  /* Feedback pills (acknowledged tab). Green = operator confirmed
     this warning matters; muted = false-positive or generic ack. */
  .feedback-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.06); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
  .feedback-confirmed { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
  .feedback-fp        { background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); }

  /* Empty state */
  .empty-state { padding: 40px 0; text-align: center; }
  .empty-state h3 { font-size: 16px; margin-bottom: 8px; color: var(--text-primary); }
  .empty-state .desc { max-width: 500px; margin: 0 auto; }

  /* Track record stats cards */
  .stats-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
  .stat-card { padding: 16px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; }
  .stat-value { font-size: 24px; font-weight: 600; color: var(--text-primary); line-height: 1; margin-bottom: 6px; }
  .stat-label { font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }

  .desc { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
  .muted { color: var(--text-tertiary); }
  .error { color: #f87171; }

  /* Mobile responsive */
  @media (max-width: 720px) {
    .warnings-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .warnings-head { display: none; }
    .cell-actions { justify-content: flex-start; }
  }
</style>
