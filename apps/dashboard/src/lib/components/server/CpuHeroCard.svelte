<script lang="ts">
  // The CPU showpiece: an aggregate donut + a per-core load heatmap
  // (GitHub-contributions style). CPU is on 100% of hosts, so it leads the
  // Host vitals section as a full card rather than a compact tile. The
  // heatmap scales cleanly from 8 to 512 cores (one small cell each) where a
  // grid of per-core cards would dwarf the page. Each cell is a clickthrough
  // to that core's history; the header opens aggregate CPU history.

  interface Core {
    core?: number;
    idle_percent?: number;
    user_percent?: number;
    system_percent?: number;
    iowait_percent?: number;
  }
  type HistoryReq = { kind: "cpu" } | { kind: "core"; index: number; label: string };

  interface Props {
    user?: number;
    system?: number;
    iowait?: number;
    idle?: number;
    cores?: Core[];
    onViewHistory?: (m: HistoryReq) => void;
  }
  let { user = 0, system = 0, iowait = 0, idle = 100, cores = [], onViewHistory }: Props = $props();

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  function coreBusy(c: Core): number {
    if (typeof c.idle_percent === "number") return clamp(100 - c.idle_percent);
    return clamp((c.user_percent ?? 0) + (c.system_percent ?? 0) + (c.iowait_percent ?? 0));
  }
  function fmt(n: number): string {
    return n < 10 ? n.toFixed(1) : Math.round(n).toString();
  }

  let util = $derived(clamp(100 - idle));
  let busies = $derived(cores.map(coreBusy));
  let threads = $derived(cores.length);
  let avg = $derived(busies.length ? busies.reduce((a, b) => a + b, 0) / busies.length : util);
  let peak = $derived.by(() => {
    if (!busies.length) return { val: util, idx: -1 };
    let val = -1, idx = 0;
    busies.forEach((b, i) => { if (b > val) { val = b; idx = i; } });
    return { val, idx };
  });

  // Aggregate ring.
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  let dashoffset = $derived(CIRC * (1 - util / 100));
  function utilColor(p: number): string {
    return p >= 90 ? "var(--red)" : p >= 70 ? "var(--yellow)" : "var(--green)";
  }
  let ringColor = $derived(utilColor(util));

  // Per-core heatmap colour: a calm field of dim green that lights up amber
  // then red as a core saturates, so hot cores pop at a glance. Tokens match
  // the GPU card's temperature bands for cross-section consistency.
  function cellColor(b: number): string {
    if (b >= 85) return "#f87171";
    if (b >= 65) return "#fbbf24";
    if (b >= 40) return "#4ade80";
    if (b >= 15) return "rgba(74,222,128,0.55)";
    return "rgba(74,222,128,0.20)";
  }
  // Legend swatches, idle -> saturated.
  const LEGEND = [10, 30, 55, 75, 95];
</script>

