<script lang="ts">
  import productFacts from "$lib/data/product-facts.json";
  // Open source as a product pillar (design brief section 10): concrete
  // facts, not sentiment. The fact table is the section.
  const facts: [string, string][] = [
    ["Crucible", productFacts.crucibleLicense],
    ["Dashboard", productFacts.dashboardLicenseSpdx],
    ["API", "Open"],
    ["Alert rules", "Open"],
    ["Self-hosting", "Supported"],
    ["Cloud dependency", "None"],
    ["Telemetry lock-in", "None"],
  ];
  const links: [string, string][] = [
    ["Source", "https://github.com/glassmkr/crucible"],
    ["Install", "/docs/getting-started"],
    ["Docker / Compose", "/docs/self-hosting"],
    ["Deployment docs", "/docs/self-hosting"],
    ["Contributing", "https://github.com/glassmkr/crucible/blob/main/CONTRIBUTING.md"],
    ["Issues", "https://github.com/glassmkr/crucible/issues"],
  ];
</script>

<section class="oss" id="open-source">
  <div class="inner">
    <h2>Open source, end to end.</h2>
    <p class="lede">
      An agent with hardware-level reach belongs where your trust model lives:
      readable, patchable, self-hostable.
    </p>

    <div class="grid">
      <dl class="facts">
        {#each facts as [k, v] (k)}
          <div class="fact-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        {/each}
      </dl>

      <nav class="links" aria-label="Open source resources">
        {#each links as [label, href] (label)}
          <a {href}>{label} <span aria-hidden="true">&rarr;</span></a>
        {/each}
      </nav>
    </div>
  </div>
</section>

<style>
  .oss {
    padding: 72px 24px;
    border-top: 1px solid var(--border-subtle);
  }
  .inner { max-width: 1000px; margin: 0 auto; }

  h2 {
    font-size: clamp(24px, 3.2vw, 34px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 10px;
  }
  .lede {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 32px;
    max-width: 560px;
  }

  .grid {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 24px;
    align-items: start;
  }

  .facts {
    margin: 0;
    border: 1px solid var(--border-default);
    overflow: hidden;
  }
  .fact-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .fact-row:last-child { border-bottom: none; }
  .facts dt {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .facts dd {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-primary);
    margin: 0;
  }

  .links {
    display: flex;
    flex-direction: column;
    /* A list of links is not an object; the hairline between rows is
       enough structure without a box around the set. */
    border-top: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .links a {
    font-size: 14px;
    color: var(--text-primary);
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    justify-content: space-between;
    text-decoration: none;
  }
  .links a:last-child { border-bottom: none; }
  .links a:hover { color: var(--accent); }
  .links a span { color: var(--text-tertiary); }

  @media (max-width: 860px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
