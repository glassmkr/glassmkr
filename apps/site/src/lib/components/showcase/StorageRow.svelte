<script lang="ts">
  interface Props {
    mount: string;
    used: string;       // e.g. "133.3 GB"
    total: string;      // e.g. "438.7 GB"
    percent: number;    // 0-100; drives bar color + fill width
  }

  let { mount, used, total, percent }: Props = $props();

  // Bar color: green up to 70, amber 70-89, red >=90. Derived so the
  // tier recomputes if percent changes (it shouldn't here since these
  // are static showcase values, but the explicit derived also silences
  // svelte-check's "captures initial value" warning).
  let tier = $derived(percent >= 90 ? "red" : percent >= 70 ? "amber" : "green");
</script>

<div class="row">
  <div class="header">
    <span class="mount">{mount}</span>
    <span class="numbers">{used} / {total} <span class="percent">({percent.toFixed(1)}%)</span></span>
  </div>
  <div class="bar">
    <div class={`fill fill-${tier}`} style:width={`${Math.max(percent, 1)}%`}></div>
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .mount { color: var(--text-primary, #f0f0f0); }
  .numbers { color: var(--text-secondary, #a0a0a0); }
  .percent { color: var(--text-tertiary, #707070); }

  .bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: none;
  }
  .fill-green { background: #34d399; }
  .fill-amber { background: #fbbf24; }
  .fill-red   { background: #f87171; }
</style>
