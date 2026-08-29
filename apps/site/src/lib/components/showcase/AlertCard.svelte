<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    severity: "P1" | "P2" | "P3" | "P4";
    severityLabel?: string;        // e.g. "P1 URGENT"
    title: string;
    description: string;            // first prose block under the title
    sustained?: string | null;      // muted line below description
    /** Italic amber action prompt. Snippet so we can embed inline code. */
    action?: Snippet;
    evidenceLink?: string;          // e.g. "Storage overview"
    fixCommands?: string[] | null;  // shown in monospace code block
    fired?: string | null;          // e.g. "Fired: 2026-05-05 08:02:31 UTC"
  }

  let {
    severity,
    severityLabel,
    title,
    description,
    sustained = null,
    action,
    evidenceLink,
    fixCommands = null,
    fired = null,
  }: Props = $props();

  let label = $derived(severityLabel ?? (severity === "P1" ? "P1 URGENT"
    : severity === "P2" ? "P2 HIGH"
    : severity === "P3" ? "P3 MEDIUM"
    : "P4 LOW"));
</script>

<div class={`alert-card sev-${severity.toLowerCase()}`}>
  <span class={`badge badge-${severity.toLowerCase()}`}>{label}</span>
  <h3 class="title">{title}</h3>
  <p class="description">{description}</p>
  {#if sustained}
    <p class="sustained">{sustained}</p>
  {/if}
  {#if action}
    <p class="action">{@render action()}</p>
  {/if}
  {#if evidenceLink}
    <p class="evidence">&rarr; {evidenceLink}</p>
  {/if}
  {#if fixCommands && fixCommands.length > 0}
    <div class="fix">
      <span class="fix-label">FIX</span>
      <pre><code>{fixCommands.join("\n")}</code></pre>
    </div>
  {/if}
  <div class="footer-row">
    <span class="fired">{fired ?? ""}</span>
    <div class="actions">
      <span class="action-btn">Acknowledge</span>
      <span class="action-link">Mute rule</span>
    </div>
  </div>
</div>

<style>
  .alert-card {
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-left-width: 3px;
    border-radius: var(--radius-md);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .alert-card.sev-p1 { border-left-color: #f87171; }
  .alert-card.sev-p2 { border-left-color: #fbbf24; }
  .alert-card.sev-p3 { border-left-color: #fb923c; }
  .alert-card.sev-p4 { border-left-color: #60a5fa; }

  .badge {
    align-self: flex-start;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border-radius: var(--radius-md);
  }
  .badge-p1 { background: rgba(248, 113, 113, 0.14); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.35); }
  .badge-p2 { background: rgba(251, 191, 36, 0.14); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.35); }
  .badge-p3 { background: rgba(251, 146, 60, 0.14); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.35); }
  .badge-p4 { background: rgba(96, 165, 250, 0.14); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.35); }

  .title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary, #f0f0f0);
    margin: 0;
    line-height: 1.3;
  }
  .description {
    font-size: 13.5px;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
    line-height: 1.55;
  }
  .description :global(code), .action :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary, #f0f0f0);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
  }
  .sustained {
    font-size: 12px;
    color: var(--text-tertiary, #707070);
    margin: 0;
    font-family: var(--font-mono, monospace);
  }
  .action {
    font-size: 13px;
    color: var(--accent);
    font-style: italic;
    margin: 0;
    line-height: 1.5;
  }
  .evidence {
    font-size: 12.5px;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
  }

  .fix {
    margin-top: 4px;
    background: #0d0d0d;
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    padding: 10px 12px;
    overflow: hidden;
  }
  .fix-label {
    display: inline-block;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin-bottom: 8px;
  }
  .fix pre {
    margin: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .fix pre::-webkit-scrollbar { display: none; }
  .fix code {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
    line-height: 1.7;
    white-space: pre;
  }

  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 6px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .fired {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
  .actions { display: flex; gap: 14px; align-items: center; }
  .action-btn {
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    padding: 4px 10px;
  }
  .action-link {
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
</style>
