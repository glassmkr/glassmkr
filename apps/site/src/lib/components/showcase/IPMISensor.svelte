<script lang="ts">
  interface Props {
    name: string;
    value: string;
    unit?: string;
  }
  let { name, value, unit }: Props = $props();
</script>

<div class="cell">
  <div class="name">{name}</div>
  <div class="value">
    {value}{#if unit}<span class="unit"> {unit}</span>{/if}
  </div>
</div>

<style>
  .cell {
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .name {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-tertiary, #707070);
    text-transform: uppercase;
  }
  .value {
    font-family: var(--font-mono, monospace);
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary, #f0f0f0);
  }
  .unit {
    font-size: 12px;
    color: var(--text-tertiary, #707070);
    font-weight: 400;
  }
</style>
