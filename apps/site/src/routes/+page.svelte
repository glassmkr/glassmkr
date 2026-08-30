<script lang="ts">
  // Homepage v5: the Axiom-led recomposition (visual spec section 10) carrying
  // the server-owner copy (content redesign section 5). Hero with the product
  // stage inside the fold, then five chapters: the judgment Glassmkr supplies,
  // what it watches, the alert as a workflow, hosted versus self-hosted, and
  // open-source trust, closed by one action block. Every exhibit is a
  // hash-verified capture; every count and license reads a generated or
  // configured source.
  import Hero from "$lib/components/homepage/Hero.svelte";
  import JudgmentChapter from "$lib/components/homepage/JudgmentChapter.svelte";
  import WatchesChapter from "$lib/components/homepage/WatchesChapter.svelte";
  import WorkflowChapter from "$lib/components/homepage/WorkflowChapter.svelte";
  import DeployChapter from "$lib/components/homepage/DeployChapter.svelte";
  import TrustChapter from "$lib/components/homepage/TrustChapter.svelte";
  import ClosingCTA from "$lib/components/homepage/ClosingCTA.svelte";
  import rules from "$lib/data/rules.json";
  import productFacts from "$lib/data/product-facts.json";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The rule count comes from the generated catalog, never a literal
  // (convention: gen-rules.mjs is the single source of truth).
  const ruleCount = rules.length;
  // Never a literal: the cap is configured product data.
  const hostedNodeCap = productFacts.hostedNodeCap;

  // JSON-LD schemas. Two separate documents (SoftwareApplication +
  // Organization) emitted as <script type="application/ld+json"> in
  // <svelte:head>. Use {@html} so Svelte doesn't HTML-escape the
  // inner JSON. Both deployment forms are free (OSS pivot, 2026-08).
  const softwareApplicationLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Glassmkr",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Server Monitoring",
    operatingSystem: "Linux",
    description:
      `Open-source Linux server monitoring. Glassmkr watches the Linux and hardware signals most people never configure (SMART, IPMI, ECC, RAID, ZFS, network), explains what needs attention, and gives you the next command to run. ${ruleCount} alert rules. Self-hostable with Docker Compose; AGPL-3.0-only end to end.`,
    url: "https://glassmkr.com",
    image: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826",
    offers: [
      {
        "@type": "Offer",
        name: "Glassmkr hosted",
        price: "0",
        priceCurrency: "USD",
        // Structured data is where a claim gets quoted back at you without the
        // page around it to qualify it. This used to reserve "the audit log,
        // unlimited AI analysis and longer retention" for a paid tier, which
        // stopped existing at the P0-03 resolution: hosted has ONE contract.
        description: `The maintained instance at app.glassmkr.com. Free up to ${hostedNodeCap} nodes, signups open, no paid tier: the audit log, AI analysis and 90-day retention are on for every account.`,
      },
      {
        "@type": "Offer",
        name: "Self-hosted",
        price: "0",
        priceCurrency: "USD",
        description: `AGPL-3.0-only, free forever. Everything included: all ${ruleCount} rules, every channel, full API, AI analysis via your own endpoint, and the MCP server once TLS is in front of it. No node limits.`,
      },
    ],
    publisher: {
      "@type": "Organization",
      name: "Glassmkr",
      url: "https://glassmkr.com",
    },
  });

  const organizationLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Glassmkr",
    url: "https://glassmkr.com",
    logo: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826",
    description:
      `Open-source Linux and dedicated-server monitoring. ${ruleCount} alert rules with evidence and guided remediation, self-hostable end to end.`,
    email: "hello@glassmkr.com",
    // The agent repository was listed twice and the second entry was not a
    // second profile. The dashboard repository joins this list when it is
    // public, not before: sameAs pointing at a 404 is worse than a short list.
    sameAs: [
      "https://github.com/glassmkr",
      "https://github.com/glassmkr/crucible",
      "https://www.npmjs.com/package/@glassmkr/crucible",
    ],
  });
</script>

<svelte:head>
  <title>Glassmkr - Know when your server is in trouble</title>
  <meta
    name="description"
    content="Open-source Linux server monitoring. Glassmkr watches the hardware and OS signals most people never configure, explains what needs attention, and gives you the next command to run. Hosted or self-hosted, AGPL-3.0-only."
  />
  <link rel="canonical" href="https://glassmkr.com/" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/" />
  <meta property="og:title" content="Glassmkr - Know when your server is in trouble" />
  <meta
    property="og:description"
    content="Open-source Linux server monitoring that explains what needs attention and gives you the next command to run. SMART, IPMI, ECC, RAID, ZFS, and network. Hosted or self-hosted, AGPL-3.0-only."
  />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr - Know when your server is in trouble" />
  <meta
    name="twitter:description"
    content="Open-source Linux server monitoring that explains what needs attention and gives you the next command to run. Hosted or self-hosted, AGPL-3.0-only throughout."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />

  <!-- Structured data: SoftwareApplication + Organization. Emitted via
       {@html} so the JSON payload is not HTML-escaped. -->
  {@html `<script type="application/ld+json">${softwareApplicationLd}</` + `script>`}
  {@html `<script type="application/ld+json">${organizationLd}</` + `script>`}
</svelte:head>

<Hero />
<JudgmentChapter />
<WatchesChapter />
<WorkflowChapter />
<DeployChapter />
<TrustChapter />
<ClosingCTA />
