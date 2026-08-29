<script lang="ts">
  import { page } from "$app/stores";

  let status = $derived($page.status);
  let message = $derived($page.error?.message);
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
  <a href="/" class="btn btn-primary">Back to homepage</a>
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
    position: relative;
    z-index: 1;
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
</style>
