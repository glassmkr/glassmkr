<script lang="ts">
  // Per-GPU sub-card. Renders one entry from snap.gpu.tier1.gpus[].
  // Sized to sit in a 1-col layout on single-GPU hosts and a 2-col
  // grid on multi-GPU hosts (the parent GpuPanel decides the grid).
  //
  // Per CC_SPEC_GPU_UI_SURFACES_2026-05-19.md §1.2.

  import type { Snapshot } from "$lib/server/alerts/evaluator";

  type Tier1Available = Extract<
    NonNullable<NonNullable<Snapshot["gpu"]>["tier1"]>,
    { available: true }
  >;
  type Gpu = Tier1Available["gpus"][number];

  interface Props {
    gpu: Gpu;
    // When provided, the Temp / Power / VRAM tiles become clickthroughs to
    // that GPU metric's time-series (matches the host-vitals tile pattern).
    onViewHistory?: (m: {
      kind: "gpu";
      index: number;
      metric: "temp" | "power" | "vram" | "util";
      label: string;
    }) => void;
  }

  let { gpu, onViewHistory }: Props = $props();

  // Temperature colour bands per the spec; thresholds align with
  // the gpu_thermal_critical rule (>= 90C critical) so the visual
  // signal precedes the page.
  let tempBand = $derived<"cool" | "warm" | "hot">(
    gpu.temp_c >= 85 ? "hot" : gpu.temp_c >= 70 ? "warm" : "cool",
  );

  let powerPct = $derived(
    gpu.power_limit_w > 0 ? Math.round((gpu.power_draw_w / gpu.power_limit_w) * 100) : 0,
  );
  let vramPct = $derived(
    gpu.vram_total_mib > 0
      ? Math.round((gpu.vram_used_mib / gpu.vram_total_mib) * 100)
      : 0,
  );

  // PCIe degraded check matches the gpu_pcie_link_degraded rule.
  let pcieDegraded = $derived(
    (gpu.pcie_link_gen_max > 0 && gpu.pcie_link_gen_current < gpu.pcie_link_gen_max) ||
      (gpu.pcie_link_width_max > 0 &&
        gpu.pcie_link_width_current < gpu.pcie_link_width_max),
  );

  function fmtMiB(mib: number): string {
    return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${mib} MiB`;
  }

  // Throttle reasons -> human label + colour band.
  // Mirrors the labels Crucible's enrichThrottleReasons() emits.
  function throttleLabel(r: string): { label: string; band: "warn" | "crit" } {
    switch (r) {
      case "hw_slowdown":
        return { label: "HW slowdown", band: "crit" };
      case "hw_thermal_slowdown":
        return { label: "HW thermal slowdown", band: "crit" };
      case "hw_power_brake":
        return { label: "HW power brake", band: "crit" };
      case "sw_thermal_slowdown":
        return { label: "Thermal throttle", band: "warn" };
      case "sw_power_cap":
        return { label: "Power cap", band: "warn" };
      case "gpu_idle":
        return { label: "Idle", band: "warn" };
      case "applications_clocks_setting":
        return { label: "App clocks", band: "warn" };
      case "sync_boost":
        return { label: "Sync boost", band: "warn" };
      case "display_clock_setting":
        return { label: "Display clock", band: "warn" };
      default:
        return { label: r, band: "warn" };
    }
  }

  let activeReasons = $derived(gpu.performance_state_reasons ?? []);
  let nvlinkDown = $derived(
    (gpu.nvlink_links ?? []).filter((l) => l.state === "down"),
  );
  let nvlinkUp = $derived(
    (gpu.nvlink_links ?? []).filter((l) => l.state === "up"),
  );
</script>

<div class="gpu-sub-card">
  <header class="gpu-header">
    <span class="gpu-index">GPU {gpu.index}</span>
    <span class="gpu-name">{gpu.name}</span>
    <span class="gpu-uuid" title={gpu.uuid}>{gpu.uuid.slice(0, 12)}…</span>
  </header>

  <div class="metrics-grid">
    <!-- Temperature -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svelte:element
      this={onViewHistory ? "button" : "div"}
      class="metric metric-temp"
      class:clickable={onViewHistory}
      title={onViewHistory ? "View temperature history" : undefined}
      onclick={() => onViewHistory?.({ kind: "gpu", index: gpu.index, metric: "temp", label: `GPU ${gpu.index} temp` })}
    >
      <span class="metric-label">Temp{#if onViewHistory}<span class="hist">↗</span>{/if}</span>
      <span class="metric-value temp-{tempBand}">{gpu.temp_c}°C</span>
    </svelte:element>

    <!-- Power -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svelte:element
      this={onViewHistory ? "button" : "div"}
      class="metric"
      class:clickable={onViewHistory}
      title={onViewHistory ? "View power history" : undefined}
      onclick={() => onViewHistory?.({ kind: "gpu", index: gpu.index, metric: "power", label: `GPU ${gpu.index} power` })}
    >
      <span class="metric-label">Power{#if onViewHistory}<span class="hist">↗</span>{/if}</span>
      <span class="metric-value">
        {gpu.power_draw_w}W / {gpu.power_limit_w}W
      </span>
      <div class="bar"><div class="bar-fill" style:width="{powerPct}%"></div></div>
    </svelte:element>

    <!-- VRAM -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svelte:element
      this={onViewHistory ? "button" : "div"}
      class="metric"
      class:clickable={onViewHistory}
      title={onViewHistory ? "View VRAM history" : undefined}
      onclick={() => onViewHistory?.({ kind: "gpu", index: gpu.index, metric: "vram", label: `GPU ${gpu.index} VRAM` })}
    >
      <span class="metric-label">VRAM{#if onViewHistory}<span class="hist">↗</span>{/if}</span>
      <span class="metric-value">
        {fmtMiB(gpu.vram_used_mib)} / {fmtMiB(gpu.vram_total_mib)}
      </span>
      <div class="bar"><div class="bar-fill" style:width="{vramPct}%"></div></div>
    </svelte:element>
  </div>

  <!-- ECC + retired pages -->
  <div class="ecc-row">
    {#if gpu.ecc_mode_current}
      <span class="ecc-pill ecc-on">ECC: on</span>
    {:else}
      <!-- Workstation cards (RTX A4000) default ECC off. Not red;
           often intentional. -->
      <span class="ecc-pill ecc-off">ECC: off</span>
    {/if}
    {#if gpu.ecc_mode_current}
      <span class="ecc-stat">
        Corrected:
        <strong class:trend-up={gpu.ecc_errors_corrected_aggregate > 100}>
          {gpu.ecc_errors_corrected_aggregate}
        </strong>
      </span>
      <span class="ecc-stat" class:ecc-alert={gpu.ecc_errors_uncorrected_aggregate > 0}>
        Uncorrected: <strong>{gpu.ecc_errors_uncorrected_aggregate}</strong>
      </span>
      {#if gpu.retired_pages_double_bit != null}
        <span
          class="ecc-stat"
          class:ecc-alert={(gpu.retired_pages_double_bit ?? 0) > 0}
        >
          Retired (DBE): <strong>{gpu.retired_pages_double_bit}</strong>
        </span>
      {/if}
      {#if (gpu.retired_pages_pending ?? 0) > 0}
        <span class="ecc-stat ecc-alert">
          Reboot pending ({gpu.retired_pages_pending} page{(gpu.retired_pages_pending ?? 0) === 1 ? "" : "s"})
        </span>
      {/if}
    {/if}
  </div>

  <!-- PCIe row -->
  <div class="pcie-row" class:pcie-degraded={pcieDegraded}>
    PCIe Gen {gpu.pcie_link_gen_current} x{gpu.pcie_link_width_current}
    {#if pcieDegraded}
      <span class="pcie-warn">
        (max Gen {gpu.pcie_link_gen_max} x{gpu.pcie_link_width_max})
      </span>
    {/if}
  </div>

  <!-- Throttle reasons (only when active) -->
  {#if activeReasons.length > 0}
    <div class="throttle-row">
      {#each activeReasons as r}
        {@const t = throttleLabel(r)}
        <span class="throttle-tag throttle-{t.band}">{t.label}</span>
      {/each}
    </div>
  {/if}

  <!-- NVLink row (only when present) -->
  {#if (gpu.nvlink_links ?? []).length > 0}
    <div class="nvlink-row">
      <span class="nvlink-label">NVLink:</span>
      {#if nvlinkDown.length > 0}
        <span class="nvlink-down">
          {nvlinkDown.length} down
          (link {nvlinkDown.map((l) => l.link_id).join(", ")})
        </span>
      {/if}
      {#if nvlinkUp.length > 0}
        <span class="nvlink-up">{nvlinkUp.length} up</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gpu-sub-card {
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .gpu-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .gpu-index {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .gpu-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .gpu-uuid {
    font-size: 12px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, ui-monospace, monospace);
    cursor: help;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .metric-label {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .metric-value {
    font-size: 14px;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .metric-temp .metric-value {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.1;
  }
  .temp-cool { color: #4ade80; }
  .temp-warn,
  .temp-warm { color: #fbbf24; }
  .temp-hot { color: #f87171; }

  /* Clickable metric tiles (when onViewHistory is wired): reset button
     chrome and add a subtle amber hover hint, matching the host-vitals
     tile clickthrough. The tiles aren't bordered, so the hover signal is
     the arrow turning accent and the value brightening. */
  button.metric {
    font: inherit; color: inherit; text-align: left; width: 100%;
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .metric-label .hist { margin-left: 5px; color: var(--text-tertiary); opacity: 0.5; font-size: 12px; }
  button.metric.clickable:hover .metric-value { filter: brightness(1.12); }
  button.metric.clickable:hover .hist { color: var(--accent); opacity: 1; }

  .bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }

  .ecc-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .ecc-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .ecc-on { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
  .ecc-off { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }
  .ecc-stat strong { color: var(--text-primary); font-weight: 600; }
  .ecc-stat .trend-up { color: #fbbf24; }
  .ecc-alert { color: #f87171; }
  .ecc-alert strong { color: #f87171; }

  .pcie-row {
    font-size: 12px;
    color: var(--text-secondary);
    padding-top: 4px;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);
  }
  .pcie-degraded { color: #fbbf24; }
  .pcie-warn { color: #fbbf24; font-size: 12px; }

  .throttle-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .throttle-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .throttle-warn { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
  .throttle-crit { background: rgba(229, 86, 75, 0.15); color: #f87171; }

  .nvlink-row {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .nvlink-label {
    color: var(--text-tertiary);
    margin-right: 6px;
  }
  .nvlink-up { color: #4ade80; }
  .nvlink-down { color: #f87171; }
</style>
