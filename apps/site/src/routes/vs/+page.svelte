<script lang="ts">
  // /vs hub index. Single entry point into the 8 comparison pages,
  // which were previously orphaned (no nav/footer/homepage link and no
  // index, so glassmkr.com/vs 404'd). The per-page ComparisonFooter
  // cross-links the cluster; this page is the front door for humans and
  // crawlers, linked from the site footer. Reuses the authoritative
  // competitor list so it never drifts from the actual /vs/<slug> set.
  import { COMPETITORS } from "$lib/components/vs/competitors";
  import VsCta from "$lib/components/vs/VsCta.svelte";

  const canonical = "https://glassmkr.com/vs";

  // ItemList JSON-LD: tells crawlers the hub points at all 8 comparisons.
  const itemListLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Glassmkr monitoring tool comparisons",
    itemListElement: COMPETITORS.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `Glassmkr vs ${c.label}`,
      url: `https://glassmkr.com/vs/${c.slug}`,
    })),
  });
</script>

<svelte:head>
  <title>Compare Glassmkr to other monitoring tools - Glassmkr</title>
  <meta
    name="description"
    content={`Side-by-side comparisons of Glassmkr with ${COMPETITORS.map((c) => c.label).join(", ")} for bare-metal monitoring.`}
  />
  <link rel="canonical" href={canonical} />

  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content="Compare Glassmkr to other monitoring tools" />
  <meta
    property="og:description"
    content="Side-by-side comparisons of Glassmkr with the monitoring tools teams most often weigh it against."
  />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Compare Glassmkr to other monitoring tools" />
  <meta
    name="twitter:description"
    content="Side-by-side comparisons of Glassmkr with Datadog, Prometheus, Netdata, and more."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />

  {@html `<script type="application/ld+json">${itemListLd}</` + `script>`}
</svelte:head>

<div class="vs-hub">
  <header class="hub-head">
    <p class="eyebrow">COMPARISONS</p>
    <h1>How Glassmkr compares</h1>
    <p class="lede">
      Side-by-side looks at Glassmkr next to the monitoring tools teams most often weigh it against.
      Each page is an honest breakdown of where the two fit and where they differ.
    </p>
  </header>

  <!-- Editorial rows, not a card grid. Every card carried the same three strings
       in a box, which is a layout doing no work. Rows let the reader scan tool,
       category and where that tool is stronger, which is the question someone
       arrives with. -->
  <ul class="vs-rows">
    {#each COMPETITORS as c (c.slug)}
      <li class="vs-row">
        <div class="vs-row-main">
          <a class="vs-row-link" href="/vs/{c.slug}">Glassmkr vs {c.label}</a>
          <span class="vs-row-cat">{c.category}</span>
        </div>
        {#if c.strength}
          <p class="vs-row-strength"><span class="vs-row-label">Stronger there</span> {c.strength}</p>
        {/if}
      </li>
    {/each}
  </ul>

  <p class="hub-foot">
    Not sure where to start? <a href="/pricing">See pricing</a> or read the
    <a href="/docs/getting-started">getting-started guide</a>.
  </p>

  <VsCta variant="bottom" />
</div>

<style>
  .vs-hub {
    max-width: 920px;
    margin: 0 auto;
    padding: 72px 24px 96px;
  }
  .hub-head {
    text-align: center;
    max-width: 680px;
    margin: 0 auto 56px;
  }
  .eyebrow {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--accent);
    opacity: 0.7;
    margin: 0 0 16px;
  }
  h1 {
    font-size: clamp(32px, 4.8vw, 48px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 16px;
  }
  .lede {
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .vs-rows { list-style: none; margin: 0; padding: 0; }
  .vs-row { padding: 20px 0; border-top: 1px solid var(--surface-border); }
  .vs-row:first-child { border-top: none; }
  .vs-row-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; }
  .vs-row-link { font-size: 1.05rem; font-weight: 600; color: var(--text-primary); text-decoration: none; }
  .vs-row-link:hover { color: var(--accent); }
  .vs-row-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .vs-row-cat {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .vs-row-strength { margin: 6px 0 0; color: var(--text-secondary); font-size: 0.95rem; max-width: 62ch; }
  .vs-row-label {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-right: 8px;
  }
  .hub-foot {
    text-align: center;
    margin: 56px 0 0;
    font-size: 15px;
    color: var(--text-secondary);
  }
  .hub-foot a {
    color: var(--accent);
    text-decoration: none;
  }
  .hub-foot a:hover {
    text-decoration: underline;
  }
  @media (max-width: 600px) {
    .vs-hub {
      padding: 56px 20px 72px;
    }
  }
</style>
