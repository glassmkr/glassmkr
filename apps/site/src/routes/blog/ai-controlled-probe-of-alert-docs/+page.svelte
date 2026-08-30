<svelte:head>
  <title>We used an AI as a controlled probe of our alert documentation - Glassmkr Blog</title>
  <meta name="description" content="We forbade an AI from using its training data and made it resolve real infrastructure alerts using only the guidance our own dashboard produces. Three gaps surfaced. All three fixed in the same week." />
  <meta name="keywords" content="alert design, customer self-service, monitoring docs, AI probe, SMART, IPMI SEL, systemd, bare metal monitoring, Glassmkr" />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/ai-controlled-probe-of-alert-docs" />
  <meta property="og:title" content="We used an AI as a controlled probe of our alert documentation" />
  <meta property="og:description" content="We forbade an AI from using its training data and made it resolve real infrastructure alerts using only the guidance our own dashboard produces. Three gaps surfaced. All three fixed in the same week." />
  <meta property="og:image" content="https://glassmkr.com/og/ai-controlled-probe-of-alert-docs.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Terminal: glassmkr probe --constraint dashboard-docs-only --fleet validation. A table of alert rules and gap patterns, with smart_failing highlighted as a hidden discriminator." />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="We used an AI as a controlled probe of our alert documentation" />
  <meta name="twitter:description" content="We forbade an AI from using its training data and made it resolve real infrastructure alerts using only our own dashboard's guidance. Three gap patterns, all fixed the same week." />
  <meta name="twitter:image" content="https://glassmkr.com/og/ai-controlled-probe-of-alert-docs.png?v=20260830" />
  <meta name="twitter:image:alt" content="Terminal probe output highlighting three alert-docs gap patterns surfaced by a constrained AI run" />
  <link rel="canonical" href="https://glassmkr.com/blog/ai-controlled-probe-of-alert-docs" />

  <!-- Structured data: Article + BreadcrumbList. Emitted via {@html}
       so Svelte doesn't HTML-escape the JSON payload. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "We used an AI as a controlled probe of our alert documentation",
    description: "We forbade an AI from using its training data and made it resolve real infrastructure alerts using only the guidance our own dashboard produces. Three gap patterns surfaced. All three fixed in the same week.",
    image: "https://glassmkr.com/og/ai-controlled-probe-of-alert-docs.png?v=20260830",
    datePublished: "2026-05-13",
    dateModified: "2026-05-13",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/ai-controlled-probe-of-alert-docs.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/ai-controlled-probe-of-alert-docs",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "AI-controlled probe of alert docs", item: "https://glassmkr.com/blog/ai-controlled-probe-of-alert-docs" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/ai-controlled-probe-of-alert-docs.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title We used an AI as a controlled probe of our alert documentation" width="1200" height="630" loading="eager" decoding="async" />
    <p class="post-meta">May 2026 · Engineering</p>

    <h1>We used an AI as a controlled probe of our alert documentation</h1>

    <p>We run a small fleet of bare metal servers to validate Glassmkr against real hardware diversity. Seven boxes across four vendors, three operating system families, and a range of generations from 2017 to 2024. The fleet does what fleets do over time: it accumulates alerts.</p>

    <p>Last week we had 35 active alerts firing on the dashboard. Most were the kind of routine drift that a small operator would address in an afternoon: kernel updates pending, security patches available, automatic updates not configured. The dashboard had been telling us what to do for weeks. We had been doing nothing.</p>

    <p>We decided to do something useful with the backlog. Instead of fixing the alerts ourselves, we ran an experiment: have a coding agent attempt to fix every alert, but with one critical constraint.</p>

    <h2>The constraint</h2>

    <p>The agent could use:</p>

    <ul>
      <li>Each alert rule's section in our <code>/docs/alerts</code> page</li>
      <li>The <code>fix_commands</code> field returned in the alert's evidence JSON</li>
      <li>Any text linked from our own docs</li>
      <li>The journal output the alert pointed at</li>
    </ul>

    <p>It could not use:</p>

    <ul>
      <li>General Linux administration knowledge from its training data</li>
      <li>Web search for vendor documentation outside what we linked to</li>
      <li>Common-sense ops moves not suggested by us</li>
    </ul>

    <p>The point of the constraint is to test our documentation, not the model's ability. Without the constraint, the agent would solve everything by reaching for its training data, and we would learn nothing about our docs. With the constraint, every gap in our guidance becomes visible. The agent either resolves the alert using only what we said, or it does not.</p>

    <p>We ran this against nine boxes producing 35 active alerts. After deduplicating by rule type, that came to 10 distinct rule types covering kernel updates, firewall configuration, SSH hardening, security patches, automatic updates, systemd service failures, IPMI SEL events, interface errors, SMART failures, and kernel vulnerabilities.</p>

    <h2>What we found</h2>

    <p>Most rules were fine. The agent attempted resolution on three of the riskiest types (where applying the fix had real consequences) and reviewed the others for guidance quality. Four of the ten rule types had no actionable gap. Three were trivially resolvable through Dashboard's documented commands. The remaining three had specific, fixable gaps in either the evidence shape or the documentation.</p>

    <p>These three are worth describing in detail because each represents a different failure mode.</p>

    <h3>Pattern 1: the alert and the evidence disagreed</h3>

    <p>On one box, <code>smart_failing</code> was firing with severity critical. The agent read the evidence and found <code>health: "PASSED"</code>. From a customer's view, the alert said the drive was failing while the evidence said it had passed its health check. There was no third field explaining the contradiction.</p>

    <p>The rule actually fires on multiple independent SMART thresholds: reallocated sector count above a vendor threshold, pending sector count growth, offline uncorrectable count. Any one of these can fire the rule. The evidence shape simply did not name which condition had fired.</p>

    <p>The fix was a one-line evaluator change: emit a <code>triggering_signals</code> array that explicitly names every condition that tripped. On the same box after the fix, the alert displayed clearly:</p>

