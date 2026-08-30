<script lang="ts">
  import rules from "$lib/data/rules.json";
  import ProductGlyph from "$lib/components/ProductGlyph.svelte";
</script>

<svelte:head>
  <title>About - Glassmkr</title>
  <meta name="description" content="Bare-metal monitoring built by one operator with a decade of running the hardware it watches. Open source: AGPL-3.0-only end to end." />
  <link rel="canonical" href="https://glassmkr.com/about" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/about" />
  <meta property="og:title" content="About Glassmkr" />
  <meta property="og:description" content="Bare-metal monitoring built by one operator. {rules.length} alert rules, AGPL-3.0-only end to end." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="About Glassmkr" />
  <meta name="twitter:description" content="Bare-metal monitoring built by one operator. {rules.length} alert rules, fully open source." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />
</svelte:head>

<div class="container-narrow">
  <div class="page-header">
    <h1>About Glassmkr</h1>
    <p>Monitoring for bare metal, built and run by one operator.</p>
  </div>

  <div class="divider"></div>

  <section>
    <h2>Who we are</h2>
    <p>I have spent a decade operating bare metal: racks, switches, IPMI
        consoles, 3 AM pages about failing drives. I know what breaks and how it
        breaks, which is the only reason the alert rules are opinionated rather
        than generic.</p>
      <p>Glassmkr is built and operated by one person. The hosted service runs on
        infrastructure I administer myself.</p>
  </section>

  <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
  <section>
    <h2>Why we exist</h2>
    <p>General-purpose monitoring tools like Datadog and New Relic do not understand IPMI, SMART, or RAID. They are built for cloud workloads. Traditional tools like Nagios and Zabbix can monitor hardware, but they are heavy to deploy and require extensive configuration.</p>
    <p>I wanted something opinionated: {rules.length} alerts covering what actually breaks, with defaults rather than a configuration exercise. Setup is one command on Ubuntu or Debian and a few minutes by hand elsewhere; it needs an account key, and the agent needs root once to install before it runs as its own unprivileged user. In August 2026 I open-sourced the entire stack.</p>
  </section>

  <section>
    <h2>What it is</h2>
    <ul class="products-list">
      <li>
        <ProductGlyph name="crucible" size={44} />
        <div class="product-body">
          <div class="product-head"><strong><a href="https://github.com/glassmkr/crucible">Crucible</a></strong> <span class="product-tag">the agent</span></div>
          <p class="product-desc">Open-source monitoring agent for bare metal servers. {rules.length} opinionated alert rules covering IPMI, SMART, RAID, OS, and network. AGPL-3.0-only.</p>
        </div>
      </li>
      <li>
        <ProductGlyph name="dashboard" size={44} />
        <div class="product-body">
          <div class="product-head"><strong><a href="https://app.glassmkr.com">Dashboard</a></strong> <span class="product-tag">the dashboard</span></div>
          <p class="product-desc">Monitoring dashboard for bare metal fleets. Receives health data from Crucible, stores history, displays fleet health, sends alerts. Open source (AGPL-3.0-only) and free: hosted with a 10-node per-account cap, or self-hosted with no node limits.</p>
        </div>
      </li>
      <li>
        <ProductGlyph name="furnace" size={44} />
        <div class="product-body">
          <div class="product-head"><strong>Furnace</strong> <span class="product-tag">the AI assistant</span></div>
          <p class="product-desc">Our AI assistant for the alert-remediation workflow. Reads the alert and its evidence, suggests a fix, and hedges what it does not know. A value-add in the workflow, not a separate product.</p>
        </div>
      </li>
    </ul>
  </section>

  <section>
    <h2>How we think</h2>
      <ol class="principles">
        <li>
          <span class="principles-n">01</span>
          <div>
            <h3>Built from operations, not theory</h3>
            <p>Every alert, threshold, and diagnostic comes from real operational experience running bare metal.</p>
          </div>
        </li>
        <li>
          <span class="principles-n">02</span>
          <div>
            <h3>Encounter first, then build</h3>
            <p>Features come from problems I have actually hit. If I have not hit it, I do not build for it.</p>
          </div>
        </li>
        <li>
          <span class="principles-n">03</span>
          <div>
            <h3>Transparency by default</h3>
            <p>Open-source agent and dashboard. Public documentation. No black boxes in your monitoring stack.</p>
          </div>
        </li>
        <li>
          <span class="principles-n">04</span>
          <div>
            <h3>Craft over speed</h3>
            <p>Understanding a failure mode properly takes longer than shipping a threshold, and is the part that matters.</p>
          </div>
        </li>
        <li>
          <span class="principles-n">05</span>
          <div>
            <h3>For operators, by an operator</h3>
            <p>Hosting companies, MSPs, sysadmins, homelabs. I run the same infrastructure you do.</p>
          </div>
        </li>
        <li>
          <span class="principles-n">06</span>
          <div>
            <h3>Free and open, both layers</h3>
            <p>The agent and the dashboard are both open source. Run the hosted service, or run the same code on your own hardware.</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="name-section">
    <h2>The name</h2>
    <p>Glassmkr takes its name from the Bohemian glassmaking tradition: objects
        that are difficult to make and ordinary to use. That is the intended
        shape of this software too.</p>
  </section>

  <section>
    <h2>Contact</h2>
    <ul class="contact-list">
      <li>General: <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a></li>
      <li>Security: <a href="mailto:security@glassmkr.com">security@glassmkr.com</a></li>
      <li>Privacy: <a href="mailto:privacy@glassmkr.com">privacy@glassmkr.com</a></li>
      <li>Code: <a href="https://github.com/glassmkr">github.com/glassmkr</a></li>
    </ul>
  </section>
