<script lang="ts">
  // "Generate ticket draft" modal. Opened from a vendor-facing hardware alert.
  // POSTs to the ticket-draft route, shows the editable plain-text draft, and
  // lets the operator copy it. Glassmkr never sends anything: the reassurance
  // and the AI-draft framing live here in the UI, never in the copied text.
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/utils/api";

  interface Props {
    serverId: string;
    alertId: number;
    alertType: string;
    onClose: () => void;
  }
  let { serverId, alertId, onClose }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  // Single editable field: subject + blank line + body, so Copy yields a clean
  // ticket the operator pastes and sends as-is.
  let text = $state("");
  let copied = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api<{ draft: { subject: string; body: string } }>(
        `/api/v1/servers/${serverId}/alerts/${alertId}/ticket-draft`,
        { method: "POST" },
      );
      text = `${res.draft.subject}\n\n${res.draft.body}`;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Could not generate a draft. Please try again.";
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" role="presentation" onclick={onClose}>
  <div
    class="modal"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Ticket draft for your provider"
    onclick={(e) => e.stopPropagation()}
  >
    <header class="head">
      <h3>Ticket draft for your provider</h3>
      <button class="close" aria-label="Close" onclick={onClose}>&times;</button>
    </header>
    <div class="body">
      <p class="intro">
        This draft was built from this alert's data. Review and edit it, copy it, then send it
        through your provider's own ticket portal or email.
      </p>

      {#if loading}
        <p class="state">Generating draft...</p>
      {:else if error}
        <p class="state error">{error}</p>
      {:else}
        <textarea bind:value={text} rows="18" spellcheck="false" aria-label="Ticket draft text"></textarea>
        <div class="actions">
          <button class="btn btn-small btn-primary" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
          <span class="reassure">This is a draft. Glassmkr does not contact your provider. Copy and send it yourself.</span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .modal {
    background: var(--bg); border: 1px solid var(--surface-border); border-radius: 4px;
    width: 100%; max-width: 720px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-bottom: 1px solid var(--surface-border); }
  .head h3 { font-size: 16px; font-weight: 600; margin: 0; }
  .close { margin-left: auto; background: none; border: none; color: var(--text-tertiary); font-size: 24px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .close:hover { color: var(--text-primary); }
  .body { padding: 18px 20px 22px; }
  .intro { font-size: 13px; color: var(--text-secondary); line-height: 1.55; margin: 0 0 14px; }
  .state { color: var(--text-tertiary); font-size: 13px; padding: 24px 0; text-align: center; }
  .state.error { color: var(--danger, #e0a868); }
  textarea {
    width: 100%; box-sizing: border-box; min-height: 320px; resize: vertical;
    background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px;
    color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: 12.5px;
    line-height: 1.55; padding: 12px;
  }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  .reassure { font-size: 12px; color: var(--text-tertiary); }
</style>
