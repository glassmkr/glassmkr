<script lang="ts">
  // /docs/rules/[id]: per-rule public catalog page. Renders only the
  // catalog metadata (id, title, summary, priority, category) and a
  // list of related rules in the same category.
  //
  // The FIX workflow content (per-distro variants, safe_mode,
  // validation, rollback, impact, provenance) is dashboard-internal
  // and is not rendered here per the 2026-05-20 moat-redaction
  // decision. Customers see the full remediation guidance after
  // signing in at https://app.glassmkr.com on the alert detail page.
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();

  type Rule = {
    id: string;
    priority: "P1" | "P2" | "P3";
    title: string;
    summary: string;
    _category: string;
  };
  const rule = data.rule as unknown as Rule;
  const related = data.related as { id: string; title: string }[];

  const techArticleLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: rule.title,
    description: rule.summary,
    author: { "@type": "Organization", name: "Glassmkr" },
    publisher: { "@type": "Organization", name: "Glassmkr" },
    about: { "@type": "SoftwareApplication", name: "Glassmkr", url: "https://glassmkr.com" },
    articleSection: rule._category,
    keywords: [rule.id, rule.priority, rule._category],
  });
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Alert rules", item: "https://glassmkr.com/docs/rules" },
      { "@type": "ListItem", position: 3, name: rule.title, item: `https://glassmkr.com/docs/rules/${rule.id}` },
    ],
  });
</script>

<svelte:head>
  <title>{rule.title}: {rule.id}: Glassmkr</title>
  <meta name="description" content={rule.summary} />
  <link rel="canonical" href="https://glassmkr.com/docs/rules/{rule.id}" />
  {@html `<script type="application/ld+json">${techArticleLd}</` + `script>`}
  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="rule-page">
  <header>
    <nav class="breadcrumb">
      <a href="/docs">Docs</a> / <a href="/docs/rules">Alert rules</a> / <span>{rule.id}</span>
    </nav>
    <div class="rule-meta">
      <code class="rule-id">{rule.id}</code>
      <span class="priority priority-{rule.priority.toLowerCase()}">{rule.priority}</span>
      <span class="category">{rule._category}</span>
    </div>
    <h1>{rule.title}</h1>
    <p class="lede">{rule.summary}</p>
  </header>

  <section class="remediation-pointer">
    <h2>Remediation</h2>
    <p>
      When this rule fires on one of your servers, the dashboard alert detail page renders the full remediation guidance: the command to run, what to verify after, and Furnace's annotation for your specific distro + hardware. Sign in at <a href="https://app.glassmkr.com">app.glassmkr.com</a> to see the live alert.
    </p>
  </section>

  {#if related.length > 0}
    <section class="related">
      <h2>Related rules in {rule._category}</h2>
      <ul>
        {#each related as r}
          <li><a href="/docs/rules/{r.id}"><code>{r.id}</code>: {r.title}</a></li>
        {/each}
      </ul>
    </section>
  {/if}

  <footer class="rule-footer">
    <p>
      Issue with this rule? Email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a> or open an issue at <a href="https://github.com/glassmkr/crucible/issues">github.com/glassmkr/crucible/issues</a>.
    </p>
  </footer>
</article>

<style>
  .rule-page {
    max-width: 880px;
    margin: 0 auto;
    padding: 0 24px 80px;
  }
  header { padding: 56px 0 32px; }
  .breadcrumb {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0 0 18px;
    font-family: var(--font-mono, monospace);
  }
  .breadcrumb a {
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .breadcrumb a:hover { color: var(--accent); }
  .breadcrumb span { color: var(--accent); }

  .rule-meta {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 0 0 18px;
    flex-wrap: wrap;
  }
  .rule-id {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--accent);
    background: rgba(255, 107, 53, 0.08);
    padding: 3px 8px;
    border-radius: var(--radius-md);
  }
  .priority {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 3px 7px;
    border-radius: var(--radius-sm);
  }
  .priority-p0 { background: var(--red-bg); color: var(--g-critical); }
  .priority-p1 { background: var(--red-bg); color: var(--g-critical); }
  .priority-p2 { background: var(--yellow-bg); color: var(--g-warning); }
  .priority-p3 { background: var(--blue-bg); color: var(--g-info); }
  .priority-p4 { background: var(--g-surface-3); color: var(--g-text-subtle); }
  .category {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 3px 8px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
  }

  h1 {
    font-size: clamp(28px, 4.2vw, 40px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 0 0 16px;
  }
  .lede {
    font-size: 16px;
    line-height: 1.65;
    color: var(--text-secondary);
    margin: 0;
  }

  section {
    padding: 32px 0;
    border-top: 1px solid var(--surface-border);
  }
  section h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 16px;
  }
  section p {
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }
  section p:last-child { margin-bottom: 0; }
  section ul {
    margin: 0;
    padding-left: 20px;
  }
  section li {
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  section :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    color: var(--accent);
  }
  section :global(a) {
    color: var(--text-secondary);
    text-decoration: underline;
  }
  section :global(a:hover) { color: var(--accent); }

  .related a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.12s;
    /* These are stacked list links, the main way to move between rule pages on
       a phone, and they were 18px tall. A standalone control needs 24.
       display:block so the whole row is the target, not just the words. */
    display: block;
    min-height: 24px;
    padding: 3px 0;
  }
  .related a:hover { color: var(--accent); }
  .related a code {
    color: var(--accent);
  }

  .rule-footer {
    margin: 56px 0 0;
    padding: 20px 0 0;
    border-top: 1px solid var(--surface-border);
    font-size: 13px;
    color: var(--text-tertiary);
    line-height: 1.65;
  }
  .rule-footer a {
    color: var(--text-secondary);
    text-decoration: underline;
  }
  .rule-footer a:hover { color: var(--accent); }

  /* Mobile technical-text floor: 12px minimum on a phone. */
  @media (max-width: 768px) {
    code { font-size: 12px; }
  }</style>
