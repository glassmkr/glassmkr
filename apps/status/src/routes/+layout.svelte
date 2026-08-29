<script lang="ts">
  import "@glassmkr/ui/base.css";
  import type { Snippet } from "svelte";

  interface Props { children: Snippet }
  let { children }: Props = $props();
</script>

<div class="ambient"></div>

<header class="status-nav">
  <div class="container nav-inner">
    <div class="nav-left-group">
      <a href="https://glassmkr.com" class="nav-logo">GLASSMKR</a>
      <span class="nav-sub">/ status</span>
    </div>
    <nav>
      <a href="https://app.glassmkr.com" class="btn btn-ghost btn-small">Dashboard</a>
    </nav>
  </div>
</header>

<main class="container">
  {@render children()}
</main>

<footer class="status-footer">
  <div class="container">
    <p>Monitored with Glassmkr <a href="https://github.com/glassmkr/crucible">Crucible</a>.</p>
  </div>
</footer>

<style>
  .status-nav { padding: 1.5rem 0; border-bottom: 1px solid #3D3630; }
  .nav-inner { display: flex; justify-content: space-between; align-items: baseline; }
  .nav-left-group { display: flex; gap: 0.75rem; align-items: baseline; }
  .nav-logo { color: #F5F0E8; font-weight: 600; letter-spacing: 0.08em; text-decoration: none; }
  .nav-sub { color: #A69882; font-size: 0.9rem; }
  .container { max-width: 880px; margin: 0 auto; padding: 0 1.5rem; }
  main.container { padding-top: 2.5rem; padding-bottom: 3rem; }
  .status-footer { border-top: 1px solid #3D3630; padding: 1.5rem 0; color: #6B5E50; font-size: 0.85rem; }
  .status-footer a { color: #A69882; }
</style>