<div class="cpu-card">
  <div class="cpu-head">
    <span class="cpu-title">CPU</span>
    {#if threads > 0}<span class="cpu-badge">{threads} core{threads === 1 ? "" : "s"}</span>{/if}
    {#if onViewHistory}
      <button class="hist-btn" onclick={() => onViewHistory?.({ kind: "cpu" })}>View history ↗</button>
    {/if}
  </div>

  <div class="cpu-top">
    <div class="donut">
      <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--bg-elevated)" stroke-width="11" />
        <circle
          cx="60" cy="60" r={R} fill="none" stroke={ringColor} stroke-width="11"
          stroke-linecap="round" stroke-dasharray={CIRC} stroke-dashoffset={dashoffset}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div class="donut-label"><span class="dl-val"><span class="dl-num" style="color:{ringColor}">{fmt(util)}</span><span class="dl-pct">%</span></span></div>
    </div>

    <div class="agg">
      <div class="agg-stats">
        <div class="agg-stat"><div class="k">Current</div><div class="v">{fmt(util)}%</div></div>
        {#if threads > 0}
          <div class="agg-stat"><div class="k">Avg core</div><div class="v">{fmt(avg)}%</div></div>
          <div class="agg-stat"><div class="k">Peak core</div><div class="v">{fmt(peak.val)}%{#if peak.idx >= 0}<span class="vsub"> C{peak.idx}</span>{/if}</div></div>
          <div class="agg-stat"><div class="k">Threads</div><div class="v">{threads}</div></div>
        {/if}
      </div>
      <div class="breakdown">
        <span><i style="background:var(--blue)"></i>User {fmt(user)}%</span>
        <span><i style="background:var(--accent)"></i>System {fmt(system)}%</span>
        <span><i style="background:var(--red)"></i>IOWait {fmt(iowait)}%</span>
      </div>
    </div>
  </div>

  {#if threads > 0}
    <div class="cores">
      <div class="cores-head">
        <span class="cores-label">Per-core load</span>
        <span class="legend">
          idle
          {#each LEGEND as l}<i class="sw" style="background:{cellColor(l)}"></i>{/each}
          busy
        </span>
      </div>
      <div class="heatmap">
        {#each cores as c, i}
          {@const b = busies[i]}
          {#if onViewHistory}
            <button
              class="cell"
              style="background:{cellColor(b)}"
              title="Core {c.core ?? i}: {fmt(b)}%"
              aria-label="Core {c.core ?? i}: {fmt(b)} percent, view history"
              onclick={() => onViewHistory?.({ kind: "core", index: i, label: `Core ${c.core ?? i}` })}
            ></button>
          {:else}
            <div class="cell" style="background:{cellColor(b)}" title="Core {c.core ?? i}: {fmt(b)}%"></div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .cpu-card {
    background: var(--surface); border: 1px solid var(--surface-border);
    border-left: 3px solid var(--accent); border-radius: 4px;
    padding: 18px 20px; display: flex; flex-direction: column; gap: 16px;
  }
  .cpu-head { display: flex; align-items: baseline; gap: 10px; }
  .cpu-title { font-size: 16px; font-weight: 600; }
  .cpu-badge {
    font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 4px;
    color: var(--text-secondary); border: 1px solid var(--surface-border);
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .hist-btn {
    margin-left: auto; background: var(--surface); border: 1px solid var(--surface-border);
    color: var(--text-secondary); border-radius: 4px; padding: 4px 11px;
    font-size: 12px; cursor: pointer; white-space: nowrap;
  }
  .hist-btn:hover { border-color: var(--accent); color: var(--accent); }

  .cpu-top { display: flex; align-items: center; gap: 28px; }
  @media (max-width: 640px) { .cpu-top { flex-direction: column; align-items: flex-start; gap: 16px; } }
  .donut { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
  .donut-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .dl-val { display: flex; align-items: baseline; }
  .dl-num { font-size: 30px; font-weight: 700; line-height: 1; }
  .dl-pct { font-size: 14px; font-weight: 600; color: var(--text-tertiary); margin-left: 2px; }
  .agg { flex: 1; min-width: 0; }
  .agg-stats { display: flex; gap: 30px; flex-wrap: wrap; }
  .agg-stat .k { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
  .agg-stat .v { font-size: 22px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .agg-stat .vsub { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .breakdown { display: flex; gap: 16px; margin-top: 14px; font-size: 12px; color: var(--text-secondary); flex-wrap: wrap; }
  .breakdown span { display: flex; align-items: center; gap: 6px; }
  .breakdown i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  .cores { border-top: 1px solid var(--surface-border); padding-top: 14px; }
  .cores-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .cores-label { font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); }
  .legend { margin-left: auto; display: flex; align-items: center; gap: 3px; font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
  .legend .sw { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }

  /* Fixed-size cells that wrap: one block per core, dense but readable at
     512 cores. Not stretched (no 1fr) so the grid stays a tidy field. */
  /* 15px cells are below the 24px tap-target floor, and that is deliberate.
     The density is the feature: this grid has to stay readable from 8 cores to
     512, and a 24px cell makes a 512-core host a full screen of squares. WCAG
     2.5.8 excepts a target whose presentation is essential, which this is. The
     information each cell carries is also available in the aggregate donut and
     the numbers beside it, so nothing here is reachable ONLY by hitting one
     15px square. Flagged by the visual audit and left alone on purpose. */
  .heatmap { display: grid; grid-template-columns: repeat(auto-fill, 15px); gap: 4px; }
  .cell { width: 15px; height: 15px; border-radius: 2px; padding: 0; border: none; }
  button.cell { cursor: pointer; transition: outline-color 0.1s; outline: 1.5px solid transparent; outline-offset: 1px; }
  button.cell:hover { outline-color: var(--accent); }
</style>
