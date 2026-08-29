<script lang="ts">
  // Floating "?" button (bottom-right, low-disturbance) that opens
  // a small bug-report modal. The modal can also be opened
  // programmatically by other components via openBugReport() in
  // bug-report-store.ts (notably +error.svelte's "report this
  // error" link, which passes the error ID so it gets pre-attached).
  //
  // Submit posts to /api/v1/bug-reports. The server forwards the
  // report to GlitchTip (Sentry-compatible) using
  // Sentry.captureFeedback() so the report shows up alongside the
  // original captured error (when an errorId is attached) and
  // alerts route through the same GlitchTip notification rules
  // that fire on raw error captures.
  //
  // Privacy: we send title, description, optional email, the
  // current URL, the user-agent, and the error ID. No form values
  // from elsewhere in the app, no DOM scrape, no cookies.

  import { page } from "$app/stores";
  import { bugReportRequest, closeBugReport, openBugReport } from "./bug-report-store";

  // `inline` renders the trigger as an ordinary navigation item instead of a
  // fixed circle floating over the page. The floating form covered content on
  // every long page, so the app mounts this inline in the sidebar; the prop
  // stays because a floating trigger is still the right shape somewhere with
  // no chrome to dock into.
  let {
    customerEmail = "",
    inline = false,
    onopen,
  }: { customerEmail?: string; inline?: boolean; onopen?: () => void } = $props();

  let title = $state("");
  let description = $state("");
  // Email starts empty and is populated from the `customerEmail`
  // prop inside the open-effect below. Initializing from the prop
  // directly captures the prop's initial value, which trips Svelte
  // 5's state_referenced_locally check; the effect keeps it in
  // sync with the current customer at the moment the modal opens.
  let email = $state("");
  let submitting = $state(false);
  let submitted = $state(false);
  let submitError = $state<string | null>(null);
  let attachedErrorId = $state<string | undefined>(undefined);

  // React to programmatic open requests (from +error.svelte's
  // "report this error" link). Reset form state on each open so
  // the user doesn't see stale text from a prior submission.
  $effect(() => {
    const req = $bugReportRequest;
    if (req.open) {
      title = req.prefillTitle ?? "";
      description = "";
      email = customerEmail;
      submitted = false;
      submitError = null;
      attachedErrorId = req.errorId;
    }
  });

  let open = $derived($bugReportRequest.open);

  function onTriggerClick() {
    openBugReport();
    // Lets the host close the drawer the trigger was clicked inside, so the
    // modal is not opened behind an open sidebar.
    onopen?.();
  }

  function onClose() {
    closeBugReport();
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    submitting = true;
    submitError = null;
    try {
      const res = await fetch("/api/v1/bug-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          email: email.trim() || null,
          errorId: attachedErrorId ?? null,
          url: typeof window !== "undefined" ? window.location.href : null,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        submitError = body?.message || `Submission failed (${res.status})`;
      } else {
        submitted = true;
        // Auto-close after a short pause so the user reads the
        // "thanks" state instead of having the modal disappear
        // out from under them.
        setTimeout(() => closeBugReport(), 1800);
      }
    } catch (err) {
      submitError = (err as Error)?.message || "Network error";
    } finally {
      submitting = false;
    }
  }
</script>

<!-- Trigger. Inline is the shape the app uses: it sits in the sidebar's
     secondary group and reads as one more quiet nav item. The floating form
     is kept for hosts with no navigation chrome to dock into. -->
{#if inline}
  <button type="button" class="inline-trigger" onclick={onTriggerClick}>Report a problem</button>
{:else}
  <button
    type="button"
    class="floating-trigger"
    title="Report a bug"
    aria-label="Report a bug"
    onclick={onTriggerClick}
  >?</button>
{/if}

{#if open}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bug-report-title"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
    tabindex="-1"
  >
    <div class="modal">
      <header>
        <h2 id="bug-report-title">Report a bug</h2>
        <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>&times;</button>
      </header>

      {#if submitted}
        <div class="thanks">
          <p>Thanks. We received your report and the team will take a look.</p>
        </div>
      {:else}
        <form onsubmit={onSubmit}>
          {#if attachedErrorId}
            <div class="attached-error">
              <span class="attached-label">Attached error</span>
              <code>{attachedErrorId}</code>
            </div>
          {/if}

          <label>
            <span>What were you trying to do?</span>
            <input
              type="text"
              bind:value={title}
              placeholder="e.g. Add a new server"
              required
              maxlength="200"
              disabled={submitting}
            />
          </label>

          <label>
            <span>What happened?</span>
            <textarea
              bind:value={description}
              placeholder="Steps to reproduce, what you expected, what you saw."
              required
              maxlength="4000"
              rows="5"
              disabled={submitting}
            ></textarea>
          </label>

          <label>
            <span>Email (optional, so we can follow up)</span>
            <input
              type="email"
              bind:value={email}
              placeholder="you@example.com"
              disabled={submitting}
            />
          </label>

          {#if submitError}
            <p class="error">{submitError}</p>
          {/if}

          <div class="actions">
            <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" class="btn-primary" disabled={submitting || !title.trim() || !description.trim()}>
              {submitting ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .floating-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 90;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-elevated);
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);
    font-size: 16px;
    font-weight: 600;
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
  }
  .floating-trigger:hover {
    opacity: 1;
    background: var(--bg-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Deliberately inherits the sidebar link geometry rather than looking like a
     button: it is the least important thing in that group and should not
     out-shout Settings or Docs. */
  .inline-trigger {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    padding: 7px 20px;
    font: inherit;
    font-size: 13px;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .inline-trigger:hover {
    color: var(--text-primary);
  }
  .inline-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 20px;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--surface, #14131a);
    border: 1px solid var(--surface-border, #2a2730);
    border-radius: 4px;
    width: 100%;
    max-width: 480px;
    padding: 20px 22px 22px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 16px;
    margin: 0;
    color: var(--text-primary);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close-btn:hover {
    color: var(--text-primary);
  }
  .attached-error {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(245, 166, 35, 0.06);
    border: 1px solid rgba(245, 166, 35, 0.2);
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 14px;
    font-size: 12px;
  }
  .attached-label {
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
  }
  .attached-error code {
    color: var(--accent);
    font-family: var(--font-mono, monospace);
    background: transparent;
    padding: 0;
  }
  label {
    display: block;
    margin-bottom: 12px;
  }
  label span {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 5px;
  }
  input, textarea {
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--surface-border, #2a2730);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
  }
  input:focus, textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  textarea {
    resize: vertical;
    min-height: 90px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
  .btn-primary, .btn-secondary {
    padding: 7px 14px;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--accent);
    color: #0B0C0E;
    border-color: var(--accent);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: transparent;
    color: var(--text-secondary);
    border-color: var(--surface-border);
  }
  .btn-secondary:hover {
    color: var(--text-primary);
  }
  .error {
    font-size: 12px;
    color: #ff6b6b;
    margin: 6px 0 0;
  }
  .thanks p {
    color: var(--text-primary);
    font-size: 14px;
    padding: 12px 0;
    margin: 0;
  }
</style>
