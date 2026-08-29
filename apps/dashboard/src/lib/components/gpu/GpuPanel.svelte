<script lang="ts">
  // Top-level GPU panel. Renders when the parent has already gated
  // on snap.gpu.tier1.available === true. Per CC_SPEC_GPU_UI_
  // SURFACES_2026-05-19.md §1.1.
  //
  // Distinct visual treatment per Simon's 2026-05-19 decision:
  // left accent border on each sub-card, tier pill in the header,
  // collapsible XID event log below the sub-card grid.

  import type { Snapshot } from "$lib/server/alerts/evaluator";
  import GpuSubCard from "./GpuSubCard.svelte";
  import GpuXidEventLog from "./GpuXidEventLog.svelte";

  interface Props {
    gpu: NonNullable<Snapshot["gpu"]>;
    // Threaded to each sub-card so its Temp / Power / VRAM tiles open the
    // metric-history modal.
    onViewHistory?: (m: {
      kind: "gpu";
      index: number;
      metric: "temp" | "power" | "vram" | "util";
      label: string;
    }) => void;
  }

  let { gpu, onViewHistory }: Props = $props();

  type Tier1Available = Extract<
    NonNullable<NonNullable<Snapshot["gpu"]>["tier1"]>,
    { available: true }
  >;

  // The parent gates on tier1.available but we narrow defensively
  // so the rest of this component can use the typed shape.
  let tier1 = $derived(
    gpu.tier1 && "available" in gpu.tier1 && gpu.tier1.available
      ? (gpu.tier1 as Tier1Available)
      : null,
  );

  let tierLabel = $derived.by(() => {
    const t1 = tier1 !== null;
    const t2 =
      gpu.tier2 && "available" in gpu.tier2 && gpu.tier2.available === true;
    const t3 =
      gpu.tier3 && "available" in gpu.tier3 && gpu.tier3.available === true;
    if (t1 && t2 && t3) return "Tier 1+2+3";
    if (t1 && t2) return "Tier 1+2";
    return t1 ? "Tier 1" : "(no tier active)";
  });

  let tierTooltip =
    "Tier 1 = nvidia-smi; Tier 2 = DCGM (nv-hostengine); Tier 3 = Redfish OEM. More tiers = richer telemetry but Tier 1 alone covers the eight GPU rules.";

  let tier2Status = $derived.by(() => {
    if (!gpu.tier2) return "Tier 2 (DCGM): not present";
    if ("available" in gpu.tier2 && gpu.tier2.available)
      return "Tier 2 (DCGM): available";
    return `Tier 2 (DCGM): ${(gpu.tier2 as { reason?: string }).reason ?? "unavailable"}`;
  });

  let tier3Status = $derived.by(() => {
    if (!gpu.tier3) return "Tier 3 (Redfish OEM): not present";
    if ("available" in gpu.tier3 && gpu.tier3.available)
      return "Tier 3 (Redfish OEM): available";
    return `Tier 3 (Redfish OEM): ${(gpu.tier3 as { reason?: string }).reason ?? "unavailable"}`;
  });

  // Build a bdf -> {index, name} map so the XID event log can show
  // "GPU 0 (NVIDIA L4)" instead of just the raw BDF.
  let gpuByBdf = $derived(
    Object.fromEntries(
      (tier1?.gpus ?? []).map((g) => [
        // Crucible normalises BDFs to "00000000:01:00.0" but the
        // dmesg XID line carries "0000:01:00" — strip the trailing
        // ".N" function to match.
        g.pci_bdf.replace(/\.[^.]+$/, "").replace(/^0+:/, "0:"),
        { index: g.index, name: g.name },
      ]),
    ),
  );

  let gpuCount = $derived(tier1?.gpus.length ?? 0);
</script>

{#if tier1}
  <div class="gpu-panel">
    <!-- Meta strip rather than a heading: the parent page (server
         detail) already renders an h2 "GPU" with anchor id="gpu";
         repeating "GPU" here renders as a double-title (issue raised
         2026-05-21). -->
    <header class="gpu-panel-header">
      <span class="gpu-count" title="GPU count from nvidia-smi">{gpuCount} {gpuCount === 1 ? "device" : "devices"}</span>
      <span class="tier-pill" title={tierTooltip}>{tierLabel}</span>
      <span class="driver-pill" title="NVIDIA driver version (from nvidia-smi)">
        Driver {tier1.driver_version}
      </span>
    </header>

    <div class="gpu-grid" class:grid-multi={gpuCount > 1}>
      {#each tier1.gpus as g (g.uuid)}
        <GpuSubCard gpu={g} {onViewHistory} />
      {/each}
    </div>

    <GpuXidEventLog events={tier1.xid_events} {gpuByBdf} />

    <footer class="tier-footer">
      <span class="tier-line">Tier 1 (nvidia-smi): available</span>
      <span class="tier-sep">·</span>
      <span class="tier-line">{tier2Status}</span>
      <span class="tier-sep">·</span>
      <span class="tier-line">{tier3Status}</span>
    </footer>
  </div>
{/if}

<style>
  .gpu-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .gpu-panel-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .gpu-count {
    color: var(--text-tertiary);
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid var(--surface-border);
  }

  .tier-pill,
  .driver-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid var(--surface-border);
    cursor: help;
  }
  .tier-pill {
    background: rgba(96, 165, 250, 0.12);
    color: #60a5fa;
    border-color: rgba(96, 165, 250, 0.3);
  }
  .driver-pill {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-tertiary);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }

  .gpu-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .grid-multi {
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  }

  .tier-footer {
    font-size: 12px;
    color: var(--text-tertiary);
    padding-top: 8px;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tier-sep { color: rgba(255, 255, 255, 0.15); }
</style>
