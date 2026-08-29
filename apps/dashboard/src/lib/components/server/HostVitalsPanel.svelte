<script lang="ts">
  // Unified host-vitals section. CPU leads as a full hero card (donut +
  // per-core heatmap; it is on 100% of hosts), followed by the supporting
  // vitals as compact tiles (CPU temp, Memory, Load, Swap) in the GPU card
  // language, then a thermals/fans grid folded in from IPMI. Pure
  // presentational; values come from the latest snapshot.
  import CpuHeroCard from "./CpuHeroCard.svelte";
  import GpuPanel from "$lib/components/gpu/GpuPanel.svelte";

  interface Core {
    core?: number;
    idle_percent?: number;
    user_percent?: number;
    system_percent?: number;
    iowait_percent?: number;
  }
  interface Sensor { name?: string; value?: number | string; unit?: string; }

  type HistoryReq =
    | { kind: "cpu" }
    | { kind: "cpu_temp" }
    | { kind: "memory" }
    | { kind: "core"; index: number; label: string }
    | { kind: "gpu"; index: number; metric: "temp" | "power" | "vram" | "util"; label: string };

  interface Props {
    user?: number;
    system?: number;
    iowait?: number;
    idle?: number;
    cores?: Core[];
    cpuTempC?: number | null;
    cpuTempSource?: string | null;
    usedMb?: number;
    totalMb?: number;
    availableMb?: number;
    freeMb?: number;
    swapUsedMb?: number;
    swapTotalMb?: number;
    load1?: number;
    load5?: number;
    load15?: number;
    ipmiSensors?: Sensor[];
    // Whether OS-level GPU telemetry (nvidia-smi / tier1) is present. When it
    // is, redundant IPMI "GPU* Temp" sensors are dropped from the thermals
    // grid (the GPU cards below show the authoritative die temp); the IPMI
    // panel demotes them to "Other sensors" as a fallback.
    gpuAvailable?: boolean;
    // GPU snapshot blob. When gpuAvailable, the GPU cards lead the vitals so a
    // GPU host reads GPU-first (the whole point of a GPU box).
    gpu?: any;
    // Memory ECC counts, folded in from IPMI (ECC is a memory-health signal).
    ecc?: { correctable?: number; uncorrectable?: number } | number | null;
    // SMBIOS DIMM topology (Crucible 0.13.19+, /health memory_topology).
    // Null/absent (older agent or '' column default) hides the channels line.
    memoryTopology?: {
      available_channels?: number;
      populated_channels?: number;
      total_slots?: number;
      populated_slots?: number;
      dimms?: { socket?: number | null; channel?: string | null; populated?: boolean; speed_mts?: number | null; configured_mts?: number | null }[];
    } | null;
    onViewHistory?: (m: HistoryReq) => void;
  }

  let {
    user = 0, system = 0, iowait = 0, idle = 100, cores = [],
    cpuTempC = null, cpuTempSource = null,
    usedMb = 0, totalMb = 0, availableMb = 0, freeMb = 0, swapUsedMb = 0, swapTotalMb = 0,
    load1 = 0, load5 = 0, load15 = 0,
    ipmiSensors = [], gpuAvailable = false, gpu = null, ecc = null, memoryTopology = null, onViewHistory,
  }: Props = $props();

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  function gb(mb: number): string { return (mb / 1024).toFixed(1); }
  function utilColor(p: number): string {
    return p >= 90 ? "var(--red)" : p >= 70 ? "var(--yellow)" : "var(--green)";
  }

  let threads = $derived(cores.length);

  // ----- CPU temp ----- (bands aligned with cpu_temperature_high + GpuSubCard)
  let hasCpuTemp = $derived(typeof cpuTempC === "number" && Number.isFinite(cpuTempC));
  function tempColor(c: number): string {
    return c >= 85 ? "var(--red)" : c >= 70 ? "var(--yellow)" : "var(--green)";
  }

  // ----- Memory -----
  let usedPct = $derived(totalMb > 0 ? (usedMb / totalMb) * 100 : 0);
  let availMb = $derived(availableMb > 0 ? availableMb : Math.max(0, totalMb - usedMb));
  // Used = blue at healthy levels (green now means "free"), escalating to
  // yellow/red as it fills. Cache = amber, Free = green -- matches the memory
  // history chart's stacked palette.
  const MEM_USED_OK = "rgba(59,130,246,0.95)";
  const MEM_CACHE = "rgba(245,166,35,0.82)";
  const MEM_FREE = "rgba(70,185,138,0.8)";
  let memColor = $derived(usedPct >= 90 ? "var(--red)" : usedPct >= 75 ? "var(--yellow)" : MEM_USED_OK);
  let swapPct = $derived(swapTotalMb > 0 ? (swapUsedMb / swapTotalMb) * 100 : 0);
  // free_mb (Crucible 0.13.12+) splits the headroom: cache = available - free
  // is reclaimable page cache, free is genuinely idle. 0 means an older agent;
  // fall back to the plain used/available bar.
  let hasFree = $derived(freeMb > 0 && totalMb > 0);
  let cacheMb = $derived(Math.max(0, availMb - freeMb));
  let cachePct = $derived(totalMb > 0 ? (cacheMb / totalMb) * 100 : 0);
  let freePct = $derived(totalMb > 0 ? Math.max(0, 100 - usedPct - cachePct) : 0);

  // ----- Memory channels (SMBIOS DIMM topology, 0.13.19+) -----
  // Same semantics as the memory_channels_underpopulated rule: amber when
  // channels are empty or any DIMM runs below rated speed, muted otherwise.
  let topo = $derived(memoryTopology && (memoryTopology.available_channels ?? 0) > 0 ? memoryTopology : null);
  let chanUnder = $derived(topo ? (topo.populated_channels ?? 0) < (topo.available_channels ?? 0) : false);
  let chanDownclocked = $derived(
    topo?.dimms?.some((d) => d.populated && d.speed_mts != null && d.configured_mts != null && d.configured_mts < d.speed_mts) ?? false,
  );
  let chanTitle = $derived.by(() => {
    const generic = "Memory channels populated vs available (SMBIOS DIMM topology)";
    if (!topo?.dimms?.length) return generic;
    const bySocket = new Map<number, { pop: Set<string>; avail: Set<string> }>();
    for (const d of topo.dimms) {
      if (!d.channel) continue;
      const key = d.socket ?? 0;
      let b = bySocket.get(key);
      if (!b) { b = { pop: new Set(), avail: new Set() }; bySocket.set(key, b); }
      b.avail.add(d.channel);
      if (d.populated) b.pop.add(d.channel);
    }
    if (bySocket.size <= 1) return generic;
    const per = [...bySocket.entries()].sort((a, b) => a[0] - b[0])
      .map(([sock, b]) => `socket ${sock}: ${b.pop.size}/${b.avail.size}`).join(", ");
    return `${generic}. ${per}`;
  });

  // ----- Memory ECC (folded in from IPMI; ECC is a memory-health signal) -----
  let eccObj = $derived.by(() => {
    if (ecc == null) return null;
    return typeof ecc === "object" ? ecc : { correctable: ecc, uncorrectable: 0 };
  });
  let eccCorr = $derived(eccObj ? (eccObj.correctable ?? 0) : 0);
  let eccUncorr = $derived(eccObj ? (eccObj.uncorrectable ?? 0) : 0);
  let eccColor = $derived(eccUncorr > 0 ? "var(--red)" : eccCorr > 0 ? "var(--yellow)" : "var(--green)");

  // ----- Load -----
  let loadPct = $derived(threads > 0 ? clamp((load1 / threads) * 100) : null);

  // ----- IPMI temps + fans (folded in) -----
  const num = (v: any) => (typeof v === "number" ? v : Number(v));
  // Drop IPMI "GPU* Temp" sensors when OS GPU telemetry is present (the GPU
  // section shows the authoritative die temp); keep them as a fallback when it
  // isn't (no driver / nvidia-smi).
  let ipmiTemps = $derived(
    ipmiSensors.filter((s) => s.unit === "degrees C" && !(gpuAvailable && /gpu/i.test(s.name ?? ""))),
  );
  let ipmiFans = $derived(ipmiSensors.filter((s) => s.unit === "RPM"));
  function ipmiTempColor(c: number): string {
    if (!Number.isFinite(c)) return "var(--text-primary)";
    return c >= 75 ? "var(--red)" : c >= 60 ? "var(--yellow)" : "var(--green)";
  }