</div>

<style>
  .container-narrow {
    position: relative;
    z-index: 1;
    max-width: 780px;
    margin: 0 auto;
    padding: 0 24px;
  }

  .page-header { padding: 80px 0 48px; }
  .page-header h1 {
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin-bottom: 16px;
    color: var(--text-primary);
  }
  .page-header p {
    font-size: 16px;
    color: var(--text-secondary);
    max-width: 560px;
  }

  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 15%, rgba(168,200,255,0.08) 35%, rgba(255,255,255,0.06) 50%, rgba(255,200,140,0.05) 65%, rgba(255,255,255,0.03) 85%, transparent 100%);
    margin: 0 0 48px;
  }

  section { margin-bottom: 48px; }
  section h2 {
    font-size: clamp(20px, 2.2vw, 24px);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
    margin-bottom: 16px;
  }
  section p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: 12px;
    max-width: 640px;
  }
  section p:last-child { margin-bottom: 0; }

  .products-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .products-list li {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 18px 0;
    border-bottom: 1px solid var(--surface-border);
  }
  .products-list li:last-child { border-bottom: none; }
  .product-body { flex: 1; min-width: 0; }
  .product-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 15px;
    margin-bottom: 6px;
  }
  .product-tag {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  }
  .product-desc {
    margin: 0;
    max-width: 640px;
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .products-list :global(strong) { color: var(--text-primary); font-weight: 600; }
  .products-list :global(a) { color: var(--accent); text-decoration: none; }
  .products-list :global(a:hover) { text-decoration: underline; }
  /* An editorial list, not a 2x3 card grid. Boxes around six short statements
     is the values-grid pattern the taste pass called out; hairline separators
     and a hanging number carry the same structure without the containers. */
  .principles { list-style: none; margin: 24px 0 0; padding: 0; }
  .principles li {
    display: grid;
    grid-template-columns: 46px 1fr;
    gap: 4px 12px;
    padding: 18px 0;
    border-top: 1px solid var(--border-subtle);
  }
  .principles li:last-child { border-bottom: 1px solid var(--border-subtle); }
  .principles-n {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    padding-top: 3px;
  }
  .principles h3 { margin: 0 0 4px; font-size: 1rem; color: var(--text-primary); }
  .principles p { margin: 0; color: var(--text-secondary); line-height: 1.65; }


  .name-section :global(em) {
    font-style: normal;
    color: rgba(255, 107, 53, 0.9);
  }

  .contact-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .contact-list li {
    padding: 8px 0;
    font-size: 14px;
    color: var(--text-secondary);
  }
  .contact-list :global(a) { color: var(--accent); text-decoration: none; }
  .contact-list :global(a:hover) { text-decoration: underline; }
</style>
