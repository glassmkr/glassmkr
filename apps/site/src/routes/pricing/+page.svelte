<script lang="ts">
  import Pricing from "$lib/components/homepage/Pricing.svelte";
  import rules from "$lib/data/rules.json";

  // Dedicated /pricing route (added 2026-06-21). Renders the homepage
  // Pricing section component (asPage, so its heading is this page's h1)
  // so plan details stay single-sourced: the homepage #pricing section
  // and this page render the exact same component.

  const ruleCount = rules.length;

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
          name: "Self-hosted",
          price: "0",
          priceCurrency: "USD",
          description:
            `AGPL-3.0-only, free forever. All ${ruleCount} rules, remediation commands, trend warnings, every notification channel, the full read and write API, MCP, and AI analysis via any OpenAI-compatible endpoint. No node limits; nothing leaves your network.`,
          url: "https://glassmkr.com/docs/self-hosting",
        },
        {
          "@type": "Offer",
          name: "Hosted",
          price: "0",
          priceCurrency: "USD",
          description:
            "The maintained instance at app.glassmkr.com. Free, signups open, no credit card. Same features as self-hosted, with a per-account node cap as capacity protection.",
          url: "https://glassmkr.com/pricing",
        },
      ],
    },
  });
</script>

<svelte:head>
  <title>Pricing - Glassmkr</title>
  <meta
    name="description"
    content="Glassmkr is free both ways: self-hosted under AGPL-3.0-only with everything included and no node limits, or the free hosted instance at app.glassmkr.com."
  />
  <link rel="canonical" href="https://glassmkr.com/pricing" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/pricing" />
  <meta property="og:title" content="Pricing - Glassmkr" />
  <meta
    property="og:description"
    content="Free both ways. Self-hosted: AGPL-3.0-only, everything included, no node limits, your data stays on your network. Hosted: free, signups open, same features."
  />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Pricing - Glassmkr" />
  <meta
    name="twitter:description"
    content="Free both ways: self-hosted (AGPL-3.0-only, no limits) or the free hosted instance. Same features."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  {@html `<script type="application/ld+json">${productLd.replace(/</g, "\\u003c")}</` + `script>`}
</svelte:head>

<Pricing asPage />