</script>

<div class="sec-head">
  <span class="sec-title">Host vitals</span>
  {#if threads > 0}<span class="sec-badge">{threads} core{threads === 1 ? "" : "s"}</span>{/if}
</div>

<!-- GPU leads on GPU hosts: it is the reason the box exists, so it sits above
     CPU/memory rather than buried below IPMI. Anchored id="gpu" for the nav. -->
{#if gpuAvailable && gpu}
  <div class="vitals-sub gpu-sub" id="gpu">GPU</div>
  <GpuPanel {gpu} {onViewHistory} />
  <div class="vitals-sub cpu-lead">CPU</div>
{/if}

<!-- CPU hero: donut + per-core heatmap. -->
<div id="cpu" class="cpu-anchor">
  <CpuHeroCard {user} {system} {iowait} {idle} {cores} {onViewHistory} />
</div>

<!-- Supporting vitals as compact tiles. Chartable tiles are buttons. -->
<div class="vitals-grid">
  {#if hasCpuTemp}
    <button class="tile clickable" onclick={() => onViewHistory?.({ kind: "cpu_temp" })} title="View CPU temperature history">
      <div class="tile-head"><span class="k">CPU temp</span><span class="hist">↗</span></div>
      <div class="v" style="color:{tempColor(cpuTempC ?? 0)}">{Math.round(cpuTempC ?? 0)}<span class="u">°C</span></div>
      <div class="sub">{cpuTempSource || "hwmon"}</div>
    </button>
  {/if}

  <button id="memory" class="tile clickable" onclick={() => onViewHistory?.({ kind: "memory" })} title="View memory history">
    <div class="tile-head"><span class="k">Memory</span><span class="hist">↗</span></div>
    <div class="v" style="color:{memColor}">{gb(usedMb)}<span class="u">GB</span></div>
    <div class="sub">{usedPct.toFixed(0)}% of {gb(totalMb)} GB</div>
    {#if topo}
      <div class="sub" style={chanUnder || chanDownclocked ? "color:var(--yellow)" : ""} title={chanTitle}>
        {topo.populated_channels}/{topo.available_channels} channels{chanDownclocked ? " · downclocked" : ""}
      </div>
    {/if}
    {#if hasFree}
      <div class="bar memseg" title="used {gb(usedMb)} GB &middot; cache {gb(cacheMb)} GB &middot; free {gb(freeMb)} GB">
        <div class="seg" style="width:{Math.max(usedPct, 1)}%;background:{memColor}"></div>
        <div class="seg" style="width:{cachePct}%;background:{MEM_CACHE}"></div>
        <div class="seg" style="width:{freePct}%;background:{MEM_FREE}"></div>
      </div>
      <div class="memleg">
        <span><i style="background:{memColor}"></i>used {gb(usedMb)} GB</span>
        <span><i style="background:{MEM_CACHE}"></i>cache {gb(cacheMb)} GB</span>
        <span><i style="background:{MEM_FREE}"></i>free {gb(freeMb)} GB</span>
      </div>
    {:else}
      <div class="bar"><div class="bar-fill" style="width:{Math.max(usedPct, 1)}%;background:{memColor}"></div></div>
    {/if}
  </button>

  {#if eccObj}
    <div class="tile" title="Memory ECC error counters (from IPMI/BMC)">
      <div class="tile-head"><span class="k">Memory ECC</span></div>
      <div class="v" style="color:{eccColor}">
        {#if eccUncorr > 0}{eccUncorr}<span class="u">uncorr</span>
        {:else if eccCorr > 0}{eccCorr}<span class="u">corr</span>
        {:else}0<span class="u">errors</span>{/if}
      </div>
      <div class="sub">correctable {eccCorr} &middot; uncorrectable {eccUncorr}</div>
    </div>
  {/if}

  <div class="tile">
    <div class="tile-head"><span class="k">Load (1m)</span></div>
    <div class="v">{load1.toFixed(2)}</div>
    <div class="sub">
      5m {load5.toFixed(2)} &middot; 15m {load15.toFixed(2)}{#if loadPct !== null} &middot; {loadPct.toFixed(0)}% of {threads}c{/if}
    </div>
    {#if loadPct !== null}<div class="bar"><div class="bar-fill" style="width:{Math.max(loadPct, 1)}%;background:{utilColor(loadPct)}"></div></div>{/if}
  </div>

  <div class="tile">
    <div class="tile-head"><span class="k">Swap</span></div>
    {#if swapTotalMb > 0}
      <div class="v" style="color:{swapPct >= 50 ? 'var(--yellow)' : 'var(--text-primary)'}">{gb(swapUsedMb)}<span class="u">GB</span></div>
      <div class="sub">of {gb(swapTotalMb)} GB &middot; {swapPct.toFixed(0)}%</div>
      <div class="bar"><div class="bar-fill" style="width:{Math.max(swapPct, 1)}%;background:var(--purple)"></div></div>
    {:else}
      <div class="v v-muted">off</div>
      <div class="sub">no swap configured</div>
    {/if}
  </div>
</div>

<!-- Thermals & fans (folded from the IPMI panel) -->
{#if ipmiTemps.length > 0 || ipmiFans.length > 0}
  <div class="vitals-sub">Thermals &amp; fans</div>
  <div class="thermal-grid">
    {#each ipmiTemps as t}
      <div class="mini-tile">
        <div class="mk">{t.name}</div>
        <div class="mv" style="color:{ipmiTempColor(num(t.value))}">{t.value}<span class="u">°C</span></div>
      </div>
    {/each}
    {#each ipmiFans as f}
      {@const spinning = num(f.value) > 0}
      <div class="mini-tile fan">
        <span class="fan-dot" style="background:{spinning ? 'var(--green)' : 'var(--red)'}"></span>
        <div class="fan-body">
          <div class="mk">{f.name}</div>
          <div class="mv">{f.value}<span class="u">rpm</span></div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .sec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .sec-title { font-size: 16px; font-weight: 600; }
  .sec-badge {
    font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 4px;
    color: var(--text-secondary); border: 1px solid var(--surface-border);
    text-transform: uppercase; letter-spacing: 0.03em;
  }

  /* Supporting tiles: GPU-card language. The CPU hero card renders above. */
  .vitals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; margin-top: 14px; }
  .tile {
    background: var(--surface); border: 1px solid var(--surface-border);
    border-radius: 4px; padding: 14px 16px; text-align: left;
    display: flex; flex-direction: column; gap: 6px;
  }
  .tile-head { display: flex; align-items: center; gap: 6px; }
  .tile .k { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
  .tile .hist { margin-left: auto; color: var(--text-tertiary); font-size: 13px; line-height: 1; opacity: 0.55; }
  .tile .v { font-size: 26px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .tile .v .u { font-size: 13px; font-weight: 600; color: var(--text-tertiary); margin-left: 3px; }
  .tile .v-muted { color: var(--text-tertiary); font-weight: 600; font-size: 20px; }
  .tile .sub { font-size: 12px; color: var(--text-tertiary); }
  .bar { height: 4px; border-radius: 2px; background: var(--bg-elevated); overflow: hidden; margin-top: 2px; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }

  /* Memory Used | Cache | Free: three stacked fills (blue used, amber cache,
     green free) covering the whole track, matching the history chart. */
  .memseg { display: flex; }
  .memseg .seg { height: 100%; transition: width 0.3s; }
  .memleg { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 6px; font-size: 12px; color: var(--text-tertiary); }
  .memleg span { display: inline-flex; align-items: center; gap: 4px; }
  .memleg i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex-shrink: 0; }

  button.tile { font: inherit; color: inherit; cursor: pointer; transition: border-color 0.15s; }
  button.tile.clickable:hover { border-color: var(--accent); }
  button.tile.clickable:hover .hist { color: var(--accent); opacity: 1; }

  .vitals-sub { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); margin: 18px 0 10px; }
  /* GPU leads on GPU hosts: tighter top gap since it follows the section head
     directly, and the CPU sub-label separates it from the CPU hero below. */
  .gpu-sub { margin-top: 4px; }
  .cpu-lead { margin-bottom: 10px; }
  .cpu-anchor { scroll-margin-top: 112px; }
  .thermal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; }
  .mini-tile { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; padding: 10px 12px; }
  .mini-tile .mk { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini-tile .mv { font-size: 18px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .mini-tile .mv .u { font-size: 12px; font-weight: 500; color: var(--text-tertiary); margin-left: 2px; }
  .mini-tile.fan { display: flex; align-items: center; gap: 9px; }
  .mini-tile.fan .fan-body { flex: 1; min-width: 0; }
  .fan-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
</style>
