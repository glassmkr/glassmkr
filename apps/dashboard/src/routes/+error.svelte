<script lang="ts">
  import { page } from "$app/stores";
  import { openBugReport } from "$lib/components/bug-report-store";

  let status = $derived($page.status);
  let message = $derived($page.error?.message);
  // errorId is added by handleError in hooks.{client,server}.ts.
  // Format: `err_` + last 8 chars of the Sentry/GlitchTip event
  // UUID. Operators search the full UUID in GlitchTip; users
  // reference the short form in a bug report.
  let errorId = $derived(($page.error as { errorId?: string })?.errorId);

  function reportThisError() {
    openBugReport({ errorId, prefillTitle: message });
  }
</script>

<div class="error-page">
  <span class="error-code">{status}</span>
  <h1>
    {#if status === 404}
      Page not found
    {:else}
      Something went wrong
    {/if}
  </h1>
  <p>
    {#if status === 404}
      The page you are looking for does not exist or has been moved.
    {:else if message}
      {message}
    {:else}
      An unexpected error occurred. Try refreshing the page.
    {/if}
  </p>

  {#if errorId && status !== 404}
    <div class="error-id-block">
      <span class="error-id-label">Reference</span>
      <code class="error-id">{errorId}</code>
      <button
        type="button"
        class="copy-btn"
        title="Copy error ID"
        onclick={() => navigator.clipboard?.writeText(errorId!)}
      >Copy</button>
    </div>
    <p class="error-id-help">
      Mention this code if you contact support or
      <button type="button" class="link-btn" onclick={reportThisError}>report this error</button>.
    </p>
  {/if}

  <a href="/" class="btn btn-primary">Back to dashboard</a>
</div>

<style>
  .error-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    padding: 24px;
  }
  .error-code {
    font-size: 64px;
    font-weight: 700;
    color: var(--text-tertiary);
    line-height: 1;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 24px;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  p {
    color: var(--text-secondary);
    font-size: 15px;
    max-width: 400px;
    margin-bottom: 24px;
    line-height: 1.6;
  }
  .error-id-block {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 8px;
  }
  .error-id-label {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .error-id {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--accent);
    background: transparent;
    padding: 0;
  }
  .copy-btn {
    background: transparent;
    border: 1px solid var(--surface-border);
    color: var(--text-tertiary);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .copy-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }
  .error-id-help {
    font-size: 13px;
    margin-bottom: 24px;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link-btn:hover {
    color: var(--text-primary);
  }
</style>