<pre><code>"triggering_signals": [
  &#123; "attribute": "reallocated_sectors", "observed": 1, "expected": 0 &#125;
]</code></pre>

    <p>One sector remapped on the Crucial MX300. Real signal, low severity, immediately legible.</p>

    <h3>Pattern 2: the alert fired on history</h3>

    <p>On our production services-1 host, <code>ipmi_sel_critical</code> was firing on Power Supply AC events from November 2024. The events were paired Asserted/Deasserted entries, meaning the BMC itself had observed the supply drop and recover. By May 2026, the supplies had been operating cleanly for fifteen months. The alert had been firing throughout.</p>

    <p>The rule had no time-window mechanism. Once a critical event entered the System Event Log, the rule fired forever, even on year-old transients. The evidence did not expose event timestamps, so a customer reading the dashboard had no way to know whether the incident was current or ancient without dropping to shell.</p>

    <p>The fix was twofold. Add timestamps to each event in the <code>critical_events[]</code> evidence array. Add a configurable time window to the rule itself, default 30 days, with per-server overrides for noisy hosts. After the fix shipped, the services-1 alert auto-resolved at the next ingest cycle: the year-old events fell outside the new window. No customer action needed.</p>

    <h3>Pattern 3: the alert pointed at the problem but not the fix</h3>

    <p>On a third box, <code>systemd_service_failed</code> was firing on fail2ban. The agent followed our four-step guidance: check status, read the journal, attempt restart, check status again. The first three steps worked. The journal showed the actual problem: <code>Have not found any log file for sshd jail</code>. The fourth step (restart) failed because the underlying config issue was unchanged.</p>

    <p>Our docs ended at this point with the suggestion to "check configuration and dependencies." That is exactly where customer self-service breaks. The journal told the truth. We needed to bridge from the journal output to a fix.</p>

    <p>The fix was operational, not documentary: we changed Crucible to include the last few journal lines from the failing unit directly in the alert evidence. Customers no longer need to SSH to see what failed. The alert evidence on that box now displays the <code>Have not found any log file for sshd jail</code> error verbatim. The bridge to a fix is shorter.</p>

    <h2>The cross-cutting finding</h2>

    <p>The three gaps look different, but they share a shape: in each case, the evidence the rule already had access to was richer than the evidence the customer saw. The fix in all three cases was to surface more of what we already knew.</p>

    <p>This is the consistent gap pattern. Our <code>/docs/alerts</code> pages tell customers in general terms what an alert means. The evidence JSON tells them, specifically, what the rule observed. The two were diverging. Customers reading the alert evidence in our dashboard got better guidance than customers reading our docs page.</p>

    <p>We also noticed a softer version of the same pattern in the rules where the agent successfully resolved alerts. For <code>interface_errors</code>, our <code>fix_commands</code> field includes a firewall-vs-NIC disambiguation check that our <code>/docs/alerts</code> page does not mention. For <code>ssh_root_password</code>, our <code>fix_commands</code> field includes a key-access verification probe that our docs page does not mention. The richer guidance was hiding in the alert payload itself.</p>

    <h2>What we shipped</h2>

    <p>Within the same week we shipped three evaluator changes and a documentation audit. The evidence shape improvements landed first because they are higher leverage: every customer reading any alert benefits immediately. The docs audit pass landed second to close the parity gap between <code>/docs/alerts</code> and <code>fix_commands</code>.</p>

    <p>We did not add an "Actionable steps" section to each rule because <code>fix_commands</code> already serves that purpose. The bug was that <code>/docs/alerts</code> did not reflect it.</p>

    <h2>The methodology, separately</h2>

    <p>The constraint that made this experiment work is worth pulling out. Without it, the experiment would have measured an LLM's general Linux competence, which is not interesting because the answer is "high enough for most things." With it, the experiment measured whether our own guidance is complete enough for self-service, which is exactly the question that matters for customers.</p>

    <p>Anyone running a similar exercise on their own infrastructure should adopt the same constraint. Forbid the agent from using its training data on the domain. Force it to use only your product's documented guidance. Each failure point is a gap that real customers will also hit. The advantage of running it through an AI is speed: the experiment took about an hour of wall-clock time. The advantage of using your own product is honesty: every gap surfaced is a real one.</p>

    <p>One note on tooling: we used an external coding agent (Claude Code) for this experiment because forbidding training-data use is cleaner to enforce against an external agent than against our own production deployment. The experiment ran on our validation fleet, not against any customer infrastructure. Customer telemetry from Glassmkr accounts continues to be analyzed by our Gemma 4 26B running on a dedicated L4 GPU in Amsterdam, and never leaves the Glassmkr stack.</p>

    <p>We are doing this again in a month. The list of remaining work has not gone empty.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Dashboard Free &rarr;</a>
    </div>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
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
  h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 28px 0 12px;
  }

  p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
  }

  a { color: var(--accent); }

  ul {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
    padding-left: 24px;
  }
  ul li { margin-bottom: 6px; }

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
    padding: 14px 16px;
    overflow-x: auto;
    margin: 8px 0 20px;
  }
  pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre;
  }

  .post-footer {
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid var(--surface-border);
    text-align: center;
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
</style>
