<script lang="ts">
  // Shared <svelte:head> for all /vs/<competitor> comparison pages
  // (CONTENT_TRANCHE_2 spec, 2026-05-17). Each page previously
  // hand-built an identical head + Article JSON-LD block; this
  // component centralizes that so the meta tags and structured data
  // stay consistent across the 8 comparison pages.
  //
  // The JSON-LD object is assembled in the same key order the pages
  // used and serialized with JSON.stringify, then injected via the
  // {@html} split-script trick so the JSON-LD closing tag inside the
  // string does not terminate this module's own script block.

  // orgUrl is optional: only /vs/datadog carried the author/publisher
  // Organization url originally; the others omit it.
  let {
    title,
    description,
    slug,
    competitorName,
    competitorUrl,
    ogTitle,
    headline = title,
    ogDescription = description,
    articleDescription = description,
    datePublished = "2026-05-17",
    dateModified = "2026-05-17",
    orgUrl = undefined,
  } = $props();

  let canonical = $derived(`https://glassmkr.com/vs/${slug}`);

  let org = $derived(orgUrl
    ? { "@type": "Organization", name: "Glassmkr", url: orgUrl }
    : { "@type": "Organization", name: "Glassmkr" });

  let articleLd = $derived(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description: articleDescription,
    image: "https://glassmkr.com/og/default.png?v=20260826",
    datePublished,
    dateModified,
    mainEntityOfPage: canonical,
    author: org,
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" } },
    about: [
      { "@type": "SoftwareApplication", name: "Glassmkr", url: "https://glassmkr.com" },
      { "@type": "SoftwareApplication", name: competitorName, url: competitorUrl },
    ],
  }));
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="article" />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDescription} />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  {@html `<script type="application/ld+json">${articleLd}</` + `script>`}
</svelte:head>
