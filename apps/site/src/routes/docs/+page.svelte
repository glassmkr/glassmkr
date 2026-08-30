<script lang="ts">
  import rulesData from "$lib/data/rules.json";

  // The alert-rules summary tables below are rendered from the generated
  // rule catalog (rules.json, emitted by gen-rules.mjs from the YAML source
  // of truth) so they cannot drift from the live rule set: counts, grouping,
  // and membership all follow the data. Category order is the only thing
  // fixed here. Full per-rule detail (trigger, quick-check, verdict prior)
  // lives on the /docs/rules catalog pages.
  type CatalogRule = { id: string; priority: string; title: string; summary: string; _category: string };
  const RULE_CATEGORY_ORDER = [
    "Storage",
    "ZFS",
    "Filesystem",
    "Memory & CPU",
    "Network",
    "Hardware (BMC/IPMI)",
    "GPU",
    "Time & Services",
    "Security & Patching",
  ];
  const rulesByCategory = RULE_CATEGORY_ORDER
    .map((category) => ({
      category,
      rules: (rulesData as CatalogRule[]).filter((r) => r._category === category),
    }))
    .filter((group) => group.rules.length > 0);

  // IA reshuffle (2026-05-18) per CONTENT_TRANCHE_3_DOCS_TRUST_FURNACE
  // spec acceptance criterion #4. Seven top-level groups; each group's
  // sub-sections render as h3 inside. Sidebar shows top-level groups
  // only; deep links use the group id (and IntersectionObserver below
  // tracks scroll position).
  // Matches the sections this page actually has now that it is an index rather
  // than the whole corpus. A sidebar advertising anchors that no longer exist is
  // a nav that scrolls you nowhere.
  const sections = [
    { id: "start", label: "Start here" },
    { id: "guides", label: "Guides" },
    { id: "machine", label: "For machines" },
  ];

  let activeId = $state("start");

  // FAQPage JSON-LD. Q&A pairs mirror the <details> blocks in
  // section #faq below; keep them in sync if you edit either side.
  // Emitted via {@html} so Svelte doesn't HTML-escape the JSON.
  const faqLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Do I need to open any inbound ports?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. The agent initiates all connections outbound over HTTPS (port 443). Your firewall rules do not need to change.",
        },
      },
      {
        "@type": "Question",
        name: "Does the agent work without IPMI?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. If ipmitool is not installed or there is no BMC, the IPMI module is silently skipped and all other monitoring continues normally. The case that is not silent is a BMC that is present but stops answering: the dashboard then raises ipmi_monitoring_unavailable, because fan, PSU and SEL alerts would otherwise read healthy on a machine whose hardware is no longer watched, and remote power control is usually gone too. A low ipmitool version from your distribution's package does not stop monitoring. Agent versions 0.14.6 through 0.14.8 refused to run ipmitool below 1.8.19 over CVE-2020-5208, which disabled BMC monitoring on stock Ubuntu 20.04/22.04 and RHEL-family 9; those distributions ship the fix inside a 1.8.18 package without changing the version number, so from 0.14.9 the agent collects normally and records the version instead, and from 0.14.10 it records the package version too. A below-1.8.19 build that no distribution package owns, such as one compiled from source, is still refused, because nothing backported a fix into it and Crucible runs ipmitool as root. Set collection.enforce_ipmitool_min_version to true to refuse every below-floor build regardless of origin.",
        },
      },
      {
        "@type": "Question",
        name: "What happens if connectivity is lost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The server_unreachable rule fires after the server misses 2 consecutive check-ins, about 10 minutes at the default five-minute interval. When connectivity resumes, the agent continues pushing snapshots.",
        },
      },
      {
        "@type": "Question",
        name: "Can I self-host the dashboard?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. The entire stack is open source: the dashboard monorepo is AGPL-3.0-only at github.com/glassmkr/glassmkr and the Crucible agent is AGPL-3.0-only at github.com/glassmkr/crucible. One Docker Compose file runs the whole thing on your own hardware; see glassmkr.com/docs/self-hosting.",
        },
      },
      {
        "@type": "Question",
        name: "How much does Glassmkr cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nothing. Self-hosted is free forever with no node limits; the open-source license makes that permanent. The hosted service at app.glassmkr.com is free with a 10-node per-account cap, a capacity protection rather than a tier.",
        },
      },
      {
        "@type": "Question",
        name: "Is my data stored in the EU?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The servers are. The dashboard, its databases and the AI GPU all run on dedicated hardware in Amsterdam, Netherlands, which you can confirm from the RIPE record for their addresses. Two things that phrasing usually hides, so they are stated here: the data controller is a Czech sole trader, and the network operator's legal entity is registered in the United Kingdom. GDPR applies through the controller. Self-hosting removes the question entirely.",
        },
      },
    ],
  });

  // BreadcrumbList JSON-LD so Google can render rich breadcrumbs for
  // the docs page in search results.
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://glassmkr.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Documentation",
        item: "https://glassmkr.com/docs",
      },
    ],
  });

  $effect(() => {
    if (typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeId = entry.target.id;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  });
</script>

<svelte:head>
  <title>Documentation - Glassmkr</title>
  <meta name="description" content="Glassmkr documentation: installation, {rulesData.length} alert rules across 9 categories, configuration, architecture, and self-hosting for bare-metal server monitoring." />
  <link rel="canonical" href="https://glassmkr.com/docs" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/docs" />
  <meta property="og:title" content="Glassmkr documentation" />
  <meta property="og:description" content="Installation, {rulesData.length} alert rules, configuration, architecture, and self-hosting for bare-metal server monitoring. Dashboard and Crucible agent AGPL-3.0-only." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr documentation" />
  <meta name="twitter:description" content="{rulesData.length} alert rules, five-minute snapshot interval, fully open source. Installation, configuration, architecture, self-hosting." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  <!-- Structured data: FAQPage mirrors the FAQ section below;
       BreadcrumbList renders rich breadcrumbs in search results. -->
  {@html `<script type="application/ld+json">${faqLd}</` + `script>`}
  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">

  <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
    <div class="docs-content">
      <h1>Glassmkr Documentation</h1>
      <p class="docs-subtitle">
        Open-source monitoring for bare metal. Start below, then follow the guide
        for whichever way you are running it.
      </p>

      <!-- This page used to carry the entire corpus: every guide's full text,
           duplicated from the canonical pages, 18,654px on desktop and 29,066px
           on mobile. A documentation home that contains all the documentation is
           not a home, it is a wall, and it drifts from the pages it copies. It is
           an index and a quickstart now; each guide has exactly one source. -->

      <section id="start">
        <h2><a href="#start" class="anchor-link">#</a>Start here</h2>
        <p class="group-intro">Two decisions, in order.</p>

        <ol class="start-path">
          <li>
            <strong>Choose where the dashboard runs.</strong>
            Self-host the whole stack from one compose file, with no node limit
            and no license key, or use the hosted service and skip operating it.
            <span class="start-links">
              <a href="/docs/self-hosting">Self-hosting guide</a>
              <a href="https://app.glassmkr.com/register">Hosted signup</a>
            </span>
          </li>
          <li>
            <strong>Install the agent on each machine you want to watch.</strong>
            Ubuntu and Debian have a one-line installer; everything else uses the
            single-file binary, which needs no Node.
            <span class="start-links"><a href="/docs/getting-started">Getting started</a></span>
          </li>
          <li>
            <strong>Confirm the first snapshot arrives</strong>, then route
            notifications and tune what fires.
            <span class="start-links">
              <a href="/docs/channels">Notification channels</a>
              <a href="/docs/configuration">Configuration</a>
            </span>
          </li>
        </ol>
      </section>

      <section id="guides">
        <h2><a href="#guides" class="anchor-link">#</a>Guides</h2>
        <ul class="guide-index">
          <li><a href="/docs/getting-started">Getting started</a><span>Install the agent three ways, and which one your distribution needs.</span></li>
          <li><a href="/docs/self-hosting">Self-hosting</a><span>The compose stack, backups, upgrades, retention, and pointing agents at your own dashboard.</span></li>
          <li><a href="/docs/configuration">Configuration</a><span>Every field in crucible.yaml, with defaults and bounds.</span></li>
          <li><a href="/docs/channels">Notification channels</a><span>Where alerts go, and what each channel needs.</span></li>
          <li><a href="/docs/rules">Alert rules</a><span>All {rulesData.length} rules, what each one watches, and the remediation it carries.</span></li>
          <li><a href="/docs/programmatic-api">Programmatic API</a><span>Account keys, scopes, rate limits, idempotency, and error shapes.</span></li>
          <li><a href="/docs/automated-onboarding">Automated onboarding</a><span>Enrolling hosts from Ansible, Terraform or a script.</span></li>
          <li><a href="/docs/mcp">MCP</a><span>Querying your fleet from an AI tool, and what self-hosting it requires.</span></li>
          <li><a href="/docs/troubleshooting">Troubleshooting</a><span>When the agent will not start, or snapshots do not arrive.</span></li>
          <li><a href="/docs/faq">FAQ</a><span>The questions that come up before people install anything.</span></li>
          <li><a href="/docs/changelog">Changelog</a><span>What changed, by release.</span></li>
        </ul>
      </section>

      <section id="machine">
        <h2><a href="#machine" class="anchor-link">#</a>For machines</h2>
        <p class="group-intro">
          Every guide is served as Markdown at its own URL with a <code>.md</code>
          suffix, and every alert rule at
          <code>/docs/rules/&lt;rule_id&gt;.md</code>. The whole corpus in one file
          is at <a href="/llms-full.txt">/llms-full.txt</a>, indexed by
          <a href="/llms.txt">/llms.txt</a>. Fetch those rather than scraping HTML.
        </p>
      </section>
    </div>
  </div>

<style>
  /* Layout */
  .docs-layout {
    display: flex;
    max-width: 960px;
    margin: 0 auto;
    padding: 60px 24px 120px;
    gap: 48px;
  }

  /* Sidebar */
  .sidebar {
    position: sticky;
    top: 80px;
    align-self: flex-start;
    flex-shrink: 0;
    width: 160px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
  }
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sidebar-link {
    display: block;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text-tertiary);
    text-decoration: none;
    border-left: 2px solid transparent;
    border-radius: 0 4px 4px 0;
    transition: color 0.15s, border-color 0.15s;
  }
  .sidebar-link:hover {
    color: var(--text-secondary);
    text-decoration: none;
  }
  .sidebar-link.active {
    color: var(--accent);
    border-left-color: var(--accent);
  }

  /* Content */
  .docs-content {
    flex: 1;
    min-width: 0;
  }
  h1 {
    font-size: 2.25rem;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }
  .docs-subtitle {
    color: var(--text-secondary);
    font-size: 1.05rem;
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  /* LLM-friendly intro block (2026-05-17, CONTENT_TRANCHE_3 spec).
     Subtle styled aside; doesn't dominate the human-reader view. */

  section {
    margin-bottom: 3.5rem;
    scroll-margin-top: 80px;
  }

  h2 {
    font-size: 1.5rem;
    color: var(--text-primary);
    margin-bottom: 1rem;
    position: relative;
  }
  h3 {
    font-size: 1.1rem;
    color: var(--text-primary);
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
  }
  h4 {
    font-size: 0.98rem;
    color: var(--text-primary);
    margin-top: 1.25rem;
    margin-bottom: 0.4rem;
    font-weight: 600;
  }
  p, li, dd {
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: 0.75rem;
  }

  /* IA reshuffle (2026-05-18, CONTENT_TRANCHE_3 spec).
     - .group-intro: paragraph that opens each top-level h2 group.
     - .subsection: nested h3 section inside a top-level group, gets
       a small left rule + indent so the hierarchy reads visually.
     - .llm-meta: definition list inside .llm-intro that renders the
       page-level metadata block. */
  .group-intro {
    font-size: 0.98rem;
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
    line-height: 1.7;
  }
  .subsection {
    margin-top: 1.75rem;
    margin-bottom: 0;
    padding-left: 14px;
    border-left: 1px solid rgba(255, 107, 53, 0.18);
    scroll-margin-top: 80px;
  }
  .subsection h3 {
    margin-top: 0.25rem;
  }
  /* base.css applies a global `*, *::before, *::after { padding: 0 }` reset,
     which strips list indentation. With list-style-position: outside that
     pushes the bullet markers left of the content edge, where they land on
     the .subsection left accent border. Restore an indent for prose lists.
     :where() keeps this at zero specificity so the custom list-style:none
     lists (.pricing-card, .key-points) keep their own styling. */
  .docs-content :where(ul, ol) {
    padding-left: 1.5rem;
  }
  .llm-meta-details {
    margin: 56px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--border-subtle);
  }
  .llm-meta-details summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }
  .llm-meta-details summary:hover { color: var(--text-secondary); }

  .llm-meta {
    margin: 10px 0 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    font-size: 13px;
    line-height: 1.55;
  }
  .llm-meta dt {
    font-family: var(--font-mono, monospace);
    color: var(--text-tertiary);
    font-size: 12px;
    text-transform: lowercase;
  }
  .llm-meta dd {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .llm-meta dd a {
    color: var(--text-secondary);
  }

  /* Anchor links */
  .anchor-link {
    color: transparent;
    text-decoration: none;
    margin-right: 4px;
    font-weight: 400;
    transition: color 0.15s;
  }
  h2:hover .anchor-link {
    color: var(--text-tertiary);
  }
  .anchor-link:hover {
    color: var(--accent) !important;
    text-decoration: none;
  }

  /* Code blocks */
  pre {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-left: 3px solid rgba(255, 107, 53, 0.35);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    overflow-x: auto;
    margin: 0.75rem 0 1.25rem;
  }
  pre code {
    font-family: var(--font-mono);
    font-size: 0.84rem;
    line-height: 1.65;
    color: var(--text-primary);
    background: transparent;
    padding: 0;
  }
  code {
    font-family: var(--font-mono);
    background: var(--surface);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    font-size: 0.88em;
  }
  .code-comment {
    color: var(--text-tertiary);
  }

  /* Category grid */
  .category-grid, .channel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin: 1rem 0;
  }
  .category-card {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
  }
  /* Cover h4 too: the channel-grid cards use <h4> (correct heading level under
     the <h3> subsection), which otherwise falls through to the generic h4 rule
     and inherits margin-top: 1.25rem, pushing the title down so the card's top
     padding looks bigger than its bottom. Both card title levels share one look. */
  .category-card h3,
  .category-card h4 {
    font-size: 0.95rem;
    color: var(--accent);
    margin: 0 0 6px;
  }
  .category-card p {
    font-size: 0.875rem;
    margin: 0;
    line-height: 1.55;
  }

  .rule-summary {
    font-weight: 500;
    color: var(--text-primary);
  }

  /* Notes */
  .note {
    font-size: 0.9rem;
    color: var(--text-tertiary);
    line-height: 1.6;
  }

  .signup-link {
    color: var(--accent);
    font-weight: 500;
    border-bottom: 1px dotted var(--accent);
    text-decoration: none;
  }
  .signup-link:hover {
    border-bottom-style: solid;
    text-decoration: none;
  }

  /* Tables */
  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }
  thead th {
    text-align: left;
    padding: 8px 12px;
    color: var(--text-tertiary);
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--surface-border);
  }
  tbody td {
    padding: 7px 12px;
    color: var(--text-secondary);
    border-bottom: 1px solid rgba(61, 54, 48, 0.4);
  }
  tbody tr:hover {
    background: var(--surface);
  }

  /* Correlation-requirement table on the Trend warnings concept page:
     signal combo on the left (~60%), diagnosis on the right (~40%).
     em inside cells: "and" connector, slightly muted. */
  .correlation-table td:first-child { width: 60%; }
  .correlation-table em {
    font-style: normal;
    color: var(--text-tertiary);
    padding: 0 2px;
  }

  /* Config list */
  .config-list {
    margin: 1rem 0;
  }
  .config-list dt {
    color: var(--text-primary);
    font-weight: 600;
    margin-top: 0.75rem;
    font-size: 0.95rem;
  }
  .config-list dd {
    margin-left: 0;
    margin-bottom: 0;
    font-size: 0.9rem;
  }

  /* Guide index: link on its own line, dimmed one-line description below it.
     Without this the <a> and its <span> render inline with no separation, so
     the link text runs straight into the description. */
  .guide-index {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 1rem 0;
    padding-left: 0;
  }
  .guide-index li {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .guide-index li a {
    font-weight: 500;
    width: fit-content;
  }
  .guide-index li span {
    color: var(--text-secondary);
    font-size: 0.95rem;
    line-height: 1.55;
  }

  /* Architecture diagram */
  .arch-diagram {
    display: flex;
    align-items: center;
    gap: 0;
    margin: 1.5rem 0;
    flex-wrap: wrap;
    justify-content: center;
  }
  .arch-box {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 20px;
    flex: 1;
    min-width: 200px;
    max-width: 320px;
    text-align: center;
  }
  .arch-label {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 6px;
  }
  .arch-detail {
    font-size: 0.8rem;
    color: var(--text-tertiary);
    margin-top: 8px;
  }
  .arch-modules {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: center;
    margin-top: 8px;
  }
  .arch-tag {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: var(--radius-md);
    background: rgba(255, 107, 53, 0.1);
    color: var(--accent);
    font-weight: 500;
  }
  .arch-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    flex-shrink: 0;
  }
  .arch-arrow-line {
    width: 2px;
    height: 20px;
    background: var(--surface-border);
  }
  .arch-arrow-label {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    text-align: center;
    line-height: 1.3;
    white-space: nowrap;
  }
  @media (min-width: 600px) {
    .arch-arrow {
      flex-direction: row;
      padding: 0 8px;
    }
    .arch-arrow-line {
      width: 32px;
      height: 2px;
    }
  }

  .key-points {
    list-style: none;
    padding: 0;
    margin: 1rem 0;
  }
  .key-points li {
    padding-left: 1.25rem;
    position: relative;
    margin-bottom: 0.5rem;
  }
  .key-points li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 10px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.6;
  }

  /* Pricing */
  .pricing-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    margin: 1rem 0;
  }
  .pricing-card {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 20px;
  }
  .pricing-card h4 {
    margin: 0 0 12px;
    color: var(--text-primary);
    font-size: 1.1rem;
  }
  .pricing-card ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .pricing-card li {
    font-size: 0.875rem;
    padding: 3px 0;
    margin-bottom: 0;
  }

  /* Self-hosting callout card (docs index entry point to /docs/self-hosting) */
  .selfhost-card {
    display: block;
    margin: 0 0 1.5rem;
    padding: 16px 18px;
    background: var(--surface);
    border: 1px solid rgba(255, 107, 53, 0.3);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: border-color 0.15s;
  }
  .selfhost-card:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .selfhost-title {
    display: block;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.98rem;
    margin-bottom: 2px;
  }
  .selfhost-desc {
    display: block;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  /* FAQ */
  details {
    border-bottom: 1px solid var(--surface-border);
    padding: 12px 0;
  }
  details:first-of-type {
    border-top: 1px solid var(--surface-border);
  }
  summary {
    cursor: pointer;
    font-weight: 500;
    color: var(--text-primary);
    font-size: 0.95rem;
    padding: 4px 0;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: "+";
    display: inline-block;
    width: 20px;
    color: var(--text-tertiary);
    font-weight: 400;
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
  details[open] summary::before {
    content: "\2212";
  }
  details p {
    padding-left: 20px;
    font-size: 0.9rem;
    margin-top: 4px;
    margin-bottom: 4px;
  }

  /* Links section */
  .link-list {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
  }
  .link-list a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
    border-bottom: 1px dotted var(--accent);
  }
  .link-list a:hover {
    border-bottom-style: solid;
    text-decoration: none;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .sidebar {
      display: none;
    }
    .docs-layout {
      gap: 0;
      padding: 40px 20px 100px;
    }
  }

  /* Global links */
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover {
    text-decoration: none;
  }

  /* Mobile technical-text floor: 12px minimum on a phone. */
  @media (max-width: 768px) {
    .arch-arrow-label { font-size: 12px; }
  }
</style>
