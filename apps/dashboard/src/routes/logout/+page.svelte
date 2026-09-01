<script lang="ts">
  import { onMount } from "svelte";
  // round-2 #4: the marketing site (a different origin) cannot POST to the
  // logout API directly - the CSRF guard requires a same-origin request, and a
  // cross-site GET deliberately does not revoke. So its "Log out" link makes a
  // top-level navigation HERE, and this page auto-submits a SAME-ORIGIN POST that
  // does revoke (browser_session_epoch) before redirecting to /login. No-JS users
  // get the button.
  let form: HTMLFormElement | undefined;
  onMount(() => form?.requestSubmit());
</script>

<svelte:head><title>Logging out - Glassmkr</title></svelte:head>

<main class="logout-wrap">
  <form bind:this={form} method="POST" action="/api/v1/auth/logout" class="logout-card">
    <p>Signing you out...</p>
    <button type="submit" class="btn btn-primary">Log out</button>
  </form>
</main>

<style>
  .logout-wrap { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .logout-card { text-align: center; display: flex; flex-direction: column; gap: 1rem; align-items: center; }
  .logout-card p { color: var(--text-secondary); }
</style>
