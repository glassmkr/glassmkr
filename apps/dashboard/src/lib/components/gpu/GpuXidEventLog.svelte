<script lang="ts">
  // Collapsible XID event log. Hidden entirely when the events
  // array is empty (most healthy hosts have zero XIDs in the
  // 24h window). Default state is collapsed.
  //
  // Per CC_SPEC_GPU_UI_SURFACES_2026-05-19.md §1.3.

  import type { Snapshot } from "$lib/server/alerts/evaluator";
  import { formatXid } from "$lib/utils/xid-codes";
  import { timeAgo } from "$lib/utils/time";

  type Tier1Available = Extract<
    NonNullable<NonNullable<Snapshot["gpu"]>["tier1"]>,
    { available: true }
  >;
  type XidEvent = Tier1Available["xid_events"][number];

  interface Props {
    events: XidEvent[];
    /** uuid -> name map, used to render "GPU X (NVIDIA L4)" labels
     *  next to the XID code instead of just the bare BDF. */
    gpuByBdf?: Record<string, { index: number; name: string }>;
  }

  let { events, gpuByBdf = {} }: Props = $props();
  let expanded = $state(false);
  let expandedEventId = $state<string | null>(null);

  let critical = $derived(events.filter((e) => e.severity === "critical").length);
  let warning = $derived(events.filter((e) => e.severity === "warning").length);
  let info = $derived(events.filter((e) => e.severity === "info").length);

  function eventKey(e: XidEvent): string {
    return `${e.timestamp_iso}|${e.pci_bdf}|${e.xid_code}`;
  }
</script>

{#if events.length > 0}
  <section class="xid-log">
    <button
      class="xid-toggle"
      class:expanded
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class="caret">{expanded ? "▾" : "▸"}</span>
      <span class="xid-count">XID Events (last 24h)</span>
      <span class="xid-summary">
        {#if critical > 0}
          <span class="pill pill-crit">{critical} critical</span>
        {/if}
        {#if warning > 0}
          <span class="pill pill-warn">{warning} warning</span>
        {/if}
        {#if info > 0}
          <span class="pill pill-info">{info} info</span>
        {/if}
      </span>
    </button>

    {#if expanded}
      <div class="xid-list">
        {#each events as e (eventKey(e))}
          {@const gpu = gpuByBdf[e.pci_bdf]}
          <button
            class="xid-row"
            onclick={() => (expandedEventId = expandedEventId === eventKey(e) ? null : eventKey(e))}
          >
            <span class="xid-ts">{timeAgo(e.timestamp_iso)}</span>
            <span class="xid-gpu">
              {#if gpu}
                GPU {gpu.index} ({gpu.name})
              {:else}
                {e.pci_bdf}
              {/if}
            </span>
            <span class="xid-code">{formatXid(e.xid_code)}</span>
            <span class="pill pill-{e.severity}">{e.severity}</span>
          </button>
          {#if expandedEventId === eventKey(e)}
            <pre class="xid-raw">{e.raw_message}</pre>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .xid-log {
    margin-top: 12px;
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .xid-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--surface);
    border: 0;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    font-size: 13px;
  }
  .xid-toggle:hover { background: rgba(255, 255, 255, 0.03); }
  .caret {
    color: var(--text-tertiary);
    font-size: 12px;
    width: 12px;
  }
  .xid-count { font-weight: 600; }
  .xid-summary { display: flex; gap: 6px; margin-left: auto; }

  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pill-crit, .pill-critical { background: rgba(229, 86, 75, 0.15); color: #f87171; }
  .pill-warn, .pill-warning  { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
  .pill-info                 { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }

  .xid-list {
    border-top: 1px solid var(--surface-border);
    background: var(--surface);
  }
  .xid-row {
    width: 100%;
    display: grid;
    grid-template-columns: 100px 200px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: transparent;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .xid-row:first-child { border-top: 0; }
  .xid-row:hover { background: rgba(255, 255, 255, 0.03); }
  .xid-ts { color: var(--text-tertiary); font-size: 12px; }
  .xid-gpu { color: var(--text-secondary); font-size: 12px; }
  .xid-code { color: var(--text-primary); }

  .xid-raw {
    margin: 0;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-secondary);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  @media (max-width: 720px) {
    .xid-row { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
