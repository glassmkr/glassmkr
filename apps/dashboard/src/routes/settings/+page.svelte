<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";
  import { getToasts } from "$lib/stores/toast.svelte";

  const toast = getToasts();
  let customer = $derived($page.data.customer);
  let mcpEnabled = $derived($page.data.mcpEnabled);
  let selfHosted = $derived(Boolean($page.data.selfHosted));
  let deletedServers = $derived(($page.data.deletedServers ?? []) as Array<{ id: string; name: string }>);
  let restoringDeletedId = $state<string | null>(null);

  let stats = $state<any>(null);
  let openingPortal = $state(false);
  let portalError = $state<string | null>(null);
  let downgrading = $state(false);
  let confirmingDowngrade = $state(false);

  // Disabled-servers (no_card_on_file) management.
  // Loaded from /api/v1/servers and filtered client-side; lives in
  // Settings rather than per-tile because restore is a customer-level
  // pay-or-shrink decision. Restore is bulk (one click, all back);
  // Delete remains per-server (a customer might prune a few specific
  // boxes while keeping others).
  let disabledServers = $state<any[]>([]);
  let restoringAll = $state(false);
  let deletingId = $state<string | null>(null);

  let isPro = $derived(
    customer?.plan === "pro" || customer?.plan === "enterprise"
  );
  // Enterprise customers must contact support; only "pro" can self-downgrade.
  let canSelfDowngrade = $derived(customer?.plan === "pro");

  let trackRecord = $state<any>(null);
  let evaluations = $state<any>(null);

  $effect(() => {
    loadStats();
    loadTrackRecord();
    loadDisabledServers();
  });

  async function loadDisabledServers() {
    try {
      const data: any = await api("/api/v1/servers");
      const all: any[] = data.servers ?? data ?? [];
      disabledServers = all.filter((s) => s.status === "suspended" && s.suspended_reason === "no_card_on_file");
    } catch {
      disabledServers = [];
    }
  }

  async function restoreAll() {
    if (restoringAll || disabledServers.length === 0) return;
    restoringAll = true;
    try {
      const r: any = await api(`/api/v1/servers/restore-all`, { method: "POST" });
      if (r?.success) {
        const n = r.count ?? r.restored?.length ?? 0;
        toast.show(`${n} server${n === 1 ? "" : "s"} restored.`, "success", 5000);
        await Promise.all([loadDisabledServers(), loadStats()]);
      } else {
        toast.show(r?.message ?? r?.error ?? "Restore failed.", "error", 6000);
      }
    } catch (err: any) {
      const status = err?.status;
      const body = err?.body ?? {};
      // Click without a card on file lands here as 400 with
      // body.error="no_card_on_file". Surface the API's message verbatim
      // so the user sees a clear next-step rather than a silent disabled
      // button. Longer toast duration so the message is readable.
      if (status === 503) toast.show("Restoration not yet available. Contact support.", "error", 6000);
      else if (status === 400) toast.show(body.message ?? body.error ?? "Add a payment method first to restore servers.", "error", 6000);
      else if (status === 502) toast.show("Couldn't reach Stripe right now. Try again in a moment.", "error", 6000);
      else toast.show(err?.message ?? "Restore failed.", "error", 6000);
    } finally {
      restoringAll = false;
    }
  }

  async function restoreDeleted(srv: { id: string; name: string }) {
    if (restoringDeletedId) return;
    restoringDeletedId = srv.id;
    try {
      const r: any = await api(`/api/v1/servers/${srv.id}/restore`, { method: "POST" });
      if (r?.success) {
        toast.show(`${srv.name} restored from trash.`, "success", 5000);
        // Reload so the trash list, fleet, and node count all reflect the restore.
        window.location.reload();
      } else {
        toast.show(r?.message ?? r?.error ?? "Restore failed.", "error", 6000);
      }
    } catch (err: any) {
      toast.show(err?.message ?? "Restore failed.", "error", 6000);
    } finally {
      restoringDeletedId = null;
    }
  }

  async function deleteServer(srv: any) {
    if (deletingId || restoringAll) return;
    if (!confirm(`Delete ${srv.name}? This permanently removes the server and all its history. This cannot be undone.`)) return;
    deletingId = srv.id;
    try {
      await api(`/api/v1/servers/${srv.id}?confirm=true`, { method: "DELETE" });
      toast.show(`${srv.name} deleted.`, "success");
      await Promise.all([loadDisabledServers(), loadStats()]);
    } catch (err: any) {
      toast.show(err?.message ?? "Delete failed.", "error");
    } finally {
      deletingId = null;
    }
  }

  async function loadTrackRecord() {
    // Free for every account since the P0-03 resolution; this used to return
    // early for anyone not on a legacy paid plan, so the card below never got
    // data even after its render gate was opened.
    if (!customer) return;
    try {
      const [tr, ev] = await Promise.all([
        api("/api/v1/trend-warnings/track-record"),
        api("/api/v1/trend-warnings/evaluations").catch(() => null),
      ]);
      trackRecord = tr as any;
      evaluations = ev as any;
    } catch {
      trackRecord = null;
      evaluations = null;
    }
  }

  async function loadStats() {
    try {
      const data: any = await api("/api/v1/billing/status");
      stats = data;
    } catch (err: any) {
      console.error("Failed to load billing status:", err);
    }
  }

  async function openBillingPortal() {
    openingPortal = true;
    portalError = null;
    try {
      const data: any = await api("/api/v1/billing/portal", { method: "POST" });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      const msg = err.message || "Failed to open billing portal";
      portalError = msg;
      toast.show(msg, "error");
    } finally {
      openingPortal = false;
    }
  }

  async function downgradeToFree() {
    downgrading = true;
    try {
      const data: any = await api("/api/v1/billing/downgrade", { method: "POST" });
      if (data.scheduled) {
        // Active sub: cancellation scheduled at period end.
        const ends = data.current_period_end
          ? new Date(data.current_period_end).toLocaleDateString()
          : "the end of the current period";
        toast.show(`Cancellation scheduled. Your access continues until ${ends}.`, "success");
      } else {
        // Lazy state: immediate downgrade.
        const suspendedNote = data.suspended > 0
          ? ` ${data.suspended} server${data.suspended === 1 ? "" : "s"} were suspended (Free is limited to ${stats?.server_limit ?? 3}).`
          : "";
        toast.show(`Downgraded to Free.${suspendedNote}`, "success");
      }
      window.location.reload();
    } catch (err: any) {
      toast.show(err.message || "Failed to cancel", "error");
    } finally {
      downgrading = false;
      confirmingDowngrade = false;
    }
  }

  // Resume a scheduled cancellation. Single-click; lower-risk than cancel,
  // so no confirmation page (per CC_BILLING_POLICY_AND_CANCEL_FUNCTION).
  let resuming = $state(false);
  async function resumeSubscription() {
    resuming = true;
    try {
      await api("/api/v1/billing/resume", { method: "POST" });
      toast.show("Subscription resumed.", "success");
      window.location.reload();
    } catch (err: any) {
      toast.show(err.message || "Failed to resume", "error");
    } finally {
      resuming = false;
    }
  }

