<script lang="ts">
  // On-demand historical chart, opened from a vitals tile's clickthrough
  // (CPU / CPU temp / Memory / per-core) or a GPU metric tile. Fetches the
  // metrics time-series and renders it with uPlot. uPlot CSS is bundled
  // (not CDN) so it renders under the prod CSP.
  import { api } from "$lib/utils/api";
  import "uplot/dist/uPlot.min.css";

  export type HistoryMetric =
    | { kind: "cpu" }
    | { kind: "cpu_temp" }
    | { kind: "memory" }
    | { kind: "core"; index: number; label: string }
    | { kind: "gpu"; index: number; metric: "temp" | "power" | "vram" | "util"; label: string };

  interface Props {
    serverId: string;
    metric: HistoryMetric;
    onClose: () => void;
  }
  let { serverId, metric, onClose }: Props = $props();

  const RANGES = [
    { label: "1h", hours: 1 },
    { label: "6h", hours: 6 },
    { label: "24h", hours: 24 },
    { label: "7d", hours: 168 },
    { label: "30d", hours: 720 },
  ];
  let hours = $state(24);
  let chartEl: HTMLDivElement | undefined = $state();
  let ttEl: HTMLDivElement | undefined = $state();
  let legendItems = $state<{ label: string; color: string }[]>([]);
  let empty = $state(false);
  let loading = $state(true);
  let chart: any = null;
  let uPlotMod: any = $state(null);

  // Tooltip header timestamp, e.g. "Jul 3, 14:05" (browser-local, matching the axis).
  const fmtTs = (s: number) =>
    new Date(s * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  let title = $derived(
    metric.kind === "cpu" ? "CPU utilization"
      : metric.kind === "cpu_temp" ? "CPU temperature"
      : metric.kind === "memory" ? "Memory used"
      : metric.kind === "gpu" ? metric.label
      : `${metric.label} utilization`,
  );

  // Per-metric value unit, used for the y-axis ticks + the cursor legend.
  let unit = $derived(
    metric.kind === "memory" ? "GB"
      : metric.kind === "cpu_temp" ? "C"
      : metric.kind === "gpu" ? (metric.metric === "temp" ? "C" : metric.metric === "power" ? "W" : "%")
      : "%",
  );

  const pct = (_: any, v: number) => (v != null ? v.toFixed(1) + "%" : "");
  const gbFmt = (_: any, v: number) => (v != null ? v.toFixed(1) + " GB" : "");
  const degFmt = (_: any, v: number) => (v != null ? v.toFixed(0) + " °C" : "");
  const wattFmt = (_: any, v: number) => (v != null ? v.toFixed(0) + " W" : "");

  const accent = "rgba(255, 107, 53,0.95)";

  function destroy() {
    if (chart) { chart.destroy(); chart = null; }
  }

  async function build() {
    if (!uPlotMod || !chartEl) return;
    destroy();
    loading = true;
    empty = false;
    try {
      const res: any = await api(`/api/v1/servers/${serverId}/metrics?hours=${hours}`);
      const rows = res.data ?? [];
      const cores = res.cpuCores ?? [];
      const thermalRows = res.thermal ?? [];
      const gpuRows = res.gpu ?? [];
      const reboots: any[] = res.reboots ?? [];

      let xs: number[];
      let series: any[];
      let data: (number | null)[][];
      let memTotalMaxGB = 0; // set in the memory branch; caps that chart's y-axis at total
      // ClickHouse (JSONEachRow) returns bucket timestamps as naive UTC
      // strings like "2026-07-03 14:00:00" (no zone). `new Date(str)` would
      // parse those as BROWSER-LOCAL, shifting every point by the UTC offset
      // (e.g. +2h in CEST) so the data falls outside the pinned x-window,
      // rendering empty/gapped charts. Force UTC. Also accept epoch numbers.
      const secs = (t: any) => {
        if (typeof t === "number") return Math.floor(t > 1e12 ? t / 1000 : t);
        const s = String(t).trim();
        const hasZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
        const iso = hasZone ? s : s.replace(" ", "T") + "Z";
        return Math.floor(new Date(iso).getTime() / 1000);
      };

      // Area fill that fades to transparent at the baseline (the flat-block
      // fills read as unfinished). `rgb` is an "rgba(r,g,b," prefix.
      const grad = (rgb: string, alpha: number) => (u: any) => {
        const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
        g.addColorStop(0, rgb + alpha + ")");
        g.addColorStop(1, rgb + "0)");
        return g;
      };

      if (metric.kind === "memory") {
        xs = rows.map((r: any) => secs(r.ts));
        const usedGB: number[] = rows.map((r: any) => Number(r.ram_used ?? r.ram_used_mb ?? 0) / 1024);
        const totalGB: number[] = rows.map((r: any) => Number(r.ram_total ?? r.ram_total_mb ?? 0) / 1024);
        const freeGB: number[] = rows.map((r: any) => Number(r.ram_free ?? 0) / 1024);
        const availGB: number[] = rows.map((r: any) => Number(r.ram_available ?? 0) / 1024);
        memTotalMaxGB = totalGB.length ? Math.max(0, ...totalGB) : 0;
        // Palette matches the live Memory tile: Used = blue, Buff/Cache = amber,
        // Free = green (green reads as "available", not "used").
        const cUsed = "rgba(59,130,246,", cCache = "rgba(255, 107, 53,", cFree = "rgba(70,185,138,";
        const usedStyle = { label: "Used", stroke: cUsed + "0.95)", width: 2, fill: grad(cUsed, 0.3), value: gbFmt };
        // Stacked legend shows the real band size, not the cumulative height.
        const band = (u: any, v: number | null, sidx: number, i: number) => {
          const nxt = u.data[sidx + 1]?.[i];
          return gbFmt(u, (v ?? 0) - (typeof nxt === "number" ? nxt : 0));
        };
        if (freeGB.some((v) => v > 0)) {
          // Stacked area filling 0..total: Used (bottom) -> Buff/Cache -> Free
          // (top). Series carry CUMULATIVE heights and are drawn largest-first
          // so each fills its band over the one beneath; `band` recovers the
          // real per-segment value for the legend/cursor.
          const cacheGB = usedGB.map((u, i) => Math.max(0, totalGB[i] - u - freeGB[i]));
          const usedPlusCache = usedGB.map((u, i) => u + cacheGB[i]);
          data = [xs, totalGB, usedPlusCache, usedGB];
          series = [
            {},
            { label: "Free",  stroke: cFree + "0.85)",  width: 1, fill: cFree + "0.8)",  value: band },
            { label: "Cache", stroke: cCache + "0.85)", width: 1, fill: cCache + "0.82)", value: band },
            { label: "Used",  stroke: cUsed + "0.95)",  width: 1, fill: cUsed + "0.85)", value: band },
          ];
        } else if (availGB.some((v) => v > 0)) {
          // Older agent (no MemFree): Used (filled) + how much is still allocatable.
          data = [xs, usedGB, availGB];
          series = [{}, usedStyle, { label: "Available", stroke: cFree + "0.9)", width: 1.25, value: gbFmt }];
        } else {
          data = [xs, usedGB];
          series = [{}, usedStyle];
        }
      } else if (metric.kind === "cpu_temp") {
        xs = thermalRows.map((r: any) => secs(r.ts));
        data = [xs, thermalRows.map((r: any) => (r.maxCpuC == null ? null : Number(r.maxCpuC)))];
        series = [{}, { label: "CPU temp", stroke: "rgba(229,86,75,0.9)", width: 2, fill: grad("rgba(229,86,75,", 0.22), value: degFmt }];
      } else if (metric.kind === "gpu") {
        const m = metric;
        xs = gpuRows.map((r: any) => secs(r.ts));
        const pick = (row: any): number | null => {
          const dev = (row.gpus ?? []).find((g: any) => g.index === m.index);
          if (!dev) return null;
          if (m.metric === "temp") return dev.tempC ?? null;
          if (m.metric === "power") return dev.powerW ?? null;
          if (m.metric === "util") return dev.utilGpu ?? null;
          // vram -> percent used
          return dev.vramTotalMib > 0 && dev.vramUsedMib != null
            ? (dev.vramUsedMib / dev.vramTotalMib) * 100
            : null;
        };
        const valFmt = m.metric === "temp" ? degFmt : m.metric === "power" ? wattFmt : pct;
        data = [xs, gpuRows.map((r: any) => pick(r))];
        series = [{}, { label: m.label, stroke: accent, width: 2, fill: grad("rgba(255, 107, 53,", 0.22), value: valFmt }];
      } else if (metric.kind === "core") {
        xs = cores.map((c: any) => secs(c.ts));
        data = [
          xs,
          cores.map((c: any) => {
            const core = c.cores?.[metric.index];
            const idle = core?.idle_percent;
            return typeof idle === "number" ? Math.max(0, Math.min(100, 100 - idle)) : 0;
          }),
        ];
        series = [{}, { label: metric.label, stroke: accent, width: 2, fill: grad("rgba(255, 107, 53,", 0.22), value: pct }];
      } else {
        xs = rows.map((r: any) => secs(r.ts));
        data = [
          xs,
          rows.map((r: any) => Number(r.cpu_user ?? r.cpu_user_percent ?? 0)),
          rows.map((r: any) => Number(r.cpu_system ?? r.cpu_system_percent ?? 0)),
          rows.map((r: any) => Number(r.cpu_iowait ?? r.cpu_iowait_percent ?? 0)),
        ];
        series = [
          {},
          { label: "User", stroke: "rgba(59,130,246,0.95)", width: 1.5, fill: "rgba(59,130,246,0.10)", value: pct },
          { label: "System", stroke: accent, width: 1.5, value: pct },
          { label: "IOWait", stroke: "rgba(229, 86, 75,0.9)", width: 1.5, value: pct },
        ];
      }

      if (!xs.length) { empty = true; loading = false; legendItems = []; return; }

      // Pin the x-axis to the SELECTED window [now - range, now] instead of
      // letting uPlot auto-fit to the data extent. Without this, a host with
      // only (say) 1h of history shows the same ~1h axis whether you pick 1h
      // or 30d, so the range selector looks broken; sparse data now renders
      // honestly as a cluster inside the full selected window.
      const nowSec = Math.floor(Date.now() / 1000);
      const xRange: [number, number] = [nowSec - hours * 3600, nowSec];

      // Pin the y-axis to a meaningful ceiling instead of letting uPlot
      // auto-fit to the data max, which made a 12%-CPU peak look like it was
      // maxing out. Percentages -> 0..100; temperature -> 0..105 (throttle
      // sits ~85-95C); memory -> 0..known total; power (W) stays auto (the
      // ceiling varies by card).
      let yRange: [number, number] | undefined;
      if (unit === "%") yRange = [0, 100];
      else if (unit === "C") yRange = [0, 105];
      else if (metric.kind === "memory" && memTotalMaxGB > 0) {
        yRange = [0, Math.ceil(memTotalMaxGB)];
      }

      // Reboot/crash markers (host-wide, so every chart shows them) + the GPU
      // thermal-throttle threshold line. Drawn as a canvas overlay after the
      // series; best-effort (wrapped) so an overlay glitch never blanks a chart.
      const rebootSecs = reboots.map((t) => secs(t)).filter((n) => Number.isFinite(n));
      const isGpuTemp = metric.kind === "gpu" && metric.metric === "temp";
      const overlay = (u: any) => {
        try {
          const ctx = u.ctx;
          const { left, top, width, height } = u.bbox;
          for (const rs of rebootSecs) {
            if (rs < xRange[0] || rs > xRange[1]) continue;
            const x = Math.round(u.valToPos(rs, "x", true));
            ctx.save();
            ctx.strokeStyle = "rgba(229, 86, 75,0.55)";
            ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
            ctx.restore();
          }
          if (isGpuTemp) {
            const y = Math.round(u.valToPos(83, "y", true));
            if (y >= top && y <= top + height) {
              ctx.save();
              ctx.strokeStyle = "rgba(255, 107, 53,0.7)";
              ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = "rgba(255, 107, 53,0.9)";
              ctx.font = "11px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
              ctx.fillText("83°C throttle", left + width - 4, y - 3);
              ctx.restore();
            }
          }
        } catch { /* overlay is best-effort */ }
      };

      // Compact top-right legend (the built-in bottom legend with its
      // "USED: _" placeholder row is uPlot's most unfinished-looking piece).
      legendItems = series.slice(1).map((s: any) => ({
        label: s.label,
        color: typeof s.stroke === "string" ? s.stroke : "var(--accent)",
      }));

      // Per-metric y-tick suffix.
      const yFmt = (v: number) =>
        unit === "%" ? v.toFixed(0) + "%"
          : unit === "C" ? v.toFixed(0) + "°"
            : unit === "W" ? v.toFixed(0) + "W"
              : unit === "GB" ? v.toFixed(0) + " GB"
                : String(v);

      const axisFont = '11px Geist, ui-sans-serif, system-ui, sans-serif';
      const tickColor = "rgba(255,255,255,0.45)";
      const gridColor = "rgba(255,255,255,0.07)";

      // Follow-the-cursor tooltip driven by uPlot's setCursor hook.
      const tooltip = (u: any) => {
        if (!ttEl) return;
        const { idx, left } = u.cursor;
        if (idx == null || left == null || left < 0) { ttEl.style.opacity = "0"; return; }
        const ts = u.data[0][idx];
        let rows = "";
        for (let si = 1; si < u.series.length; si++) {
          const s = u.series[si];
          if (s.show === false) continue;
          const raw = u.data[si][idx];
          if (raw == null) continue;
          const val = s.value ? s.value(u, raw, si, idx) : raw;
          const col = typeof s.stroke === "string" ? s.stroke : "var(--accent)";
          rows += `<div class="tt-row"><span class="tt-dot" style="background:${col}"></span><span class="tt-lbl">${s.label}</span><span class="tt-val">${val}</span></div>`;
        }
        if (!rows) { ttEl.style.opacity = "0"; return; }
        ttEl.innerHTML = `<div class="tt-time">${fmtTs(ts)}</div>${rows}`;
        ttEl.style.opacity = "1";
        // Clamp within the plot; flip to the left of the cursor near the right edge.
        const pad = 14, w = ttEl.offsetWidth;
        let x = left + pad;
        if (x + w > u.bbox.width / devicePixelRatio) x = left - pad - w;
        ttEl.style.transform = `translate(${Math.max(0, x)}px, 12px)`;
      };

      chart = new uPlotMod(
        {
          width: chartEl.clientWidth || 760,
          height: 340,
          padding: [10, 12, 4, 6],
          legend: { show: false },
          cursor: {
            show: true,
            points: { size: 6, width: 2 },
            focus: { prox: 30 },
          },
          scales: { x: { time: true, range: xRange }, ...(yRange ? { y: { range: yRange } } : {}) },
          hooks: { draw: [overlay], setCursor: [tooltip] },
          axes: [
            {
              stroke: tickColor, font: axisFont, size: 34,
              grid: { stroke: gridColor, width: 1 },
              ticks: { stroke: gridColor, width: 1, size: 4 },
            },
            {
              stroke: tickColor, font: axisFont, size: 46, gap: 6,
              grid: { stroke: gridColor, width: 1 },
              ticks: { show: false },
              values: (_: any, ticks: number[]) => ticks.map(yFmt),
            },
          ],
          series,
        },
        data,
        chartEl,
      );
      loading = false;
    } catch {
      empty = true;
      loading = false;
      legendItems = [];
    }
  }

  // Load uPlot once, then (re)build whenever the range, the chart target, or
  // the selected metric changes.
  $effect(() => {
    if (typeof window === "undefined") return;
    import("uplot").then((m) => { uPlotMod = (m as any).default ?? m; });
  });
  $effect(() => {
    // Track metric so switching tiles while open rebuilds the chart.
    void metric;
    if (uPlotMod && chartEl && serverId && hours) build();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  // Render the overlay as a direct child of <body> so its position:fixed
  // resolves against the viewport, never against a transformed / filtered /
  // contained / backdrop-filtered page ancestor (which reparents fixed
  // descendants and was offsetting + clipping the modal in some environments).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" role="presentation" use:portal onclick={onClose}>
  <div class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-label={title} onclick={(e) => e.stopPropagation()}>
    <header class="head">
      <h3>{title}</h3>
      <div class="ranges">
        {#each RANGES as r}
          <button class="pill" class:active={hours === r.hours} onclick={() => (hours = r.hours)}>{r.label}</button>
        {/each}
      </div>
      <button class="close" aria-label="Close" onclick={onClose}>&times;</button>
    </header>
    {#if legendItems.length}
      <div class="legend">
        {#each legendItems as it}
          <span class="legend-item"><i style="background:{it.color}"></i>{it.label}</span>
        {/each}
      </div>
    {/if}
    <div class="chart-wrap">
      <div bind:this={chartEl} class="chart"></div>
      <div bind:this={ttEl} class="tooltip"></div>
      {#if loading}<p class="state">Loading...</p>{:else if empty}<p class="state">No metric history for this window yet.</p>{/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .modal {
    background: var(--bg); border: 1px solid var(--surface-border); border-radius: 4px;
    width: 100%; max-width: 880px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,0.5);
  }
  .head { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-bottom: 1px solid var(--surface-border); }
  .head h3 { font-size: 16px; font-weight: 600; margin: 0; }
  .ranges { display: flex; gap: 4px; margin-left: auto; }
  .pill { font-size: 12px; padding: 4px 11px; border-radius: 4px; cursor: pointer; background: var(--surface); border: 1px solid var(--surface-border); color: var(--text-secondary); }
  .pill.active { background: var(--accent-glow); border-color: rgba(255, 107, 53,0.4); color: var(--accent); font-weight: 600; }
  .close { background: none; border: none; color: var(--text-tertiary); font-size: 24px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .close:hover { color: var(--text-primary); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 12px 22px 0; }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
  .legend-item i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
  .chart-wrap { padding: 8px 20px 20px; position: relative; min-height: 356px; }
  .chart { width: 100%; }
  .state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: 13px; }
  /* Cursor tooltip: styled card, positioned by uPlot's setCursor hook. */
  .tooltip {
    position: absolute; top: 8px; left: 20px; pointer-events: none; opacity: 0;
    transition: opacity 0.1s; z-index: 5; min-width: 120px;
    background: var(--bg-elevated, rgba(20,22,28,0.97)); border: 1px solid var(--surface-border);
    border-radius: 4px; padding: 8px 10px; box-shadow: 0 8px 24px -8px rgba(0,0,0,0.7);
    font-size: 12px; line-height: 1.5;
  }
  .tooltip :global(.tt-time) { color: var(--text-tertiary); font-size: 12px; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
  .tooltip :global(.tt-row) { display: flex; align-items: center; gap: 7px; }
  .tooltip :global(.tt-dot) { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .tooltip :global(.tt-lbl) { color: var(--text-secondary); margin-right: auto; }
  .tooltip :global(.tt-val) { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
