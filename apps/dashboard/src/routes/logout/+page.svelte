<script lang="ts">
  // Deliberately NO auto-submit (round-3 #2). This page is reachable by a
  // top-level navigation, including one an external site can trigger. If it
  // auto-POSTed, a cross-site link to /logout would silently revoke every
  // session - the exact forced-logout CSRF that POST-only + Origin protection on
  // the logout endpoint exists to prevent. The user confirms with a real click,
  // which is same-origin and does revoke.
</script>

<svelte:head><title>Log out - Glassmkr</title></svelte:head>

<main class="logout-wrap">
  <form method="POST" action="/api/v1/auth/logout" class="logout-card">
    <h1>Log out of Glassmkr?</h1>
    <p>This signs you out on this browser.</p>
    <button type="submit" class="btn btn-primary">Log out</button>
    <a href="/" class="cancel-link">Stay signed in</a>
  </form>
</main>

<style>
  .logout-wrap { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .logout-card { text-align: center; display: flex; flex-direction: column; gap: 1rem; align-items: center; }
  .logout-card h1 { font-size: 1.4rem; margin: 0; }
  .logout-card p { color: var(--text-secondary); margin: 0; }
  .cancel-link { font-size: 0.9rem; color: var(--text-secondary); }
</style>
