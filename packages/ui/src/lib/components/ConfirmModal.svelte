<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    onconfirm: () => void | Promise<void>;
    oncancel: () => void;
  }

  let {
    open = $bindable(false),
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    danger = false,
    onconfirm,
    oncancel,
  }: Props = $props();

  // While the confirm action is in flight, lock the modal and show a spinner on
  // the confirm button (aria-busy, styled globally in base.css). This kills the
  // double-click problem on slow destructive actions like deleting a server,
  // where the request takes a couple of seconds and the static button gave no
  // sign anything was happening. Awaiting onconfirm covers async handlers; sync
  // ones simply resolve immediately.
  let busy = $state(false);
  async function handleConfirm() {
    if (busy) return;
    busy = true;
    try {
      await onconfirm();
    } finally {
      busy = false;
    }
  }
  function handleCancel() {
    if (busy) return; // can't dismiss mid-action
    oncancel();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" role="presentation" onclick={handleCancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h3>{title}</h3>
      <p>{message}</p>
      <div class="actions">
        <button class="btn" onclick={handleCancel} disabled={busy}>{cancelText}</button>
        <button
          class="btn {danger ? 'btn-danger' : 'btn-primary'}"
          onclick={handleConfirm}
          aria-busy={busy}
        >
          {confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .modal {
    background: var(--bg);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 24px;
    max-width: 420px;
    width: 90%;
  }
  h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
