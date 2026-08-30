<script lang="ts">
  // Renders the Dashboard-app-local toast store ($lib/stores/toast.svelte.ts).
  //
  // Pre-existing bug discovered 2026-05-09: the layout previously mounted
  // `<Toast />` from `@glassmkr/ui`, which has its own internal `toasts`
  // array reachable only via a `bind:this` ref. App code calls
  // `toast.show(...)` from the local store — a different module, a
  // different array. The two never met, so every toast.show() across
  // every page rendered to nothing. This component bridges that gap by
  // reading the local store directly.
  //
  // Visual styling matches the @glassmkr/ui Toast for continuity.

  import { getToasts } from "$lib/stores/toast.svelte";
  const toasts = getToasts();
</script>

{#if toasts.items.length > 0}
  <div class="toast-container">
    {#each toasts.items as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        {toast.message}
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 40px));
  }
  .toast {
    padding: 12px 20px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    color: var(--text-primary);
    animation: slideIn 0.2s ease-out;
    line-height: 1.45;
  }
  .toast-success { border-color: var(--green); color: var(--green); }
  .toast-error   { border-color: var(--red);   color: var(--red); }
  .toast-info    { border-color: var(--g-info); color: var(--g-info); }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
