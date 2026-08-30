<script lang="ts">
  // /docs/rules: public catalog index of all alert rules, grouped
  // by category. Per CONTENT_TRANCHE_3 spec (2026-05-17), with the
  // 2026-05-20 moat-redaction pass that strips per-rule FIX content
  // from the public surfaces.
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();

  type RuleMeta = {
    id: string;
    title: string;
    summary: string;
    priority: "P1" | "P2" | "P3";
    _category: string;
  };
  const rules: RuleMeta[] = data.rules as unknown as RuleMeta[];

  // Group rules by _category preserving the order they appear in
  // the JSON (already sorted by CATEGORY_ORDER then alpha-by-id).
  type Group = { category: string; rules: RuleMeta[] };
  const groups: Group[] = [];
  for (const r of rules) {
    let g = groups.find((x) => x.category === r._category);
    if (!g) {
      g = { category: r._category, rules: [] };
      groups.push(g);
    }
    g.rules.push(r);
  }

  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Alert rules", item: "https://glassmkr.com/docs/rules" },
    ],
  });
</script>

<svelte:head>
  <title>Alert rules: Glassmkr documentation</title>
  <meta name="description" content="All {rules.length} Glassmkr alert rules grouped by category: storage, ZFS, filesystem, memory and CPU, network, hardware (BMC/IPMI), GPU, time and services, security and patching." />
  <link rel="canonical" href="https://glassmkr.com/docs/rules" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/docs/rules" />
  <meta property="og:title" content={`Glassmkr alert rules: ${rules.length} rules across 9 categories`} />
  <meta property="og:description" content="Per-rule documentation: title, summary, priority, category, quick-check command, verdict prior. Every rule ships with deep FIX content." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr alert rules" />
  <meta name="twitter:description" content={`${rules.length} alert rules across 9 categories. Per-rule docs with quick-check + verdict prior + FIX content.`} />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="rules-index">
  <header>
    <p class="eyebrow">DOCS / ALERT RULES</p>
    <h1>Alert rules</h1>
    <p class="lede">
      Glassmkr ships {rules.length} alert rules tuned for bare-metal infrastructure. Each rule has a title, summary, priority, and category here; per-alert remediation guidance (command to run, what to verify, rollback notes) is rendered inside the dashboard on the alert detail page.
    </p>
    <p class="machine">
      For AI agents: the machine-readable catalog is at <a href="/llms-full.txt"><code>/llms-full.txt</code></a>.
    </p>
  </header>

  {#each groups as g (g.category)}
    <section class="category">
      <h2>{g.category}</h2>
      <ul class="rule-list">
        {#each g.rules as r (r.id)}
            <li class="rule-row">
              <div class="rule-row-head">
                <a href="/docs/rules/{r.id}" class="rule-row-title">{r.title}</a>
                <code class="rule-id">{r.id}</code>
                <span class="priority priority-{r.priority.toLowerCase()}">{r.priority}</span>
              </div>
              <p class="rule-row-summary">{r.summary}</p>
            </li>
        {/each}
      </ul>
    </section>
  {/each}
</article>

<style>
  .rules-index {
    max-width: 1000px;
    margin: 0 auto;
    padding: 0 24px 80px;
  }
  header { padding: 64px 0 32px; }
  .eyebrow {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--accent);
    opacity: 0.75;
    margin: 0 0 18px;
  }
  h1 {
    font-size: clamp(32px, 4.6vw, 48px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.1;
    color: var(--text-primary);
    margin: 0 0 18px;
  }
  .lede {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 16px;
    max-width: 720px;
  }
  .machine {
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--text-tertiary);
    max-width: 720px;
  }
  .machine code {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    color: var(--accent);
    background: rgba(255, 107, 53, 0.06);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
  }
  .machine a {
    color: var(--text-secondary);
    text-decoration: underline;
  }

  .category {
    margin-top: 48px;
    padding-top: 28px;
    border-top: 1px solid var(--surface-border);
  }
  .category h2 {
    font-size: clamp(22px, 2.8vw, 26px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 20px;
  }
  /* Dense catalog, not a wall of cards. Seventy bordered boxes made the page a
     scroll exercise and gave every rule the same visual weight regardless of
     what it does. Rows put the title, id and priority on one scannable line with
     the summary beneath, which is how someone actually looks for a rule. */
  .rule-list { list-style: none; margin: 0; padding: 0; }
  .rule-row { padding: 14px 0; border-top: 1px solid var(--surface-border); }
  .rule-row:first-child { border-top: none; }
  .rule-row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
  .rule-row-title { font-weight: 600; color: var(--text-primary); text-decoration: none; }
  .rule-row-title:hover { color: var(--accent); }
  .rule-row-title:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .rule-row-summary {
    margin: 4px 0 0;
    color: var(--text-secondary);
    font-size: 0.95rem;
    max-width: 78ch;
  }

  .priority {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .priority-p0 { background: var(--red-bg); color: var(--g-critical); }
  .priority-p1 { background: var(--red-bg); color: var(--g-critical); }
  .priority-p2 { background: var(--yellow-bg); color: var(--g-warning); }
  .priority-p3 { background: var(--blue-bg); color: var(--g-info); }
  .priority-p4 { background: var(--g-surface-3); color: var(--g-text-subtle); }
  .rule-card h3 {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 4px;
    line-height: 1.35;
  }
  .rule-card p {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
  }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    code { font-size: 12px; }
  }
</style>
