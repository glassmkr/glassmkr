<script lang="ts">
  // Homepage v4: ground-up rebuild per the 2026-08 design brief. The page
  // is evidence, not illustration: real rule ids, real commands, real
  // interface shapes. Section order follows the brief's IA: hero with the
  // product surface (7-8), architecture (9), open source as a pillar (10),
  // the rules table (11), installation (12), product surfaces (13-14),
  // the hosted service last (15). Each idea appears once (16).
  import Hero from "$lib/components/homepage/Hero.svelte";
  import ArchDiagram from "$lib/components/homepage/ArchDiagram.svelte";
  import OpenSourceFacts from "$lib/components/homepage/OpenSourceFacts.svelte";
  import RulesTable from "$lib/components/homepage/RulesTable.svelte";
  import InstallSection from "$lib/components/homepage/InstallSection.svelte";
  import ProductSurfaces from "$lib/components/homepage/ProductSurfaces.svelte";
  import CloudSection from "$lib/components/homepage/CloudSection.svelte";
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
      `Open-source bare metal server monitoring with SMART, IPMI, ZFS, and ECC monitoring. ${ruleCount} alert rules with copy-pasteable fix commands. Self-hostable with Docker Compose; AGPL-3.0-only end to end.`,
    url: "https://glassmkr.com",
    image: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826",
    offers: [
      {
        "@type": "Offer",
        name: "Self-hosted",
        price: "0",
        priceCurrency: "USD",
        description: `AGPL-3.0-only, free forever. Everything included: all ${ruleCount} rules, every channel, full API, AI analysis via your own endpoint, and the MCP server once TLS is in front of it. No node limits.`,
      },
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
      `Open-source bare metal server monitoring built by operators. ${ruleCount} alert rules, trend warnings, self-hostable end to end.`,
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
  <title>Glassmkr - Open-source monitoring for bare metal</title>
  <meta
    name="description"
    content="Open-source, self-hostable bare metal monitoring. Catch SMART, IPMI, ECC, RAID, ZFS and network failures before they cascade. AGPL-3.0-only end to end."
  />
  <link rel="canonical" href="https://glassmkr.com/" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/" />
  <meta property="og:title" content="Glassmkr - Open-source monitoring for bare metal" />
  <meta
    property="og:description"
    content="Catch SMART, IPMI, ECC, RAID, ZFS and network failures before they cascade. Self-host the entire stack or use the hosted service. AGPL-3.0-only end to end."
  />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr - Open-source monitoring for bare metal" />
  <meta
    name="twitter:description"
    content="SMART, IPMI, ECC, RAID, ZFS and network failures caught before they cascade. Self-hostable end to end, AGPL-3.0-only throughout."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />

  <!-- Structured data: SoftwareApplication + Organization. Emitted via
       {@html} so the JSON payload is not HTML-escaped. -->
  {@html `<script type="application/ld+json">${softwareApplicationLd}</` + `script>`}
  {@html `<script type="application/ld+json">${organizationLd}</` + `script>`}
</svelte:head>

<Hero />
<ArchDiagram />
<OpenSourceFacts />
<RulesTable />
<InstallSection />
<ProductSurfaces />
<CloudSection />
