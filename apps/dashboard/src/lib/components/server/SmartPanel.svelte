<script lang="ts">
  // SMART panel: one card per drive. Health pill + temp + power-on time +
  // reallocated-sector flag, plus an optional disk-health rollup badge.

  interface Drive {
    device?: string;
    name?: string;
    model?: string;
    health?: string;
    healthy?: boolean;
    temperature_c?: number;
    temperature?: number;
    power_on_hours?: number;
    reallocated_sectors?: number;
  }
  interface RollupEntry { state: string; signals: string[]; }
  interface Props {
    smart?: Drive[];
    diskHealth?: Record<string, RollupEntry>;
  }
  let { smart = [], diskHealth = {} }: Props = $props();

  function isHealthy(d: Drive): boolean {
    return d.health === "PASSED" || d.healthy !== false && d.health !== "FAILED";
  }
  function rollupBadge(state: string | undefined): string | null {
    if (state === "broken") return "tag-red";
    if (state === "failing") return "tag-yellow";
    if (state === "declining") return "tag-yellow";
    return null;
  }
</script>

<div class="smart-grid">
  {#each smart as d}
    {@const dev = d.device ?? d.name ?? "unknown"}
    {@const healthy = isHealthy(d)}
    {@const temp = d.temperature_c ?? d.temperature}
    {@const rollup = diskHealth[dev]}
    {@const badge = rollup ? rollupBadge(rollup.state) : null}
    <div class="card smart-card">
      <div class="smart-top">
        <span class="smart-dev">{dev}</span>
        <span class="tag {healthy ? 'tag-green' : 'tag-red'}">{healthy ? "PASSED" : "FAILED"}</span>
      </div>
      {#if d.model}<div class="smart-model">{d.model}</div>{/if}
      <div class="smart-meta">
        {#if temp != null}<span>{temp}&deg;C</span>{/if}
        {#if d.power_on_hours}<span>{Math.round(d.power_on_hours / 24)}d powered on</span>{/if}
        {#if (d.reallocated_sectors ?? 0) > 0}
          <span class="tag tag-red">{d.reallocated_sectors} reallocated</span>
        {:else}
          <span>0 reallocated</span>
        {/if}
        {#if rollup && badge}
          <span class="tag {badge}" title={`Signals: ${rollup.signals.join(", ") || "none"}`}>
            {rollup.state.charAt(0).toUpperCase() + rollup.state.slice(1)}
          </span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .smart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; }
  .smart-card { padding: 14px 16px; }
  .smart-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .smart-dev { font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .smart-model { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
  .smart-meta { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; color: var(--text-tertiary); align-items: center; flex-wrap: wrap; }
  .tag { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 4px; }
  .tag-green { background: var(--green-bg); color: var(--green); }
  .tag-yellow { background: var(--yellow-bg); color: var(--yellow); }
  .tag-red { background: var(--red-bg); color: var(--red); }
</style>
