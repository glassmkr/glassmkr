<script lang="ts">
  interface Props {
    device: string;
    model: string;
    healthy?: boolean;
    temperature?: string;
    uptime?: string;
  }

  let { device, model, healthy = true, temperature, uptime }: Props = $props();
</script>

<div class="row">
  <span class="device">{device}</span>
  <span class="model">{model}</span>
  <span class={healthy ? "badge healthy" : "badge unhealthy"}>
    {healthy ? "HEALTHY" : "UNHEALTHY"}
  </span>
  {#if temperature}<span class="meta">{temperature}</span>{/if}
  {#if uptime}<span class="meta">{uptime}</span>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    flex-wrap: wrap;
  }
  .device {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-primary, #f0f0f0);
  }
  .model {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
    flex: 1;
    min-width: 200px;
  }
  .badge {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    border-radius: var(--radius-md);
  }
  .badge.healthy {
    background: rgba(52, 211, 153, 0.1);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.25);
  }
  .badge.unhealthy {
    background: rgba(248, 113, 113, 0.14);
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.35);
  }
  .meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
</style>
