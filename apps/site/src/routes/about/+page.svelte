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
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="About Glassmkr" />
  <meta name="twitter:description" content="Bare-metal monitoring built by one operator. {rules.length} alert rules, fully open source." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
</svelte:head>

<div class="container-narrow">
  <div class="page-header">
    <h1>About Glassmkr</h1>
    <p>Operational judgment for people who run servers but do not spend their lives operating them.</p>
  </div>

  <div class="divider"></div>

  <section>
    <h2>Who Glassmkr is for</h2>
    <p>Glassmkr is for people who are responsible for a Linux server without
       having a dedicated infrastructure team. You may be deploying an
       application, running a game or storage server, managing a small software
       business, or maintaining a homelab. You should not need ten years of
       bare-metal experience to know that a drive is deteriorating or a RAID
       array has lost redundancy.</p>
  </section>

  <section>
    <h2>What operating experience became product behavior</h2>
    <p>I built Glassmkr from ten years of operating bare metal: racks,
       switches, IPMI consoles, failed drives, bad memory, broken fans, and the
       pages that arrive at 3 AM. The product turns that experience into
       defaults, alert rules, evidence, and remediation workflows that other
       server owners can use without reproducing the same career first.</p>
    <p>General-purpose monitoring tools like Datadog and New Relic do not understand IPMI, SMART, or RAID. They are built for cloud workloads. Traditional tools like Nagios and Zabbix can monitor hardware, but they are heavy to deploy and require extensive configuration.</p>
    <p>I wanted something opinionated: {rules.length} alerts covering what actually breaks, with defaults rather than a configuration exercise. Setup is one command on Ubuntu or Debian and a few minutes by hand elsewhere; it needs an account key, and the agent needs root once to install before it runs as its own unprivileged user. In August 2026 I open-sourced the entire stack.</p>
  </section>

  <section>
    <h2>What one-person operation means in practice</h2>
    <p>Glassmkr is built and operated by one person. The hosted service runs
       on infrastructure I administer myself, monitored by the same agent and
       the same rules you get. When something pages, it pages me.</p>
    <p>That is also why the whole stack is open source: one-person operation
       is a real constraint, and your exit from it cannot depend on me. If the
       hosted service ever stops, the agent, the dashboard, and your data
       remain yours to run.</p>
    <figure class="fleet-artifact">
      <figcaption class="artifact-label">THE FLEET THE RULES ARE TUNED ON (2026-08-30)</figcaption>
      <div class="artifact-scroll" tabindex="0" role="region" aria-label="Operator fleet inventory">
        <table>
          <tbody>
            <tr><td class="mono">services</td><td>Supermicro SYS-530MT-H8TNR</td><td class="mono">ubuntu 24.04</td><td>runs the hosted dashboard</td></tr>
            <tr><td class="mono">glassmkr-gpu-1</td><td>Supermicro AS-3015MR-H8TNR</td><td class="mono">ubuntu 24.04</td><td>self-hosted AI inference (L4)</td></tr>
            <tr><td class="mono">webhoster</td><td>Supermicro Super Server</td><td class="mono">ubuntu 24.04</td><td>this site, among others</td></tr>
            <tr><td class="mono">val-rocky / val-debian / val-alma / val-ubuntu</td><td>4&times; Supermicro SYS-530MT-H8TNR</td><td class="mono">rocky 9.8 &middot; debian 12 &middot; alma 9.6 &middot; ubuntu 24.04</td><td>validation fleet: rules are exercised here before they ship</td></tr>
          </tbody>
        </table>
      </div>
    </figure>
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
            <h3>Built from operations, for more than operators</h3>
            <p>The rules come from professional infrastructure work. The product is for anyone responsible for keeping a server healthy.</p>
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
    <h2>Why the name and craft matter</h2>
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
    width: min(100%, var(--page-max));
    margin: 0 auto;
    padding: 0 var(--page-gutter);
  }
  /* Wide editorial opening (spec 16.1); body prose keeps its measure. */
  .container-narrow section p,
  .container-narrow section li {
    max-width: 76ch;
  }

  .page-header { padding: clamp(48px, 7vh, 80px) 0 40px; }
  .page-header h1 {
    font-size: clamp(2.4rem, 1.8rem + 2.6vw, 4rem);
    font-weight: 500;
    line-height: 1.04;
    letter-spacing: -0.025em;
    margin-bottom: 18px;
    color: var(--text-primary);
  }
  /* Operator artifact (review P1-4): a real inventory, mono where the data
     is machine-shaped. */
  .fleet-artifact { margin: 24px 0 0; border: 1px solid var(--g-border); border-radius: var(--g-radius-2); padding: 16px 18px; max-width: none; }
  .artifact-label { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin: 0 0 10px; }
  .artifact-scroll { overflow-x: auto; }
  .fleet-artifact table { width: 100%; border-collapse: collapse; min-width: 560px; }
  .fleet-artifact td { padding: 8px 18px 8px 0; border-bottom: 1px solid var(--g-border-subtle); font-size: 13px; color: var(--text-secondary); vertical-align: top; line-height: 1.5; }
  .fleet-artifact tr:last-child td { border-bottom: none; }
  .fleet-artifact .mono { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-primary); white-space: nowrap; }

  /* Principles as a wide editorial rhythm (review P1-4), not a narrow list. */
  @media (min-width: 1024px) {
    .principles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 48px; }
  }

  .page-header p {
    font-size: clamp(17px, 1.4vw, 20px);
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 34em;
    text-wrap: balance;
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
