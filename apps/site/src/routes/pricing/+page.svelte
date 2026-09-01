<script lang="ts">
  import rules from "$lib/data/rules.json";
  import { HOSTED_NODE_CAP } from "$lib/product-facts";

  // Pricing per the visual spec (section 11) and the content redesign (6.2):
  // left proposition, hosted first and recommended, self-hosted equally
  // truthful but not equally conversion-weighted, one full-width operational
  // comparison sheet, the choose-first FAQ. The old homepage Pricing
  // component had one consumer (this route), so it lives inline now.

  // Rule count from the generated catalog, never a literal; the node cap is
  // configured product data (ground-truth.yaml: hosted_node_cap).
  const ruleCount = rules.length;

  // One comparison sheet, hosted column first (content 6.2). The values are
  // the same facts the sheet carried before the recomposition; only the
  // column order and page shape changed.
  const sheet: [string, string, string][] = [
    ["Cost", "$0", "$0"],
    ["License", "Same software, operated for you", "AGPL-3.0-only"],
    ["Nodes", `Up to ${HOSTED_NODE_CAP} per account`, "No limit"],
    ["Alert rules", `All ${ruleCount}`, `All ${ruleCount}`],
    ["Remediation and trend warnings", "Included", "Included"],
    ["Notification channels", "All", "All"],
    ["API", "Full read and write", "Full read and write"],
    ["MCP server", "Available", "Included, needs TLS in front"],
    ["AI analysis", "Included", "Any OpenAI-compatible endpoint"],
    ["Where data lives", "Amsterdam", "Your network"],
    ["Who operates it", "Glassmkr", "You"],
  ];

  // "Which option should I choose?" leads (content 6.2, exact copy); the
  // remaining answers are adopted from the round-2 decisions doc, with the
  // node count rendered from HOSTED_NODE_CAP.
  const faq = [
    {
      q: "Which option should I choose?",
      a: "If you are unsure, start hosted. It is the fastest way to monitor a server and does not require you to run Postgres, ClickHouse, backups, upgrades, or TLS. Choose self-hosted when those responsibilities are an acceptable trade for complete control.",
    },
    {
      q: "Why is hosted Glassmkr free?",
      a: `Glassmkr is primarily an open-source project. The hosted service is a convenient way to use the same software without operating the stack yourself. Hosted accounts currently support up to ${HOSTED_NODE_CAP} nodes.`,
    },
    {
      q: "Will hosted stay free?",
      a: "That is the intent. If hosted load ever forces a change, self-hosting stays free under AGPL-3.0-only and export exists.",
    },
    {
      q: "What is the difference?",
      a: "Same codebase. Self-hosted runs on your hardware with every gate removed; hosted is the same thing operated for you. Agents re-point between them with one init command.",
    },
  ];

  // Product + Offer structured data. Both deployment forms are free
  // (OSS pivot, 2026-08): self-hosted under AGPL-3.0-only with no limits,
  // hosted with a per-account node cap as capacity protection.
  const productLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Glassmkr",
    description:
      `Open-source bare-metal infrastructure monitoring. ${ruleCount} opinionated alert rules, AGPL-3.0-only Crucible agent and dashboard, self-hostable with Docker Compose.`,
    brand: { "@type": "Brand", name: "Glassmkr" },
    url: "https://glassmkr.com/pricing",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: "0",
      offerCount: 2,
      offers: [
        {
          "@type": "Offer",
          name: "Hosted",
          price: "0",
          priceCurrency: "USD",
          description:
            "The maintained instance at app.glassmkr.com. Free, signups open, no credit card. Same features as self-hosted, with a per-account node cap as capacity protection.",
          url: "https://glassmkr.com/pricing",
        },
        {
          "@type": "Offer",
          name: "Self-hosted",
          price: "0",
          priceCurrency: "USD",
          description:
            `AGPL-3.0-only, free forever. All ${ruleCount} rules, remediation commands, trend warnings, every notification channel, the full read and write API, MCP, and AI analysis via any OpenAI-compatible endpoint. No node limits; nothing leaves your network.`,
          url: "https://glassmkr.com/docs/self-hosting",
        },
      ],
    },
  });
</script>

<svelte:head>
  <title>Pricing - Glassmkr</title>
  <meta
    name="description"
    content="Glassmkr is free both ways: the hosted instance at app.glassmkr.com, or self-hosted under AGPL-3.0-only with everything included and no node limits."
  />
  <link rel="canonical" href="https://glassmkr.com/pricing" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/pricing" />
  <meta property="og:title" content="Pricing - Glassmkr" />
  <meta
    property="og:description"
    content="Free both ways. Hosted: free, signups open, same features. Self-hosted: AGPL-3.0-only, everything included, no node limits, your data stays on your network."
  />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Pricing - Glassmkr" />
  <meta
    name="twitter:description"
    content="Free both ways: the hosted instance, or self-hosted (AGPL-3.0-only, no limits). Same features."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  {@html `<script type="application/ld+json">${productLd.replace(/</g, "\\u003c")}</` + `script>`}
