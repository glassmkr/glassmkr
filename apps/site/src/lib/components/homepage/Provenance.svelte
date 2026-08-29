<script lang="ts">
  // Provenance rewrite per CONTENT_TRANCHE_1 spec (2026-05-17). The
  // previous version was a single Philosophy paragraph about the
  // Bohemian glassmaking name; the spec replaces with a self-hosted-
  // AI emphasis section because the audit found the trust posture
  // was under-surfaced. The name philosophy moves to /about (already
  // covered there).
</script>

<section class="provenance">
  <div class="inner">
    <p class="eyebrow">ABOUT GLASSMKR’S INFRASTRUCTURE</p>
    <h2 class="heading">Glassmkr runs on dedicated bare-metal infrastructure, not shared cloud VMs.</h2>
    <p class="body">
      The Crucible agent runs on every Glassmkr server. The AI assistant Furnace runs on a self-hosted Gemma 4 26B model on a single NVIDIA L4 GPU in Amsterdam. No OpenAI, no Anthropic, no Google. That host and the dashboard are both Amsterdam allocations in the RIPE registry, which you can check yourself; the <a href="/trust">trust page</a> gives the command and separates where the servers sit from where the operator and the provider are registered.
    </p>
    <p class="body">
      SvelteKit for the dashboard, llama.cpp running Gemma for the AI, pgBackRest for backups. Boring, well-understood, debuggable.
    </p>
    <a class="link" href="/about">More about how Glassmkr is built &rarr;</a>
  </div>
</section>

<style>
  .provenance {
    padding: 80px 24px;
  }
  .inner {
    max-width: 720px;
    margin: 0 auto;
    text-align: center;
  }
  .eyebrow {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--accent);
    opacity: 0.7;
    margin: 0 0 18px;
  }
  .heading {
    font-size: clamp(24px, 3vw, 32px);
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 0 0 28px;
  }
  .body {
    font-size: 15.5px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin: 0 0 18px;
    text-align: left;
  }
  .body:last-of-type { margin-bottom: 24px; }
  .link {
    display: inline-block;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .link:hover { color: var(--accent); text-decoration: none; }

  @media (max-width: 600px) {
    .provenance { padding: 64px 20px; }
  }
</style>
