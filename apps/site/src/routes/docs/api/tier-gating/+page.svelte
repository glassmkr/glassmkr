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

<style>

  /* Mobile technical-text floor: 12px minimum on a phone. */
  @media (max-width: 768px) {
    code { font-size: 12px; }
  }</style>
