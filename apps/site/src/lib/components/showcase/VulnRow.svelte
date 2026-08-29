<script lang="ts">
  interface Props {
    name: string;
    status: string;
    /** mitigated | not_affected | vulnerable */
    state?: "mitigated" | "not_affected" | "vulnerable";
  }
  let { name, status, state = "mitigated" }: Props = $props();
</script>

<div class="row">
  <span class={`dot dot-${state === "vulnerable" ? "red" : "green"}`}></span>
  <span class="name">{name}</span>
  <span class="status">{status}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--surface-border, rgba(255, 255, 255, 0.04));
  }
  .row:last-child { border-bottom: none; }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-green { background: #34d399; }
  .dot-red { background: #f87171; }

  .name {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-primary, #f0f0f0);
    width: 180px;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
    line-height: 1.4;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 600px) {
    .name { width: 130px; }
  }
</style>
