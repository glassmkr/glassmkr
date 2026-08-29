<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<footer>
  <div class="container footer-inner">
    {#if children}
      {@render children()}
    {:else}
      <!-- Dense, useful footer per GLASSMKR_REDESIGN_FINAL_SPEC 13.4. The
           use-case routes left the top nav at launch but stay indexed and
           reachable from here. License wording: Crucible, the dashboard,
           and the backend are all AGPL-3.0-only (agent since v1.1.0). -->
      <div class="footer-left">
        <span class="label">Glassmkr</span>
        <span class="license-line">Crucible, Dashboard, and backend: AGPL-3.0-only</span>
      </div>
      <div class="footer-cols">
        <div class="footer-links">
          <a href="https://glassmkr.com/for-storage">Storage servers</a>
          <a href="https://glassmkr.com/for-compute">Bare-metal compute</a>
          <a href="https://glassmkr.com/for-gpu">GPU and ML</a>
          <a href="https://glassmkr.com/for-providers">Hosting providers</a>
          <a href="https://app.glassmkr.com/demo">Live demo</a>
        </div>
        <div class="footer-links">
          <a href="https://glassmkr.com/docs">Docs</a>
          <a href="https://glassmkr.com/docs/self-hosting">Self-hosting</a>
          <a href="https://github.com/glassmkr">GitHub</a>
          <a href="https://glassmkr.com/blog">Blog</a>
          <a href="https://glassmkr.com/about">About</a>
        </div>
        <div class="footer-links">
          <a href="https://glassmkr.com/trust">Trust</a>
          <a href="https://glassmkr.com/security">Security</a>
          <a href="https://glassmkr.com/privacy">Privacy</a>
          <a href="https://glassmkr.com/terms">Terms</a>
          <a href="https://status.glassmkr.com">Status</a>
        </div>
      </div>
    {/if}
  </div>
</footer>

<style>
  footer {
    padding: 48px 0 32px;
    border-top: 1px solid var(--surface-border);
    margin-top: 80px;
    position: relative;
    z-index: 1;
  }
  .footer-inner { display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; }
  .footer-left { display: flex; flex-direction: column; gap: 8px; }
  .license-line {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .footer-cols { display: flex; gap: 48px; }
  .footer-links { display: flex; flex-direction: column; gap: 8px; }
  .footer-links a {
    font-size: 13px;
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .footer-links a:hover { color: var(--text-secondary); }

  @media (max-width: 600px) {
    .footer-inner { flex-direction: column; gap: 24px; text-align: left; }
    .footer-cols { flex-wrap: wrap; gap: 24px 40px; }
  }
</style>
