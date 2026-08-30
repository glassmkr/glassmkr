<svelte:head>
  <title>Introducing Glassmkr: bare metal monitoring built by operators - Glassmkr Blog</title>
  <meta name="description" content="The original Glassmkr launch post (May 2026): Crucible, the open-source agent, plus Dashboard. The pricing and plans it describes were retired in August 2026 when the whole stack went open source." />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/introducing-glassmkr" />
  <meta property="og:title" content="Introducing Glassmkr: bare metal monitoring built by operators" />
  <meta property="og:description" content="The original launch post (May 2026). The pricing and plans it describes were retired in August 2026 when the whole stack went open source." />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Glassmkr: bare metal monitoring built by operators. Terminal preview: crucible fleet --status showing 3 servers, 68 rules across 9 categories evaluated, all healthy." />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Introducing Glassmkr: bare metal monitoring built by operators" />
  <meta name="twitter:description" content="The original launch post (May 2026). The plans it describes were retired when the stack went open source in August 2026." />
  <meta name="twitter:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />
  <meta name="twitter:image:alt" content="Glassmkr: bare metal monitoring built by operators" />
  <link rel="canonical" href="https://glassmkr.com/blog/introducing-glassmkr" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Introducing Glassmkr: bare metal monitoring built by operators",
    description: "The original Glassmkr launch post (May 2026). The pricing and plans it describes were retired in August 2026 when the whole stack went open source.",
    image: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826",
    datePublished: "2026-04-21",
    dateModified: "2026-04-21",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/introducing-glassmkr",
    articleSection: "Launch"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Introducing Glassmkr", item: "https://glassmkr.com/blog/introducing-glassmkr" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <p class="post-meta">April 2026 · Launch</p>

    <h1>Introducing Glassmkr: bare metal monitoring built by operators</h1>

    <aside class="editorial-note">
      <strong>Update (August 2026):</strong> Glassmkr is now fully open source and free, both self-hosted and hosted. Pricing described below is historical. See <a href="/blog">/blog</a> for the announcement.
    </aside>

    <p>You rented a dedicated server because you wanted control. What you got instead is a machine that only tells you it's alive by answering ping. The drive is accumulating reallocated sectors. A fan slowed down last week. The RAID array lost a member yesterday and the rebuild is stressing the surviving disks right now. Your hosting provider doesn't know. Nagios didn't ship with a rule for it. Datadog costs more than the server.</p>

    <p>This is the gap Glassmkr fills.</p>

    <h2>What Glassmkr is</h2>

    <p>Glassmkr is monitoring for people who run their own hardware. One philosophy: collect what actually breaks physical servers, alert on the priorities that matter, and don't pretend the solution is a cloud APM that was never designed for this workload.</p>

    <p>It is shipped as two pieces that work together or standalone.</p>

    <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
    <p><strong>Crucible</strong> is the open-source collector. One <code>curl | bash</code> install. Reads from <code>smartctl</code>, <code>ipmitool</code>, <code>mdadm</code>, <code>/proc</code>, <code>/sys</code>. Pushes a complete health snapshot every 60 seconds. Median 91 MB RSS (range 65 to 103 MB across our 7-host validation fleet), measured at v0.13.3. No kernel modules, no eBPF, no root hooks into your application stack. Available on npm. MIT licensed. Run it standalone (pipe the output wherever you want) or pair it with Dashboard. (Note: a follow-up measurement against the 0.13.6 fleet showed the figure has drifted to around 108 MB; current footprint numbers live on the <a href="/docs">docs page</a>.)</p>

    <p><strong>Dashboard</strong> is the optional SaaS. It receives Crucible's snapshots, stores history, renders fleet views, and sends alerts. 68 opinionated alert rules across 9 categories: storage, ZFS, filesystem, memory and CPU, network, hardware and BMC, time and services, security and patching, and GPU. Furnace, our self-hosted Gemma 4 inference on an NVIDIA L4 in Amsterdam, surfaces a verdict prior (recoverable, investigation, or vendor-side) on every alert. This is Integration 1, shipped 2026-05-20; per-snapshot LLM narration ships in Integration 2 after 2 to 4 weeks of priors-only usage data. $3/node/month with the first 3 nodes free; if 3 servers is your whole fleet, the agent stays free forever.</p>

    <h2>Where this came from</h2>

    <p>Glassmkr is built and maintained by one operator in Prague. The day job is a decade of running bare metal infrastructure at scale on multiple continents. Every alert, every threshold, every diagnostic in the product comes from real operational experience. The 68 alert rules are not theoretical coverage. They are the things that have woken me up. The IPMI parsing handles vendor quirks because I have hit them. The RAID degradation detection fires on member loss rather than performance because that is the one you actually care about at 3 AM.</p>

    <p>Where a parser hasn't been validated against a vendor in production, we say so. Crucible v0.13.3 emits a <code>parser_quality</code> field on every collector (<code>full</code>, <code>partial</code>, or <code>stub</code>); Dashboard surfaces stubs as a soft "not yet observed on this hardware" rather than dressing them up as production-ready. Honest gaps beat fake confidence.</p>

    <p>I built Glassmkr over the first four months of 2026. Every feature decision, every rule priority, every dashboard layout was driven by production pain on my own infrastructure. I do not build features I have not encountered. Opinionated coverage beats configurable generality when the goal is catching real problems before they become outages.</p>

    <h2>The architecture</h2>

    <p>Your server runs Crucible as a systemd service. Every 60 seconds it gathers SMART attributes for every drive, IPMI sensor readings, RAID array state, per-core CPU (not just aggregate, the per-core breakdown that catches IRQ pinning and single-threaded saturation), memory and swap, network interface stats, filesystem state, security posture, and pending updates. It pushes this snapshot over HTTPS to Dashboard.</p>

    <p>Dashboard evaluates the 68 alert rules against the snapshot, compares it to history, and either fires new alerts or closes resolved ones. Each alert is assigned a priority level: P1 for data loss imminent, P2 for service-impacting, P3 for degrading, P4 for informational. Alert cards include evidence links, diagnostic commands, and recent trend data. Notifications go to Slack, Telegram, or email.</p>

    <p>Furnace runs on our own NVIDIA L4 in Amsterdam, serving Gemma 4 26B-A4B over a private WireGuard network. Your server's data never touches a third-party API. We have written separately about <a href="/blog/gemma-4-l4-gpu-server-analysis">why we self-host the model and how we chose it</a>; the short version is that sending IPMI sensor data and hardware serials to an external cloud to analyze whether your infrastructure is healthy is ironic.</p>

    <h2>How it was built</h2>

    <p>Glassmkr was built with heavy use of AI coding tools, primarily Claude Code. Every architectural decision, every alert threshold, every dashboard layout was made by me. The AI did the typing. I did the deciding.</p>

    <p>Two rounds of security audit were run before launch (see <a href="/trust">/trust</a> for details). The Crucible source is MIT licensed and short enough to read in an afternoon, which is the point. If you are skeptical of AI-assisted code in your monitoring stack, audit it. That is why it is open.</p>

    <h2>Pricing</h2>

    <p>The agent (Crucible) is MIT licensed and free. Always.</p>

    <p>Dashboard Free covers up to 3 servers, all 68 alert rules, 7-day history, and all notification channels. If that is enough for your setup, you are done.</p>

    <p>Dashboard Pro is $3/node/month with the first 3 nodes free. You get longer history, the AI health analysis, more notification routing options, and priority support. There is no per-metric surcharge, no alert-volume tiering, and no cloud-scale pricing math. You pay for the nodes you have, minus the first three.</p>

    <h2>Start</h2>

    <p>Install Crucible on a server:</p>

    <pre><code>curl -sf https://glassmkr.com/install.sh | bash</code></pre>

    <p>The install script registers the server with Dashboard, sets up the systemd service, and begins collecting data within a few minutes. Browse to <a href="https://app.glassmkr.com">app.glassmkr.com</a> to see your fleet.</p>

    <p>If you just want the agent and not the SaaS, Crucible is on <a href="https://github.com/glassmkr/crucible">GitHub</a> and <a href="https://www.npmjs.com/package/@glassmkr/crucible">npm</a>. Pipe its output wherever you want it.</p>

    <h2>What we are not</h2>

    <p>We are not a Datadog replacement for cloud workloads. If your infrastructure is Kubernetes on EKS, use something else.</p>

    <p>We are not a SaaS that hides the collector in a proprietary binary. Read the Crucible source. Audit exactly what leaves your server.</p>

    <p>We are not trying to be everything. No application performance monitoring, no distributed tracing, no log aggregation. Glassmkr does hardware and OS health. It does not pretend to be observability.</p>

    <p>We are not a black-box SaaS you cannot escape. Crucible is MIT and works standalone without Dashboard. If Glassmkr ever shuts down, your agent and your data stay yours.</p>

    <h2>What is shipped recently, what is next</h2>

    <p>Shipped since launch: GPU monitoring (9 rules covering XID errors, ECC counters, PCIe link state, thermal trip, power-cap throttling, NVLink, driver and vbios drift, and reboot survival; validated on NVIDIA L4, RTX A4000, and A16). Trend-based alerting (the largest in-flight feature when this post first went out): statistical detection of reallocated-sector growth, fan-speed drift, and disk-fill projection, all shipped. Cross-snapshot correlation: shipped. Furnace Integration 1 (verdict prior badges on every alert): shipped 2026-05-20.</p>

    <p>Near-term: Furnace Integration 2 brings per-snapshot LLM narration on Pro tier, after 2 to 4 weeks of priors-only usage data. Deeper NVMe controller telemetry and hardware RAID support beyond mdadm (LSI MegaCLI, HP SSACLI, Dell PERC) are in flight.</p>

    <p>Every addition follows the same rule: only ship alerts for failure modes we have actually encountered in production.</p>

    <h2>For operators, by operators</h2>

    <p>Glassmkr exists because the monitoring tools that worked for cloud-native teams did not work for us. We built what we needed. If you run bare metal and recognize the description above, try it. The Free tier is genuinely free. The paid tier is priced to be affordable at any fleet size.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Dashboard Free &rarr;</a>
      <a href="https://github.com/glassmkr/crucible" class="btn-page btn-outline">Read the Crucible source &rarr;</a>
    </div>
  </article>
