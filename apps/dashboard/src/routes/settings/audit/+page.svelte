<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";
  import { timeAgo } from "$lib/utils/time";
  import DatePicker from "$lib/components/DatePicker.svelte";

  let customer = $derived($page.data.customer);

  interface AuditRow {
    id: string;
    ts: string;
    key_id: string | null;
    source_ip: string;
    method: string;
    path: string;
    resource_type: string | null;
    resource_id: string | null;
    action: string;
    result: string;
    status_code: number;
    metadata: Record<string, unknown> | null;
  }

  let entries = $state<AuditRow[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);

  // Filter state (spec calls for date range + action type).
  let filterSince = $state<string>(defaultSince());
  let filterUntil = $state<string>("");
  let filterAction = $state<string>("");

  const ACTION_OPTIONS = [
    "",
    "create",
    "list",
    "read",
    "update",
    "delete",
    "rotate",
    "revoke",
    "verify_password",
  ];

  function defaultSince(): string {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }

  async function load(reset = true) {
    loading = true;
    loadError = null;
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterSince) params.set("since", new Date(filterSince).toISOString());
      if (filterUntil) {
        const u = new Date(filterUntil);
        u.setUTCHours(23, 59, 59, 999);
        params.set("until", u.toISOString());
      }
      if (filterAction) params.set("action", filterAction);
      if (!reset && nextCursor) params.set("cursor", nextCursor);
      const data: any = await api(`/api/v1/account/audit?${params.toString()}`);
      const rows = (data.entries ?? data.audit ?? []) as AuditRow[];
      entries = reset ? rows : [...entries, ...rows];
      nextCursor = data.next_cursor ?? null;
    } catch (err: any) {
      loadError = err?.message ?? "Failed to load audit log.";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (customer) load(true);
  });

  function applyFilters() {
    entries = [];
    nextCursor = null;
    load(true);
  }
</script>

<svelte:head>
  <title>Audit log | Dashboard Settings</title>
</svelte:head>

<div class="container">
  <a href="/settings" class="back-link">&larr; Back to settings</a>
  <h1 class="page-title">Audit log</h1>
  <p class="page-desc">
    Every authenticated API call against your account. Filter by date range
    and action type.
  </p>

  <!-- The Pro gate that used to wrap this page is retired (P0-03 resolution,
     2026-08-29): the audit log is free on every account, matching
     requireProTier's pass-through on the API side. -->
    <section class="section card">
      <div class="filter-bar">
        <div class="filter-field">
          <label for="audit-from">From</label>
          <DatePicker id="audit-from" bind:value={filterSince} placeholder="YYYY-MM-DD" />
        </div>
        <div class="filter-field">
          <label for="audit-to">To</label>
          <DatePicker id="audit-to" bind:value={filterUntil} placeholder="YYYY-MM-DD" />
        </div>
        <div class="filter-field">
          <label for="audit-action">Action</label>
          <select id="audit-action" bind:value={filterAction}>
            {#each ACTION_OPTIONS as a}
              <option value={a}>{a === "" ? "All actions" : a}</option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary btn-small" onclick={applyFilters} disabled={loading}>
          {loading ? "Loading..." : "Apply"}
        </button>
      </div>

      {#if loadError}
        <p class="error">Error: {loadError}</p>
      {:else if entries.length === 0 && !loading}
        <p class="muted">No audit entries match these filters.</p>
      {:else}
        <!-- Six dense columns do not fit a phone. Contain the sideways scroll
             inside the table rather than letting it become document overflow,
             which is what made the whole page slide under the viewport. Rows
             stay rows: an audit entry inflated into a card is harder to scan,
             not easier. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- A scrollable region must be reachable by keyboard (WCAG 2.1.1), and
             role="region" plus tabindex="0" is how you do that. The rule fires
             on the shape without knowing the element scrolls. -->
        <div class="audit-scroll" tabindex="0" role="region" aria-label="Audit entries, scrolls horizontally on small screens">
          <div class="audit-table">
            <div class="audit-row audit-head">
            <div>Timestamp</div>
            <div>Action</div>
            <div>Resource</div>
            <div>Result</div>
            <div>Source IP</div>
            <div>Method · Path</div>
          </div>
          {#each entries as e (e.id)}
            <div class="audit-row">
              <div>{timeAgo(e.ts)}<div class="cell-sub">{new Date(e.ts).toISOString()}</div></div>
              <div class="mono">{e.action}</div>
              <div class="mono">{e.resource_type ?? "none"}{e.resource_id ? " " + e.resource_id : ""}</div>
              <div><span class="result result-{e.result}">{e.result}</span> <span class="cell-sub">{e.status_code}</span></div>
              <div class="mono">{e.source_ip}</div>
              <div class="mono ellipsis"><span class="method">{e.method}</span> {e.path}</div>
            </div>
          {/each}
        </div>
        </div>

        {#if nextCursor}
          <button class="btn btn-small mt-2" onclick={() => load(false)} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </button>
        {/if}
      {/if}
    </section>
  

</div>

<style>
  .container { margin: 0 auto; }
  .back-link { font-size: 12px; color: var(--text-tertiary); text-decoration: none; display: inline-block; margin-bottom: 12px; }
  .page-title { font-size: 28px; font-weight: 600; margin-bottom: 4px; }
  .page-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; }
  /* Match /settings/+page.svelte:574 — stacked sections are 20px apart, 24px internal padding. */
  .section { margin-bottom: 20px; padding: 24px; }
  /* Native select caret honours the page's color scheme when declared.
     The date inputs are now <DatePicker> (themed flatpickr), so they
     don't need this hint — only the action-filter <select> remains. */
  select {
    color-scheme: dark;
  }
  .filter-bar { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-field { display: flex; flex-direction: column; gap: 4px; }
  .filter-field label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
  .filter-field input, .filter-field select { padding: 6px 8px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; color: var(--text-primary); font-size: 13px; }
  /* The shorthand above resets the global 32px chevron clearance. */
  .filter-field select { padding-right: 30px; }
  .audit-scroll { overflow-x: auto; }
  .audit-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .audit-table { display: flex; flex-direction: column; min-width: 56rem; }
  .audit-row { display: grid; grid-template-columns: 1.2fr 1fr 1.5fr 0.8fr 1fr 2fr; gap: 14px; padding: 13px 8px; border-bottom: 1px solid var(--surface-border); font-size: 13px; align-items: start; }
  .audit-row:last-child { border-bottom: none; }
  .audit-head { font-weight: 600; color: var(--text-tertiary); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }
  .cell-sub { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .method { font-weight: 600; color: var(--text-primary); }
  .result { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 12px; font-weight: 600; }
  .result-success { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
  .result-rate_limited { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .result-forbidden, .result-auth_failed, .result-invalid, .result-error { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .result-not_found { background: rgba(255,255,255,0.06); color: var(--text-tertiary); }
  .muted { color: var(--text-tertiary); }
  .error { color: #f87171; }
</style>