</svelte:head>

<div class="pricing-page">
  <section class="site-grid band-compact hero">
    <div class="col-1-7">
      <h1>Free to use. Choose who operates the monitoring.</h1>
      <p class="subhead">
        Start with hosted Glassmkr if you do not want another service to
        maintain. Self-host when you need the data path and operations under
        your control.
      </p>
    </div>
  </section>

  <section class="site-grid band-compact paths-band" aria-label="Deployment paths">
    <div class="col-1-7 path recommended">
      <p class="path-label">HOSTED GLASSMKR <span class="rec">RECOMMENDED START</span></p>
      <p class="path-price">$0</p>
      <p class="path-body">
        The maintained instance at app.glassmkr.com. No card, signups open,
        free up to <span class="mono">{HOSTED_NODE_CAP}</span> nodes per
        account. Updates, storage, and backups operated by Glassmkr.
      </p>
      <a href="https://app.glassmkr.com/register" class="btn btn-primary">Create a free account</a>
    </div>
    <div class="col-8-12 path">
      <p class="path-label">SELF-HOSTED GLASSMKR</p>
      <p class="path-price">$0</p>
      <p class="path-body">
        The complete stack under <span class="mono">AGPL-3.0-only</span>, no
        node limit, telemetry stays on your network. You operate databases,
        upgrades, backups, and TLS.
      </p>
      <a href="/docs/self-hosting" class="btn btn-quiet-2">Read the self-hosting guide</a>
    </div>
  </section>

  <section class="site-grid band-compact" aria-label="Operational comparison">
    <div class="col-1-12 table-scroll" tabindex="0" role="region" aria-label="Hosted compared with self-hosted, full sheet">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Hosted</th>
            <th>Self-hosted</th>
          </tr>
        </thead>
        <tbody>
          {#each sheet as [label, hosted, selfHosted] (label)}
            <tr>
              <td class="attr">{label}</td>
              <td class="mono-cell">{hosted}</td>
              <td class="mono-cell">{selfHosted}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="site-grid band-compact faq" aria-label="Pricing FAQ">
    <h2 class="col-1-4 faq-heading">Questions</h2>
    <div class="col-5-12 faq-list">
      {#each faq as item (item.q)}
        <div class="faq-item">
          <h3>{item.q}</h3>
          <p>{item.a}</p>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .hero {
    padding-top: clamp(40px, 6vh, 72px);
  }
  h1 {
    font-size: clamp(2.4rem, 1.8rem + 2.4vw, 4.25rem);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.04;
    margin: 0 0 18px;
    text-wrap: balance;
  }
  .subhead {
    font-size: 16px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
    max-width: 62ch;
  }

  .paths-band {
    row-gap: var(--grid-gap);
  }
  .path {
    border: 1px solid var(--g-border);
    border-radius: var(--g-radius-2);
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .path.recommended {
    border-color: var(--g-brand-edge);
  }
  .path-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-primary);
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: baseline;
  }
  .path-label .rec {
    color: var(--g-brand);
    font-size: 12px;
    letter-spacing: 0.08em;
  }
  .path-price {
    font-family: var(--font-mono);
    font-size: 34px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .path-body {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
    flex: 1;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.95em;
  }
  :global(.btn.btn-quiet-2) {
    background: transparent;
    border: 1px solid var(--g-border-strong);
    color: var(--text-primary);
  }
  :global(.btn.btn-quiet-2:hover) {
    border-color: var(--g-brand-edge);
    background: transparent;
  }

  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 640px;
  }
  th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    font-weight: 500;
    padding: 12px 24px 12px 0;
    border-bottom: 1px solid var(--g-border-strong);
  }
  td {
    padding: 12px 24px 12px 0;
    border-bottom: 1px solid var(--g-border-subtle);
    vertical-align: top;
    font-size: 14px;
    line-height: 1.5;
  }
  .attr {
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
  }
  .mono-cell {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
  }

  .faq-heading {
    font-size: var(--type-h3);
    font-weight: 500;
    letter-spacing: -0.015em;
    margin: 0;
  }
  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid var(--g-border-strong);
  }
  .faq-item {
    padding: 16px 0;
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .faq-item h3 {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 6px;
  }
  .faq-item p {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
    max-width: 78ch;
  }

  @media (max-width: 1023px) {
    .faq-heading {
      margin-bottom: 16px;
    }
  }
</style>