</script>

<svelte:head>
  <title>Settings | Dashboard</title>
</svelte:head>

<div class="container">
  <h1 class="page-title">Settings</h1>

  {#if customer}
    <p class="account-email">{customer.email}</p>

    <!-- Deployment summary. Facts about THIS deployment before any billing talk:
         on a self-hosted instance billing does not exist, and on the hosted
         service the plan is only one of several things an operator wants to
         confirm. -->
    <section class="section card">
      <h2>Deployment</h2>
      <dl class="deployment-facts">
        <dt>Mode</dt>
        <dd>{selfHosted ? "Self-hosted" : "Hosted by Glassmkr"}</dd>
        <dt>Programmatic API</dt>
        <dd>Available on every plan: read, write and admin scopes</dd>
        <dt>MCP</dt>
        <dd>{mcpEnabled ? "Enabled on this deployment" : "Not enabled on this deployment"}</dd>
        <dt>AI analysis</dt>
        <dd>{selfHosted ? "Unmetered. Set LLM_API_URL to any OpenAI-compatible endpoint." : "Included for every account, bounded by rate limits."}</dd>
      </dl>
    </section>

    <!-- Plan Section -->
    {#if !selfHosted}
    <section class="section card">
      <div class="plan-header">
        <div>
          <h2>{customer.plan === "pro" ? "Pro (legacy)" : customer.plan === "enterprise" ? "Enterprise (legacy)" : "Hosted (free)"}</h2>
          <span class="tag tag-green">Active</span>
        </div>
        {#if isPro}
          <div class="plan-actions">
            <button class="btn btn-small" onclick={openBillingPortal} disabled={openingPortal}>
              {openingPortal ? "Opening..." : "Manage payment method"}
            </button>
            {#if stats?.cancel_at_period_end}
              <!-- Cancellation already scheduled: single-click Resume. -->
              <button class="btn btn-small btn-primary" onclick={resumeSubscription} disabled={resuming}>
                {resuming ? "Resuming..." : "Resume subscription"}
              </button>
            {:else if canSelfDowngrade}
              <!-- Step 1 of cancel: surface the action plainly (no scary
                   styling, no buried submenu). EU Directive 2023/2673. -->
              <button class="btn btn-small btn-link" onclick={() => confirmingDowngrade = true} disabled={downgrading}>
                Cancel subscription
              </button>
            {/if}
          </div>
        {:else}
          <!-- No upgrade path: hosted has no paid tier (P0-03 resolution,
               2026-08-29; ground-truth.yaml hosted_pricing_state). The billing
               controls in the isPro branch above stay so any residual paying
               subscriber can still manage or cancel, which is their legal
               right; nothing offers a way IN. -->
          <span class="demo-note">Hosted Glassmkr is free up to the node cap. There is no paid tier.</span>
        {/if}
      </div>

      {#if isPro && stats?.cancel_at_period_end}
        <!-- Persistent banner while cancellation is pending. -->
        <div class="downgrade-confirm">
          <p>
            <strong>Cancellation scheduled.</strong>
            Your subscription will end on
            {stats.current_period_end ? new Date(stats.current_period_end).toLocaleDateString() : "the end of the current period"}.
            You will not be charged for the next period. You can resume any time before then.
          </p>
        </div>
      {/if}

      {#if confirmingDowngrade}
        {@const willSuspend = Math.max(0, (stats?.servers_used ?? 0) - 3)}
        {@const endDate = stats?.current_period_end
          ? new Date(stats.current_period_end).toLocaleDateString()
          : "the end of your current billing period"}
        <!-- Step 2 of cancel: confirmation page. NO additional steps. Two
             clicks total: "Cancel subscription" -> "Confirm cancellation". -->
        <div class="downgrade-confirm">
          <p>
            <strong>Cancel your Glassmkr Pro subscription?</strong>
          </p>
          {#if stats?.has_subscription}
            <p>
              Your access continues until {endDate} (end of current billing period).
              You will not be charged for the next period. No refund is issued for the current period.
            </p>
            <p>
              After {endDate}, your account will downgrade to the free tier:
            </p>
            <ul>
              <li>Up to 3 servers monitored
                {#if willSuspend > 0}
                  (<strong>{willSuspend} of your {stats?.servers_used} servers will be suspended</strong>)
                {/if}
              </li>
              <li>Standard history retention</li>
              <li>Email notifications only</li>
            </ul>
          {:else}
            <p>
              You're on Pro with no active subscription (lazy state). Cancelling drops you to Free immediately.
              {#if willSuspend > 0}
                <strong>{willSuspend} of your {stats?.servers_used} servers will be suspended.</strong>
              {/if}
            </p>
          {/if}
          <div class="confirm-actions">
            <button class="btn btn-small" onclick={() => confirmingDowngrade = false} disabled={downgrading}>
              Keep my subscription
            </button>
            <button class="btn btn-small btn-danger" onclick={downgradeToFree} disabled={downgrading}>
              {downgrading ? "Cancelling..." : "Confirm cancellation"}
            </button>
          </div>
        </div>
      {/if}
      <!-- The pre-subscription EU withdrawal notice that rendered here for
           non-Pro accounts is retired with checkout: there is nothing left to
           subscribe to. The cancellation flow above keeps its own notices. -->

      <p class="billing-policy-link">
        See the
        <a href="https://glassmkr.com/billing-policy" target="_blank" rel="noopener">billing policy</a>
        for pricing, refund position, and cancellation details.
      </p>

      {#if stats && isPro && stats.has_subscription && stats.subscription_status && !["active", "trialing"].includes(stats.subscription_status)}
        <div class="billing-warning">
          <strong>
            {#if stats.subscription_status === "past_due"}
              Payment failed.
            {:else if stats.subscription_status === "unpaid"}
              Subscription unpaid.
            {:else if stats.subscription_status === "incomplete"}
              Subscription incomplete.
            {:else if stats.subscription_status === "incomplete_expired"}
              Initial payment never completed.
            {:else if stats.subscription_status === "canceled"}
              Subscription cancelled.
            {:else}
              Subscription state: {stats.subscription_status}.
            {/if}
          </strong>
          Your servers will be suspended if this isn't resolved. Use Manage Subscription to update your card.
        </div>
      {:else if stats && isPro && (stats.suspended_no_card_count ?? 0) > 0}
        <!-- State 2: grace ended, servers suspended -->
        {@const _suspended = stats.suspended_no_card_count ?? 0}
        {@const _used = stats.servers_used ?? 0}
        {@const _total = _used + _suspended}
        <div class="billing-warning">
          <strong>{_suspended} of your {_total} server{_total === 1 ? "" : "s"} {_suspended === 1 ? "is" : "are"} currently disabled because no payment method is on file.</strong>
          Use Manage Subscription to add a card, then click Restore on each server in your dashboard.
        </div>
      {:else if stats && isPro && !stats.has_subscription && stats.has_default_payment_method === false}
        <!-- State 1 (active sub) and State 3 (no sub) consolidated:
             dunning before any suspension fires. -->
        {@const _free = stats.free_nodes_quota ?? 3}
        {@const _used = stats.servers_used ?? 0}
        {@const _billable = stats.billable_nodes ?? Math.max(0, _used - _free)}
        <div class="billing-warning">
          <strong>No card on file.</strong>
          {#if _billable === 0}
            You have {_used} server{_used === 1 ? "" : "s"}, all within the
            {_free}-free quota, so nothing chargeable yet. Adding the next
            server past {_free} starts billing. Add a card now via Manage
            Subscription to enable that.
          {:else}
            You have {_used} server{_used === 1 ? "" : "s"}, {_billable} of which
            {_billable === 1 ? "is" : "are"} chargeable at ${stats.price_per_node_usd ?? 3} each.
            Servers beyond your {_free}-server free quota will be disabled
            at the end of your grace period unless a payment method is added.
            Add a card now via Manage Subscription.
          {/if}
        </div>
      {/if}

      {#if portalError}
        <div class="portal-error">
          <strong>Stripe:</strong> {portalError}
        </div>
      {/if}

      {#if stats}
        <div class="stats-grid mt-2">
          <div class="stat-item">
            <span class="label">Servers</span>
            <span>{stats.servers_used ?? 0}{stats.server_limit && stats.server_limit < 9999 ? ` / ${stats.server_limit}` : ""}</span>
          </div>
          <div class="stat-item">
            <span class="label">Monthly cost</span>
            <span>
              {#if stats.plan === "enterprise"}
                Custom
              {:else if stats.plan === "pro"}
                {@const _free = stats.free_nodes_quota ?? 3}
                {@const _used = stats.servers_used ?? 0}
                {@const _billable = stats.billable_nodes ?? Math.max(0, _used - _free)}
                ${stats.monthly_cost_usd ?? 0}/mo
                {#if _billable === 0}
                  <small class="hint">{_used}/{_free} free</small>
                {:else}
                  <small class="hint">{_billable} &times; ${stats.price_per_node_usd ?? 3}, {_free} free</small>
                {/if}
              {:else}
                Free
              {/if}
            </span>
          </div>
          <div class="stat-item">
            <span class="label">Retention</span>
            <span>{stats.retention_days ?? 90} days</span>
          </div>
        </div>
      {/if}
    </section>
    {/if}

    <!-- Disabled Servers Section: pay-or-shrink decision point -->
    {#if disabledServers.length > 0}
      <section id="disabled-servers" class="section card">
        <div class="disabled-servers-header">
          <h2>Disabled servers ({disabledServers.length})</h2>
          <button
            type="button"
            class="btn btn-small btn-primary"
            disabled={restoringAll}
            onclick={restoreAll}
          >
            {restoringAll ? "Restoring…" : `Restore all (${disabledServers.length})`}
          </button>
        </div>
        <p class="desc">
          These servers are disabled because no payment method is on file.
          Snapshot ingest continues for each, so historical data is preserved.
          Choose how to resolve: <strong>add a card and Restore all</strong>,
          or <strong>Delete</strong> servers you no longer need to drop into
          the {stats?.free_nodes_quota ?? 3}-server free quota.
        </p>
        {#if !stats?.has_default_payment_method}
          <div class="disabled-servers-callout">
            <strong>No payment method on file.</strong>
            Add a card via Manage Subscription before restoring. Deletion works
            without a card and is permanent.
          </div>
        {/if}
        <div class="disabled-servers-list">
          {#each disabledServers as srv (srv.id)}
            {@const suspendedAt = srv.suspended_at ? new Date(srv.suspended_at).toISOString().slice(0, 10) : "—"}
            <div class="disabled-row">
              <div class="disabled-row-info">
                <div class="disabled-row-name">{srv.name}</div>
                <div class="disabled-row-meta">
                  {srv.os_type ?? ""} {srv.os_version ?? ""} · disabled {suspendedAt}
                </div>
              </div>
              <div class="disabled-row-actions">
                <button
                  type="button"
                  class="btn btn-small btn-danger"
                  disabled={restoringAll || deletingId === srv.id}
                  onclick={() => deleteServer(srv)}
                >
                  {deletingId === srv.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- API keys + audit (Phase 4) -->
    <section class="section card">
      <h2>API keys</h2>
      <p class="desc">
        Programmatic access for scripts, CLI, and automation.
      </p>
      <a href="/settings/keys" class="btn btn-primary btn-small">
        Manage API keys &rarr;
      </a>
    </section>

    {#if mcpEnabled}
      <section class="section card">
        <h2>MCP connections</h2>
        <p class="desc">
          Connect a compatible AI client to your fleet, authorized through your
          browser. Each connection's permissions are shown on the approval screen.
        </p>
        <a href="/settings/mcp" class="btn btn-small">
          Manage MCP connections &rarr;
        </a>
      </section>
    {/if}

    {#if deletedServers.length > 0}
      <section class="section card" id="trash">
        <h2>Trash ({deletedServers.length})</h2>
        <p class="desc">
          Servers moved to trash (for example by a delete over MCP). Restoring one
          returns it to your active fleet and node count.
        </p>
        <ul class="trash-list">
          {#each deletedServers as srv (srv.id)}
            <li>
              <span class="trash-name">{srv.name}</span>
              <button
                class="btn btn-small"
                aria-busy={restoringDeletedId === srv.id}
                disabled={restoringDeletedId !== null}
                onclick={() => restoreDeleted(srv)}
              >Restore</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Shown to every account since the P0-03 resolution: the API behind it
         (GET /account/audit) is free, so hiding the card only made the feature
         look absent. -->
      <section class="section card">
        <h2>Audit log</h2>
        <p class="desc">
          Every authenticated API call on your account, filterable by date
          range and action.
        </p>
        <a href="/settings/audit" class="btn btn-small">
          Open audit log &rarr;
        </a>
      </section>
    


    <!-- Trend Warnings Track Record: every account, since the API behind it
         (GET /trend-warnings/track-record, tier: free) stopped being gated. -->
    {#if trackRecord}
      <section class="section card">
        <h2>Trend Warnings Track Record</h2>
        <p class="desc">Last {trackRecord.window_days} days on your account.</p>

        {#if evaluations && evaluations.batches > 0}
          <p class="desc">
            {#if evaluations.warnings_emitted > 0}
              The system evaluated <strong>{evaluations.candidates_considered.toLocaleString()}</strong>
              candidate{evaluations.candidates_considered === 1 ? "" : "s"} across
              <strong>{evaluations.batches.toLocaleString()}</strong>
              batch{evaluations.batches === 1 ? "" : "es"}
              and flagged <strong>{evaluations.warnings_emitted}</strong>
              for review.
            {:else}
              The system evaluated <strong>{evaluations.candidates_considered.toLocaleString()}</strong>
              candidate{evaluations.candidates_considered === 1 ? "" : "s"} across
              <strong>{evaluations.batches.toLocaleString()}</strong>
              batch{evaluations.batches === 1 ? "" : "es"}.
              Your fleet's signals stayed below threshold on every check.
            {/if}
            {#if evaluations.servers_skipped_young > 0}
              <span class="muted">
                ({evaluations.servers_skipped_young} server-batch{evaluations.servers_skipped_young === 1 ? "" : "es"} skipped for being newer than 7 days; slope-based triggers need more history before they're meaningful.)
              </span>
            {/if}
            {#if evaluations.last_evaluated_at}
              <br/>
              <span class="muted">Last batch: {new Date(evaluations.last_evaluated_at).toUTCString()}.</span>
            {/if}
          </p>
        {/if}

        <ul class="track-list">
          <li><strong>{trackRecord.warnings_sent}</strong> warnings sent</li>
          <li><strong>{trackRecord.warnings_confirmed}</strong> confirmed valuable</li>
          <li><strong>{trackRecord.warnings_dismissed}</strong> dismissed as false positive</li>
          <li>
            <strong>{trackRecord.warnings_pending_live ?? trackRecord.warnings_pending}</strong>
            {#if (trackRecord.warnings_pending_live ?? trackRecord.warnings_pending) > 0}
              <a href="/trend-warnings?tab=pending-feedback">pending your feedback</a>
            {:else}
              pending your feedback
            {/if}
            {#if trackRecord.warnings_pending_stale > 0}
              <span class="muted">(+ {trackRecord.warnings_pending_stale} stale; auto-resolved before you rated)</span>
            {/if}
          </li>
        </ul>
        {#if trackRecord.precision_estimate !== null}
          <p class="desc">
            Current estimated precision:
            <strong>{Math.round(trackRecord.precision_estimate * 100)}%</strong>
          </p>
        {/if}
        {#if trackRecord.warnings_that_preceded_alert > 0}
          <p class="desc">
            {trackRecord.warnings_that_preceded_alert} warning{trackRecord.warnings_that_preceded_alert === 1 ? "" : "s"} preceded a matching hardware alert within 30 days.
          </p>
        {/if}
      </section>
    {/if}

    <!-- Documentation Links. Docs live on glassmkr.com (a different
         origin from the dashboard). The dashboard's own /docs/* tree
         is a 301 redirect today; pointing directly at the marketing
         host avoids the hop and matches the sidebar Docs entry. All
         four links open in a new tab. -->
    <section class="section card">
      <h2>Documentation</h2>
      <ul class="docs-links">
        <li><a href="https://glassmkr.com/docs/getting-started" target="_blank" rel="noopener">Getting Started ↗</a></li>
        <li><a href="https://glassmkr.com/docs/api" target="_blank" rel="noopener">API Reference ↗</a></li>
        <li><a href="https://glassmkr.com/docs/channels" target="_blank" rel="noopener">Alert Channels ↗</a></li>
        <li><a href="https://glassmkr.com/docs/configuration" target="_blank" rel="noopener">Configuration ↗</a></li>
      </ul>
    </section>
  {/if}
</div>

<style>
  .demo-note { font-size: 13px; color: var(--text-tertiary); }
  /* Deployment facts: a plain definition list, two columns where there is room.
     No card-within-a-card, no badges. These are facts to confirm, not a feature
     grid to be sold. */
  .deployment-facts {
    display: grid;
    grid-template-columns: minmax(9rem, auto) 1fr;
    gap: 8px 20px;
    margin: 12px 0 0;
  }
  .deployment-facts dt {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    align-self: baseline;
  }
  .deployment-facts dd { margin: 0; color: var(--text-secondary); font-size: 14px; }
  @media (max-width: 560px) {
    .deployment-facts { grid-template-columns: 1fr; gap: 2px 0; }
    .deployment-facts dd { margin-bottom: 10px; }
  }
  .page-title {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .account-email {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 24px;
  }

  .track-list {
    margin: 12px 0;
    padding-left: 20px;
    color: var(--text-primary);
    font-size: 14px;
    line-height: 1.7;
  }
  .section {
    margin-bottom: 20px;
    padding: 24px;
  }
  .section h2 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .plan-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  .plan-header h2 {
    margin-bottom: 4px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat-item span:last-child {
    font-size: 16px;
    font-weight: 600;
  }


  .billing-policy-link {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 16px;
  }
  .billing-policy-link a {
    color: var(--text-secondary);
  }

  .portal-error {
    background: rgba(200, 60, 60, 0.08);
    border: 1px solid rgba(200, 60, 60, 0.3);
    color: #d04040;
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 13px;
    margin-top: 12px;
    line-height: 1.4;
  }

  .billing-warning {
    background: rgba(220, 140, 30, 0.10);
    border: 1px solid rgba(220, 140, 30, 0.4);
    color: #b06000;
    padding: 12px 14px;
    border-radius: 4px;
    font-size: 13px;
    margin-top: 12px;
    line-height: 1.5;
  }
  .billing-warning strong {
    display: block;
    margin-bottom: 4px;
  }

  .stat-item .hint {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .plan-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .btn-link {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    text-decoration: underline;
    padding: 6px 8px;
  }
  .btn-link:hover:not(:disabled) {
    color: var(--text-secondary);
  }

  .downgrade-confirm {
    background: rgba(180, 130, 50, 0.06);
    border: 1px solid rgba(180, 130, 50, 0.3);
    border-radius: 4px;
    padding: 14px 16px;
    margin-top: 14px;
    font-size: 13px;
    line-height: 1.5;
  }
  .downgrade-confirm p {
    margin: 0 0 12px 0;
  }
  .confirm-actions {
    display: flex;
    gap: 8px;
  }

  .desc {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 12px;
  }

  .desc .muted {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .docs-links {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .docs-links a {
    font-size: 14px;
  }

  .disabled-servers-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .disabled-servers-header h2 {
    margin: 0;
  }

  .disabled-servers-callout {
    background: #2A2412;
    border: 1px solid #E0A93B;
    border-radius: 4px;
    padding: 10px 14px;
    margin: 8px 0 16px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .disabled-servers-callout strong {
    color: #E0A93B;
    margin-right: 4px;
  }
  .disabled-servers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }
  .disabled-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
  }
  .disabled-row-info {
    min-width: 0;
    flex: 1;
  }
  .disabled-row-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .disabled-row-meta {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }
  .disabled-row-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .trash-list {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .trash-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .trash-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
