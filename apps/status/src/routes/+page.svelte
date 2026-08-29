<script lang="ts">
  import type { PageData } from "./$types";
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";

  interface Props { data: PageData }
  let { data }: Props = $props();

  const OVERALL_LABEL: Record<string, string> = {
    operational: "All systems operational",
    partial_outage: "Partial outage",
    outage: "Major outage",
  };

  function formatAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  // Auto-refresh every 60s so probes rerun server-side
  onMount(() => {
    const id = setInterval(() => invalidateAll(), 60_000);
    return () => clearInterval(id);
  });
</script>

<section class="overall {data.overall}">
  <div class="dot"></div>
  <h1>{OVERALL_LABEL[data.overall]}</h1>
</section>

<section class="services">
  <h2>Services</h2>
  <ul>
    {#each data.services as state (state.service.id)}
      <li class="service {state.status}">
        <div class="row">
          <div class="left">
            <span class="dot"></span>
            <div>
              <div class="name">
                <a href={state.service.url}>{state.service.name}</a>
              </div>
              <div class="desc">{state.service.description}</div>
            </div>
          </div>
          <div class="right">
            <div class="label">{state.status === "operational" ? "Operational" : "Outage"}</div>
            <div class="meta">checked {formatAgo(state.checkedAtIso)}</div>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</section>

{#if data.recent.length > 0}
  <section class="incidents">
    <h2>Recent incidents</h2>
    <ul>
      {#each data.recent as inc (inc.slug)}
        <li>
          <div class="inc-head">
            <span class="inc-status {inc.status}">{inc.status}</span>
            <span class="inc-title">{inc.title}</span>
            <span class="inc-date">{inc.start}{inc.end ? ` - ${inc.end}` : ""}</span>
          </div>
          <p>{inc.body}</p>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .overall { display: flex; align-items: center; gap: 1rem; padding: 1.5rem; border-radius: 12px; background: #1A1816; border: 1px solid #3D3630; margin-bottom: 2rem; }
  .overall h1 { color: #F5F0E8; margin: 0; font-size: 1.5rem; font-weight: 600; }
  .overall .dot { width: 14px; height: 14px; border-radius: 50%; }
  .operational .dot { background: #10B981; box-shadow: 0 0 16px rgba(16, 185, 129, 0.4); }
  .partial_outage .dot { background: #F97316; box-shadow: 0 0 16px rgba(249, 115, 22, 0.4); }
  .outage .dot { background: #EF4444; box-shadow: 0 0 16px rgba(239, 68, 68, 0.4); }

  h2 { color: #F5F0E8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.12em; margin: 2rem 0 0.75rem; }
  .services ul, .incidents ul { list-style: none; padding: 0; margin: 0; }

  .service { padding: 1rem 1.25rem; border: 1px solid #3D3630; border-radius: 10px; background: #1A1816; margin-bottom: 0.75rem; }
  .service .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .service .left { display: flex; gap: 0.75rem; align-items: center; }
  .service .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .service .name { color: #F5F0E8; font-weight: 500; }
  .service .name a { color: inherit; text-decoration: none; border-bottom: 1px dotted #6B5E50; }
  .service .desc { color: #A69882; font-size: 0.85rem; }
  .service .right { text-align: right; }
  .service .label { color: #F5F0E8; font-size: 0.9rem; }
  .service .meta { color: #6B5E50; font-size: 0.75rem; }

  .incidents li { padding: 1rem 1.25rem; border: 1px solid #3D3630; border-radius: 10px; background: #1A1816; margin-bottom: 0.75rem; }
  .inc-head { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
  .inc-status { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 3px; background: #252220; color: #A69882; }
  .inc-status.resolved { background: rgba(16, 185, 129, 0.15); color: #10B981; }
  .inc-status.investigating { background: rgba(239, 68, 68, 0.15); color: #EF4444; }
  .inc-status.monitoring { background: rgba(249, 115, 22, 0.15); color: #F97316; }
  .inc-title { color: #F5F0E8; font-weight: 500; }
  .inc-date { color: #6B5E50; font-size: 0.8rem; margin-left: auto; }
  .incidents p { color: #A69882; margin: 0.5rem 0 0; font-size: 0.9rem; }
</style>