</div>

<style>
  .container-narrow {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px 80px;
    position: relative;
    z-index: 1;
  }

  article { padding-top: 40px; }
  .post-meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 18px;
  }

  .editorial-note {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-left: 3px solid rgba(255, 107, 53, 0.5);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    margin: 0 0 28px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-tertiary);
  }
  .editorial-note strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .editorial-note a {
    color: var(--accent);
    text-decoration: none;
  }

  h1 {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 32px;
  }
  h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 40px 0 16px;
  }

  p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
  }

  a { color: var(--accent); }

  code {
    font-size: 13px;
    background: var(--surface-raised);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    font-family: 'SF Mono', SFMono-Regular, 'Fira Code', Consolas, 'Courier New', monospace;
  }
  pre {
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
    overflow-x: auto;
    margin-bottom: 16px;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
  }

  .post-footer {
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid var(--surface-border);
    text-align: center;
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .btn-page {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 22px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  }
  .btn-amber {
    background: rgba(255, 107, 53, 0.12);
    border: 1px solid rgba(255, 107, 53, 0.25);
    color: var(--accent);
  }
  .btn-amber:hover {
    background: rgba(255, 107, 53, 0.18);
    border-color: rgba(255, 107, 53, 0.35);
    text-decoration: none;
  }
  .btn-outline {
    background: transparent;
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);
  }
  .btn-outline:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
    text-decoration: none;
  }
</style>
