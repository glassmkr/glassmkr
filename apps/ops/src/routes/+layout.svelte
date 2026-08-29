<script>
  import "@glassmkr/ui/base.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>OPS - Glassmkr Admin</title>
</svelte:head>

<div class="ambient"></div>

<div id="app">
  <header>
    <span class="logo">OPS</span>
    <span class="subtitle">Glassmkr Admin</span>
  </header>

  {@render children()}

  <footer>&copy; 2026 Glassmkr. Internal use only.</footer>
</div>

<style>
  #app {
    position: relative;
    z-index: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 0 24px;
    min-height: 100vh;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 0;
    margin-bottom: 24px;
  }
  .subtitle {
    font-size: 13px;
    color: var(--text-tertiary);
  }
  footer {
    margin-top: 40px;
    padding: 20px 0;
    border-top: 1px solid var(--surface-border);
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
  }
</style>
