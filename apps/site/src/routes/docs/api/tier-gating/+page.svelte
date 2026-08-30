<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "API", item: "https://glassmkr.com/docs/api" },
      { "@type": "ListItem", position: 3, name: "Tier gating", item: "https://glassmkr.com/docs/api/tier-gating" },
    ],
  });
</script>

<svelte:head>
  <title>API tier gating: Glassmkr documentation</title>
  <meta name="description" content="Nothing in the Glassmkr API is tier-gated. Since August 2026 there are no paid tiers: hosted accounts and self-hosted instances both get the full API. Historical account keys keep working." />
  <link rel="canonical" href="https://glassmkr.com/docs/api/tier-gating" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/api/tier-gating" />
  <meta property="og:title" content="API tier gating" />
  <meta property="og:description" content="Nothing in the API is tier-gated anymore. Since August 2026 there are no paid tiers; historical account keys keep working." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="API tier gating" />
  <meta name="twitter:description" content="Nothing in the API is tier-gated anymore. Since August 2026 there are no paid tiers; historical account keys keep working." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs/api" class="sidebar-section">&larr; API reference</a>
      <a href="#overview" class="sidebar-link">Overview</a>
      <a href="#what-changed" class="sidebar-link">What changed</a>
      <a href="#existing-keys" class="sidebar-link">Existing keys</a>
      <a href="#related" class="sidebar-link">Related</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / API / TIER GATING</p>
      <h1>API tier gating</h1>
      <p class="docs-subtitle">There is none. Since August 2026, nothing in the Glassmkr API is tier-gated: hosted accounts and self-hosted instances both get the full read+write API.</p>
    </header>

    <section id="overview">
      <h2><a href="#overview" class="anchor-link">#</a>Overview</h2>
      <p>This page used to document which API capabilities required the paid Pro plan. As of August 2026, Glassmkr is fully open source and has no paid tiers, so there is nothing left to gate. The page stays because URLs live forever.</p>
      <p>Every account API key (read, write, or admin scope) reaches the full API surface: server management, channel CRUD, alert mutations, trend warnings, health history, AI analysis, key management, and ingest. The web dashboard is likewise complete for every account.</p>
    </section>

    <section id="what-changed">
      <h2><a href="#what-changed" class="anchor-link">#</a>What changed, and when</h2>
      <p>In August 2026 the entire stack went open source (dashboard monorepo and Crucible agent both AGPL-3.0-only) and the Free/Pro split was retired. The three limits Pro used to lift are now handled like this:</p>
      <ul>
        <li><strong>Node count.</strong> Hosted accounts have a 10-node per-account cap, a capacity protection rather than a tier. Self-hosted instances have no node limits.</li>
        <li><strong>Retention.</strong> Every account keeps 90 days of snapshot history, hosted and self-hosted alike. It is enforced by a ClickHouse table TTL, so a self-hosted operator can change the window on their own instance.</li>
        <li><strong>AI analysis.</strong> Enabled on hosted accounts; a self-hosted instance enables it by pointing <code>LLM_API_URL</code> at any OpenAI-compatible endpoint.</li>
      </ul>
      <p>The <code>402 pro_required</code> response documented here previously is no longer returned by any endpoint. The only quota-shaped error a hosted account can hit is the 10-node cap on <code>POST /api/v1/servers</code>.</p>
    </section>

    <section id="existing-keys">
      <h2><a href="#existing-keys" class="anchor-link">#</a>Existing keys and integrations</h2>
      <p>Historical <code>gmk_acct_live_</code> account keys keep working unchanged, with the same scopes they were minted with. No integration changes are required; code that handled 402 responses simply never sees them anymore.</p>
    </section>

    <section id="related">
      <h2><a href="#related" class="anchor-link">#</a>Related pages</h2>
      <ul>
        <li><a href="/docs/api">API reference</a>: full endpoint catalog</li>
        <li><a href="/docs/programmatic-api">Programmatic API</a>: keys, scopes, rate-limit tiers, idempotency, audit log</li>
        <li><a href="/docs/self-hosting">Self-hosting</a>: run the whole stack on your hardware with Docker Compose</li>
      </ul>
      <p class="note">Last verified: 2026-08-24.</p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 960px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 180px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: color 0.15s, border-color 0.15s; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.6; }
  section { margin-bottom: 3rem; scroll-margin-top: 80px; }
  h2 { font-size: 1.4rem; color: var(--text-primary); margin-bottom: 0.75rem; position: relative; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.5rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    code { font-size: 12px; }
  }
</style>
