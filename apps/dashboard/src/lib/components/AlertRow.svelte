<script lang="ts">
  import { api } from "$lib/utils/api";
  import { page } from "$app/stores";
  import { getToasts } from "$lib/stores/toast.svelte";
  import {
    getPriority,
    ALERT_PRIORITIES,
    PRIORITY_LABELS,
    PRIORITY_COLORS,
    EVIDENCE_MAP,
    formatDuration,
    formatTimestamp,
  } from "$lib/alerts/presentation";
  import { alertIsVendorFacing } from "$lib/alerts/vendor-facing";
  import TicketDraftModal from "./TicketDraftModal.svelte";

  interface Props {
    alert: {
      id: number;
      server_id: string;
      alert_type: string;
      severity: string;
      title: string;
      message: string;
      recommendation: string;
      first_seen: string;
      last_seen: string;
      acknowledged: boolean;
      acknowledged_at?: string;
      resolved_at?: string;
      // Persisted on manual resolve and on auto-decay closure
      // (`auto_decay_*` prefixes). The dashboard distinguishes
      // operator-closed forensic alerts from auto-closures by the
      // `manual-after-investigation;` prefix convention.
      resolution_reason?: string | null;
      evidence?: string | Record<string, unknown> | null;
      // Populated by GET /api/v1/servers/:id/alerts since 2026-05-17
      // (file 02-B-minimal wiring). When present, the deepened YAML-library
      // variant takes precedence over evidence.fix_commands for FIX rendering.
      // Absence = rule not in YAML library, or server hasn't ingested
      // os_id yet → falls back to evidence.fix_commands path.
      fix_workflow?: {
        quick_check: { command: string; description: string };
        // Verdict prior: at-a-glance shape badge. Optional per rule;
        // absent = no badge. Per the Furnace static-priors spec
        // (2026-05-20) shipped 2026-05-21.
        verdict_prior?: "recoverable" | "investigation" | "vendor-side";
        command: string;
        description: string;
        prerequisites: string[];
        safe_mode: { command: string; description: string } | null;
        validation: { command: string; expected_exit?: number; description: string } | null;
        rollback: { available: boolean; command: string | null; note: string };
        impact: { blast_radius: string; estimated_duration: string; irreversible_steps: boolean };
        variant_match: { distro_matched: string; vendor_matched: string; condition_matched: boolean };
        // Forensic / post-incident marker. True only for rules whose
        // YAML metadata sets `manual_resolve: true` (the host looks
        // healthy on the next snapshot, no auto-clear path). Gates the
        // "Mark resolved (manual)" button + the matching endpoint.
        manual_resolve?: boolean;
      };
    };
    serverId?: string;
    onack?: () => void;
    onmute?: () => void;
  }

  let { alert, serverId, onack, onmute }: Props = $props();

  // Ticket-draft (hardware-alert provider message). The button shows only on
  // vendor-facing hardware faults, detected by the ownership note in the
  // recommendation (single source of truth in $lib/alerts/vendor-facing).
  let showTicketDraft = $state(false);
  let vendorFacing = $derived(alertIsVendorFacing(alert.recommendation));

  // Read-only demo: hide the ack/mute/resolve actions (the server 403s them
  // anyway). Keeps the demo from offering buttons that just error.
  let isDemo = $derived($page.data.customer?.isDemo === true);
  let acking = $state(false);
  let muting = $state(false);
  let resolving = $state(false);
  // Two-tier remediation UX (2026-05-20): quick_check is the default
  // expanded view; the full FIX content (per-distro variants,
  // prerequisites, safe_mode, validation, rollback, impact) hides
  // behind a "Show full remediation" toggle so an SRE can ack and
  // verify in seconds without scrolling through the manual.
  let showFullFix = $state(false);
  const toast = getToasts();

  // Manual-resolve gate. Sourced from rule.manual_resolve (surfaced
  // via the fix_workflow resolver). True only for forensic rules with
  // no automatic resolution path; gates both the "Mark resolved
  // (manual)" button below and, server-side, the resolve endpoint.
  // Per CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md.
  let manualResolve = $derived(alert.fix_workflow?.manual_resolve === true);

  // True for alerts that were closed via the manual-resolve flow
  // (vs. auto-decay or auto-clear). Drives the green confirmation
  // banner + the "manual" badge on resolved entries. Discriminator
  // is the resolution_reason prefix convention from the
  // 2026-05-18 dogfood-loop memory entry.
  const MANUAL_REASON_PREFIX = "manual-after-investigation;";
  let resolvedManually = $derived(
    !!alert.resolved_at &&
    typeof alert.resolution_reason === "string" &&
    alert.resolution_reason.startsWith(MANUAL_REASON_PREFIX),
  );
  let manualResolutionNote = $derived.by(() => {
    if (!resolvedManually || !alert.resolution_reason) return "";
    return alert.resolution_reason.slice(MANUAL_REASON_PREFIX.length).trim();
  });

  // Modal state for the "Mark resolved (manual)" confirmation.
  let showResolveModal = $state(false);
  let resolveNote = $state("");
  let resolveNoteError = $state("");
  const RESOLVE_NOTE_MAX = 200;

  function openResolveModal() {
    resolveNote = "";
    resolveNoteError = "";
    showResolveModal = true;
  }
  function closeResolveModal() {
    showResolveModal = false;
  }

  // Card accent tracks the severity-modulated priority so a worse instance
  // colors redder. The BADGE, however, shows the rule's CATALOG priority (its
  // page-worthiness) so a P1 rule always reads "P1" and is never downgraded to
  // "P2" just because this instance is severity=warning (Grok red-team H9: a P1
  // no_firewall rendering as a yellow "P2 HIGH" trains users to ignore P1s).
  let priority = $derived(getPriority(alert.alert_type, alert.severity));
  let basePriority = $derived(ALERT_PRIORITIES[alert.alert_type] ?? 3);
  let priorityLabel = $derived(PRIORITY_LABELS[basePriority] || "P3 MEDIUM");
  let priorityColor = $derived(PRIORITY_COLORS[basePriority] || "yellow");
  let evidence = $derived(EVIDENCE_MAP[alert.alert_type] || []);
  let parsedEvidence = $derived.by(() => {
    if (!alert.evidence) return null;
    if (typeof alert.evidence === "string") { try { return JSON.parse(alert.evidence); } catch { return null; } }
    return alert.evidence;
  });

  // 3-tier FIX-content resolution.
  //
  // Codex 2026-05-22B F4 flipped the precedence: evaluator-baked
  // `evidence.fix_commands` wins over the static YAML `fix_workflow.command`.
  // Rationale: rules like smart_failing, nvme_wear_high, systemd_service_failed
  // and raid_degraded bake commands at ingest with the real /dev/<DEVICE> or
  // <UNIT> name pulled from the snapshot. The YAML template carries
  // `/dev/${DEVICE}` literal placeholders the operator has to substitute by
  // hand; if a baked-command exists for this alert we should show it.
  // Notification renderers (email/Slack) already followed evidence-first;
  // this aligns the in-app card with that.
  //
  //   1. evidence.fix_commands — baked at ingest by the evaluator with real
  //      device/unit/iface names. Highest signal, lowest operator load.
  //   2. alert.fix_workflow.command — deepened YAML, distro/vendor/condition-
  //      match selected variant. Source of truth for static guidance; used
  //      when the evaluator did NOT bake dynamic commands for this rule.
  //   (No further fallback: every rule carries a YAML fix_workflow, so an
  //    alert with neither baked evidence nor a resolved workflow renders no
  //    command block.)
  let commands = $derived.by(() => {
    const baked = parsedEvidence?.fix_commands as string[] | undefined;
    if (Array.isArray(baked) && baked.length > 0) return baked;
    if (alert.fix_workflow?.command) return alert.fix_workflow.command.split("\n");
    return [];
  });
  let commandsText = $derived(commands.join("\n"));
  let firingDuration = $derived(
    alert.first_seen ? formatDuration(Date.now() - new Date(alert.first_seen).getTime()) : ""
  );

  // Per-line command parser for the rendered code blocks.
  // Classifies each line so the renderer can:
  //   - show `# ====== Step N: ... ======` as a styled section divider
  //     (avoids the visual collision between the `=` decoration and the
  //      adjacent letters that was visible on long-running deepening
  //      content; issue raised 2026-05-21)
  //   - show plain `# ...` lines as dimmed annotations (no copy)
  //   - give every executable line its own hover-revealed copy button
  //     so operators paste one command at a time into their SSH session
  //     instead of the whole block (issue raised 2026-05-21: pasting the
  //     whole multi-branch block was noisy and operator-error-prone)
  type CmdLine =
    | { kind: "section"; text: string }
    | { kind: "comment"; text: string }
    | { kind: "blank" }
    | { kind: "command"; text: string };
  function parseCommandLines(cmd: string): CmdLine[] {
    return cmd.split("\n").map((raw): CmdLine => {
      const trimmed = raw.trim();
      if (!trimmed) return { kind: "blank" };
      // `# === Title ===` or `# ====== Title ======` (any number of =).
      const m = /^#\s*=+\s*(.+?)\s*=+\s*$/.exec(trimmed);
      if (m) return { kind: "section", text: m[1] };
      if (trimmed.startsWith("#")) return { kind: "comment", text: raw };
      return { kind: "command", text: raw };
    });
  }

  let copiedLine: string | null = $state(null);
  async function copyOneLine(line: string) {
    try {
      await navigator.clipboard.writeText(line);
      copiedLine = line;
      setTimeout(() => { if (copiedLine === line) copiedLine = null; }, 1500);
    } catch {
      toast.show("Copy failed; clipboard unavailable", "error");
    }
  }

  async function ack() {
    acking = true;
    try {
      await api(`/api/v1/alerts/${alert.id}/acknowledge`, { method: "POST" });
      toast.show("Alert acknowledged", "success");
      onack?.();
    } catch (err: any) {
      toast.show(err.message || "Failed to acknowledge", "error");
    } finally {
      acking = false;
    }
  }

  // Submit handler for the manual-resolve modal. The note is required
  // (a forensic resolution without a stated cause is the "click-
  // through-and-forget" UX the spec is trying to prevent). The
  // server-side endpoint applies the `manual-after-investigation; `
  // prefix; we send only the operator's note.
  async function resolve() {
    const note = resolveNote.trim();
    if (note.length === 0) {
      resolveNoteError = "Add a one-line cause before resolving.";
      return;
    }
    if (note.length > RESOLVE_NOTE_MAX) {
      resolveNoteError = `Note must be ${RESOLVE_NOTE_MAX} characters or fewer.`;
      return;
    }
    resolveNoteError = "";
    resolving = true;
    try {
      await api(`/api/v1/alerts/${alert.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_reason: note }),
      });
      toast.show("Alert resolved", "success");
      showResolveModal = false;
      onack?.(); // reload data
    } catch (err: any) {
      toast.show(err.message || "Failed to resolve", "error");
    } finally {
      resolving = false;
    }
  }

  async function mute() {
    if (!serverId) return;
    muting = true;
    try {
      await api(`/api/v1/servers/${serverId}/mutes`, {
        method: "POST",
        body: JSON.stringify({ alert_type: alert.alert_type }),
      });
      toast.show(`Rule "${alert.alert_type}" muted for this server`, "success");
      onmute?.();
    } catch (err: any) {
      toast.show(err.message || "Failed to mute rule", "error");
    } finally {
      muting = false;
    }
  }
</script>

{#snippet commandBlock(command: string)}
  <div class="cmd-block">
    {#each parseCommandLines(command) as line, i (i)}
      {#if line.kind === "section"}
        <div class="cmd-section" class:first={i === 0}>{line.text}</div>
      {:else if line.kind === "comment"}
        <div class="cmd-comment">{line.text}</div>
      {:else if line.kind === "blank"}
        <div class="cmd-blank"></div>
      {:else}
        <div class="cmd-row">
          <button
            class="cmd-copy"
            type="button"
            aria-label="Copy command"
            title={copiedLine === line.text ? "Copied" : "Copy this command"}
            onclick={() => copyOneLine(line.text)}
          >
            <span class="cmd-copy-glyph">{copiedLine === line.text ? "✓" : "⧉"}</span>
          </button>
          <code class="cmd-text">{line.text}</code>
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="alert-card priority-{priority}">
  <div class="alert-header">
    <span class="tag tag-{priorityColor}">{priorityLabel}</span>
    {#if alert.acknowledged}
      <span class="tag tag-green">Acknowledged</span>
    {/if}
  </div>

  <p class="alert-summary">{alert.title}</p>

  <p class="alert-impact">
    {alert.message}
    {#if firingDuration}
      <span class="alert-duration">Sustained {firingDuration}.</span>
    {/if}
    <span class="alert-threshold">({alert.alert_type})</span>
  </p>

  {#if parsedEvidence?.occurrences?.length > 1}
    <div class="occurrences">
      {#each parsedEvidence.occurrences as occ, i}
        <div class="occurrence">
          <span class="occ-num">#{i + 1}</span>
          <span>{formatTimestamp(occ.timestamp)}</span>
          {#if occ.previous_uptime_seconds != null}
            <span class="occ-detail">uptime was {formatDuration(occ.previous_uptime_seconds * 1000)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if alert.recommendation}
    <!-- A structured action region (spec 17.3): neutral readable text under a
         label, not brand-colored italic prose. The decision reads first; the
         command blocks below stay subordinate to it. -->
    <div class="alert-rec">
      <p class="alert-rec-label">RECOMMENDED ACTION</p>
      <p class="alert-rec-text">{alert.recommendation}</p>
    </div>
  {/if}

  {#if evidence.length > 0}
    <div class="alert-evidence">
      {#each evidence as link}
        <a href={link.anchor} class="alert-evidence-link">
          <span class="arrow">&rarr;</span> {link.label}
        </a>
      {/each}
    </div>
  {/if}

  {#if alert.fix_workflow?.quick_check}
    {@const qc = alert.fix_workflow.quick_check}
    {@const vp = alert.fix_workflow.verdict_prior}
    <div class="alert-fix">
      <div class="alert-fix-header">
        <span class="alert-fix-label">Quick check</span>
      </div>
      <p class="alert-fix-desc">{qc.description}</p>
      {@render commandBlock(qc.command)}
      {#if vp === "recoverable"}
        <span
          class="verdict-badge verdict-recoverable"
          title="Recoverable: typical fix is a config change or simple action; sub-minute remediation."
        >Recoverable in under a minute</span>
      {:else if vp === "investigation"}
        <span
          class="verdict-badge verdict-investigation"
          title="Investigation: customer-side, depends on workload context; may be benign or actionable."
        >Needs investigation</span>
      {:else if vp === "vendor-side"}
        <span
          class="verdict-badge verdict-vendor-side"
          title="Vendor-side: hardware fault or vendor escalation; no host-side fix."
        >Vendor-side / out of band</span>
      {/if}
      <button
        class="alert-fix-toggle"
        aria-expanded={showFullFix}
        onclick={() => (showFullFix = !showFullFix)}
      >
        <span class="caret">{showFullFix ? "▾" : "▸"}</span>
        {showFullFix ? "Hide full remediation" : "Show full remediation"}
      </button>
      {#if showFullFix}
        <div class="alert-fix-full">
          {#if alert.fix_workflow.prerequisites.length > 0}
            <div class="fix-section">
              <span class="fix-section-label">Prerequisites</span>
              <ul class="fix-prereqs">
                {#each alert.fix_workflow.prerequisites as p}
                  <li>{p}</li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if alert.fix_workflow.safe_mode}
            <div class="fix-section">
              <div class="fix-section-header">
                <span class="fix-section-label">Safe-mode diagnostic</span>
              </div>
              <p class="alert-fix-desc">{alert.fix_workflow.safe_mode.description}</p>
              {@render commandBlock(alert.fix_workflow.safe_mode.command)}
            </div>
          {/if}
          <div class="fix-section">
            <div class="fix-section-header">
              <span class="fix-section-label">Fix command</span>
            </div>
            {#if alert.fix_workflow.description}
              <p class="alert-fix-desc">{alert.fix_workflow.description}</p>
            {/if}
            {@render commandBlock(commandsText)}
          </div>
          {#if alert.fix_workflow.validation}
            <div class="fix-section">
              <div class="fix-section-header">
                <span class="fix-section-label">Validation</span>
              </div>
              <p class="alert-fix-desc">{alert.fix_workflow.validation.description}</p>
              {@render commandBlock(alert.fix_workflow.validation.command)}
            </div>
          {/if}
          {#if alert.fix_workflow.rollback}
            <div class="fix-section">
              <span class="fix-section-label">Rollback</span>
              <p class="alert-fix-desc">
                <strong>Reversible:</strong> {alert.fix_workflow.rollback.available ? "yes" : "no"}.
                {alert.fix_workflow.rollback.note}
              </p>
              {#if alert.fix_workflow.rollback.command}
                {@render commandBlock(alert.fix_workflow.rollback.command)}
              {/if}
            </div>
          {/if}
          {#if alert.fix_workflow.impact}
            <div class="fix-section">
              <span class="fix-section-label">Impact</span>
              <p class="alert-fix-desc">
                <strong>Blast radius:</strong> {alert.fix_workflow.impact.blast_radius}<br/>
                <strong>Duration:</strong> {alert.fix_workflow.impact.estimated_duration}<br/>
                <strong>Irreversible steps:</strong> {alert.fix_workflow.impact.irreversible_steps ? "yes" : "no"}
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if commands.length > 0}
    <!-- Legacy path: rule not in deepened YAML library (currently
         none — fallback retained so a future rule shipped without a
         YAML entry still gets its baked fix_commands rendered). -->
    <div class="alert-fix">
      <div class="alert-fix-header">
        <span class="alert-fix-label">Fix</span>
      </div>
      {@render commandBlock(commandsText)}
    </div>
  {/if}

  {#if resolvedManually}
    <!-- Green confirmation banner shown once the alert was closed via
         the manual-resolve flow. Timestamp + operator note; user
         attribution (resolved_by) is intentionally out of scope of
         this PR — adding it requires a column on active_alerts. -->
    <div class="manual-resolve-banner" role="status">
      <span class="manual-resolve-banner-label">Resolved manually</span>
      <span class="manual-resolve-banner-time">{formatTimestamp(alert.resolved_at!)}</span>
      {#if manualResolutionNote}
        <span class="manual-resolve-banner-note">: {manualResolutionNote}</span>
      {/if}
    </div>
  {/if}

  <div class="alert-timeline">
    <span>Fired: {formatTimestamp(alert.first_seen)}</span>
    {#if alert.acknowledged && alert.acknowledged_at}
      <span>Acknowledged: {formatTimestamp(alert.acknowledged_at)}</span>
    {/if}
    {#if alert.resolved_at}
      <span>
        Resolved: {formatTimestamp(alert.resolved_at)}
        {#if resolvedManually}
          <span class="manual-badge" title="Resolved manually by an operator">manual</span>
        {/if}
      </span>
    {/if}
    {#if !isDemo || (vendorFacing && serverId && !alert.resolved_at)}
    <div class="alert-actions">
      {#if !isDemo}
      {#if manualResolve && !alert.resolved_at}
        <!-- Forensic / post-incident rules (manual_resolve: true in
             YAML) get a secondary-styled button that opens a
             confirmation modal. The modal requires a one-line cause
             so the resolution is auditable; the server applies the
             `manual-after-investigation; ` prefix. Auto-resolvable
             rules (the other 57) get the Acknowledge button only;
             they close on the next snapshot when their underlying
             condition clears. Per CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md. -->
        <button
          class="btn btn-small"
          onclick={openResolveModal}
          disabled={resolving}
          title="Mark this post-incident alert resolved after investigation"
        >
          Mark resolved (manual)
        </button>
      {/if}
      {#if !alert.acknowledged}
        <!-- One consistent Acknowledge across every rule. (The old
             "ACK as vendor-side" special-case fired the identical POST but
             a different label on kernel_vulnerabilities alone, which read as
             an inexplicable exception; the vendor-side context already lives
             in the alert message + verdict badge.) -->
        <button class="btn btn-small" onclick={ack} disabled={acking}>
          {acking ? "..." : "Acknowledge"}
        </button>
      {/if}
      {#if serverId}
        <button class="btn btn-small btn-ghost" onclick={mute} disabled={muting} title="Stop this rule from firing on this server">
          {muting ? "..." : "Mute rule"}
        </button>
      {/if}
      {/if}
      {#if vendorFacing && serverId && !alert.resolved_at}
        <button class="btn btn-small" onclick={() => (showTicketDraft = true)} title="Draft a message to your hardware provider from this alert">
          Generate ticket draft
        </button>
      {/if}
    </div>
    {/if}
    {#if vendorFacing && serverId && !alert.resolved_at}
      <p class="ticket-draft-help">Drafts a message to your hardware provider from this alert. You review and send it yourself.</p>
    {/if}
  </div>
</div>

{#if showTicketDraft && serverId}
  <TicketDraftModal
    serverId={serverId}
    alertId={alert.id}
    alertType={alert.alert_type}
    onClose={() => (showTicketDraft = false)}
  />
{/if}

{#if showResolveModal}
  <!-- Manual-resolve confirmation modal. Required short-text note
       prevents the click-through-and-forget UX the spec is trying to
       avoid. The server adds the `manual-after-investigation; `
       prefix on persist; we send only the user's note. -->
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="resolve-modal-title-{alert.id}"
    onclick={(e) => { if (e.target === e.currentTarget && !resolving) closeResolveModal(); }}
    onkeydown={(e) => { if (e.key === "Escape" && !resolving) closeResolveModal(); }}
    tabindex="-1"
  >
    <div class="modal">
      <header>
        <h2 id="resolve-modal-title-{alert.id}">Mark this alert resolved?</h2>
        <button type="button" class="close-btn" aria-label="Close" onclick={closeResolveModal} disabled={resolving}>×</button>
      </header>
      <p class="modal-body-text">
        This alert describes an event that already happened: there is no automatic check that would close it. Resolve only after you have confirmed the underlying cause is understood (e.g. reviewed the journal for an unexpected reboot, restarted the failed service for systemd_service_failed, identified the OOM victim for oom_kills).
      </p>
      <form onsubmit={(e) => { e.preventDefault(); resolve(); }}>
        <label class="resolve-note-label">
          <span>What was the cause? (one line)</span>
          <input
            type="text"
            bind:value={resolveNote}
            placeholder="e.g. stress-ng run, OOM killer fired on test workload"
            maxlength={RESOLVE_NOTE_MAX}
            required
            disabled={resolving}
            autocomplete="off"
          />
        </label>
        {#if resolveNoteError}
          <p class="resolve-note-error" role="alert">{resolveNoteError}</p>
        {/if}
        <div class="modal-actions">
          <button type="button" class="btn btn-small btn-ghost" onclick={closeResolveModal} disabled={resolving}>
            Cancel
          </button>
          <button type="submit" class="btn btn-small btn-primary" disabled={resolving}>
            {resolving ? "..." : "Mark resolved"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .alert-card {
    background: var(--glass-gradient);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 20px;
    margin-bottom: 12px;
  }
  .alert-card.priority-0 { border-left: 3px solid var(--g-priority-p0); }
  .alert-card.priority-1 { border-left: 3px solid var(--g-priority-p1); }
  .alert-card.priority-2 { border-left: 3px solid var(--g-priority-p2); }
  .alert-card.priority-3 { border-left: 3px solid var(--g-priority-p3); }
  .alert-card.priority-4 { border-left: 3px solid var(--g-priority-p4); }

  .alert-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .alert-summary {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 6px 0;
    line-height: 1.4;
    /* Geist's proportional digit "1" can look like a capital "I" at
       this weight + size (spotted in titles like "1 systemd service
       failed"). Force tabular lining numerals so digits get distinct,
       fixed-width shapes that disambiguate from letters. */
    font-variant-numeric: tabular-nums lining-nums;
  }

  .alert-impact {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 8px 0;
    line-height: 1.5;
  }

  .alert-duration {
    color: var(--text-tertiary);
  }

  .alert-threshold {
    color: var(--text-tertiary);
    font-family: "SF Mono", "Fira Code", "Consolas", monospace;
    font-size: 12px;
  }

  .alert-rec {
    border-top: 1px solid var(--g-border-subtle);
    padding-top: 10px;
    margin: 0 0 12px 0;
  }
  .alert-rec-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin: 0 0 4px;
  }
  .alert-rec-text {
    font-size: 13.5px;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.55;
    max-width: 78ch;
  }

  .alert-evidence {
    margin: 8px 0 12px 0;
  }

  .alert-evidence-link {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    text-decoration: none;
    padding: 2px 0;
  }

  .alert-evidence-link:hover {
    color: var(--accent);
    text-decoration: none;
  }

  .alert-evidence-link .arrow {
    color: var(--accent);
    margin-right: 6px;
  }

  .alert-fix {
    margin: 12px 0;
  }

  .alert-fix-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .alert-fix-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* Two-tier per-command renderer (refactored 2026-05-21). Each line
     is classified by parseCommandLines() as section / comment / blank
     / command; the row form gives every command its own copy button
     (hover-revealed) so operators paste one command at a time. The
     section form replaces literal `# ====== Title ======` lines so
     the visual collision between `=` decoration and adjacent letters
     can't recur. */
  .cmd-block {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 6px 0;
    font-family: "SF Mono", "Fira Code", "Consolas", monospace;
    font-size: 13px;
    line-height: 1.55;
    overflow-x: auto;
  }
  .cmd-row {
    display: grid;
    grid-template-columns: 26px 1fr;
    align-items: start;
    padding: 1px 12px 1px 2px;
    /* Size to the CONTENT, then fill the block when the content is narrower.
       .cmd-block scrolls, so a long command is reachable, but the row was
       staying at the block's visible width (312px on a phone against 607px of
       text). Scroll right and the row's background and its hover highlight
       stopped partway, leaving the rest of the command sitting on the block
       background with no right padding. */
    width: max-content;
    min-width: 100%;
  }
  .cmd-row:hover { background: rgba(255, 255, 255, 0.035); }
  .cmd-row:hover .cmd-copy { opacity: 1; }
  .cmd-copy {
    opacity: 0.25;
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: opacity 80ms ease, color 80ms ease;
    align-self: start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 26x20 was under the 24px floor. The grid column is 26px wide, so the
       width comes from stretching into it rather than from padding, which
       would push the command text across. */
    height: 24px;
    width: 100%;
  }
  .cmd-copy:hover { color: var(--accent); opacity: 1; }
  .cmd-copy:focus-visible {
    opacity: 1;
    outline: 1px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .cmd-copy-glyph {
    font-size: 13px;
    line-height: 1;
  }
  .cmd-text {
    color: var(--text-primary);
    white-space: pre;
    font: inherit;
  }
  .cmd-comment {
    color: var(--text-tertiary);
    padding: 0 12px 0 28px;
    white-space: pre;
  }
  .cmd-blank { height: 6px; }
  .cmd-section {
    margin: 10px 12px 4px 12px;
    padding: 6px 0 4px;
    border-top: 1px dashed rgba(255, 255, 255, 0.08);
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .cmd-section.first {
    margin-top: 2px;
    padding-top: 2px;
    border-top: 0;
  }

  .alert-fix-desc {
    font-size: 12.5px;
    color: var(--text-secondary);
    margin: 0 0 6px;
    line-height: 1.5;
  }

  .alert-fix-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 4px 0;
    background: transparent;
    border: 0;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }
  .alert-fix-toggle:hover { color: var(--accent); }
  .alert-fix-toggle .caret {
    color: var(--text-tertiary);
    font-size: 12px;
    width: 10px;
  }

  /* Verdict prior badge: small pill that classifies the alert's
     remediation shape at-a-glance. Three values, three colour
     families. Hover tooltip explains each. Per Furnace static-priors
     spec (2026-05-20). */
  .verdict-badge {
    display: inline-block;
    margin-top: 8px;
    margin-right: 8px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    line-height: 16px;
    cursor: help;
    border: 1px solid transparent;
  }
  .verdict-recoverable {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.35);
    color: rgb(74, 222, 128);
  }
  .verdict-investigation {
    background: rgba(234, 179, 8, 0.12);
    border-color: rgba(234, 179, 8, 0.35);
    color: rgb(250, 204, 21);
  }
  .verdict-vendor-side {
    background: rgba(229, 86, 75, 0.12);
    border-color: rgba(229, 86, 75, 0.35);
    color: rgb(248, 113, 113);
  }

  .alert-fix-full {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .fix-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fix-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  .fix-section-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .fix-prereqs {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .fix-prereqs li { margin-bottom: 2px; }

  .alert-timeline {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--surface-border);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .alert-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .ticket-draft-help {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 6px 0 0;
    text-align: right;
  }

  .occurrences {
    margin: 8px 0 12px 0;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
  }
  .occurrence {
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 3px 0;
  }
  .occ-num {
    color: var(--text-tertiary);
    font-weight: 600;
    min-width: 20px;
  }
  .occ-detail {
    color: var(--text-tertiary);
  }

  /* Manual-resolve UI. Mirrors the BugReportButton modal pattern
     (overlay + .modal panel + .close-btn) so the visual language is
     consistent across dialog flows. Per
     CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md. */
  .manual-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    font-size: 12px;
    line-height: 14px;
    color: var(--text-secondary);
    background: var(--surface-elevated, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .manual-resolve-banner {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 6px 0 4px;
    padding: 6px 10px;
    border-radius: 4px;
    background: rgba(34, 197, 94, 0.08);
    border-left: 3px solid #22C55E;
    color: #86EFAC;
    font-size: 13px;
  }
  .manual-resolve-banner-label {
    font-weight: 600;
  }
  .manual-resolve-banner-time {
    color: var(--text-secondary);
  }
  .manual-resolve-banner-note {
    color: var(--text-primary);
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .modal {
    background: var(--surface, #121417);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    width: 100%;
    max-width: 480px;
    padding: 16px 18px 18px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }
  .modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .modal header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
    padding: 0 4px;
  }
  .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .modal-body-text {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .resolve-note-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .resolve-note-label span {
    color: var(--text-primary);
  }
  .resolve-note-label input {
    padding: 6px 8px;
    background: var(--surface-input, rgba(0, 0, 0, 0.3));
    border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    color: var(--text-primary);
    font: inherit;
  }
  .resolve-note-error {
    margin: 0 0 8px;
    color: #FCA5A5;
    font-size: 12px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  /* Modal becomes full-screen on narrow viewports per existing
     dashboard conventions. */
  @media (max-width: 540px) {
    .overlay { padding: 0; }
    .modal {
      max-width: none;
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
  }
</style>
