<script lang="ts">
  interface Props {
    hostname: string;
    distro: string;
    ip: string;
    lastSeen: string;
    /** "green" | "amber" | "red": drives the status dot color */
    status?: "green" | "amber" | "red";
    /** Optional alert badge: { count, kind: "alerts" | "acked" } */
    badge?: { count: number; kind: "alerts" | "acked" } | null;
  }

  let { hostname, distro, ip, lastSeen, status = "green", badge = null }: Props = $props();
</script>

<div class="card">
  <div class="row">
    <span class="dot dot-{status}"></span>
    <span class="hostname">{hostname}</span>
    {#if badge}
      <span class="badge badge-{badge.kind}">
        {badge.count} {badge.kind === "alerts" ? "ALERT" + (badge.count !== 1 ? "S" : "") : "ACKED"}
      </span>
    {/if}
  </div>
  <div class="meta">{distro} <span class="sep">/</span> {ip}</div>
  <div class="seen">Last seen {lastSeen}</div>
</div>

<style>
  .card {
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-green { background: #34d399; }
  .dot-amber { background: #fbbf24; }
  .dot-red { background: #f87171; }

  .hostname {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }
  .badge-alerts {
    background: rgba(251, 146, 60, 0.12);
    color: #fb923c;
    border: 1px solid rgba(251, 146, 60, 0.3);
  }
  .badge-acked {
    background: rgba(52, 211, 153, 0.1);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.25);
  }

  .meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
  }
  .sep { color: var(--text-tertiary, #707070); margin: 0 4px; }

  .seen {
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
</style>
