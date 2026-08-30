<svelte:head>
  <title>We gave Claude Haiku root on a broken server - Glassmkr Blog</title>
  <meta name="description" content="We ran our standing validation exercise with Claude Haiku 4.5, the smallest model in the family, on a real bare-metal server with four firing alerts. It fixed what it should, declined to touch healthy hardware, and surfaced a false-positive bug in our own monitoring." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/haiku-blind-remediation" />
  <meta property="og:title" content="We gave Claude Haiku root on a broken server" />
  <meta property="og:description" content="The smallest model in the family, a real server, four firing alerts, and a read-only key that cannot be talked into a passing grade. What it fixed, what it correctly left alone, and the bug it found in us." />
  <meta property="og:image" content="https://glassmkr.com/og/haiku-blind-remediation.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="We gave Claude Haiku root on a broken server" />
  <meta name="twitter:description" content="The smallest model in the family fixed what it should on a real broken server, left healthy hardware alone, and surfaced a false positive in our own monitoring." />
  <meta name="twitter:image" content="https://glassmkr.com/og/haiku-blind-remediation.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/haiku-blind-remediation" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "We gave Claude Haiku root on a broken server",
    description: "A standing validation exercise: the smallest Claude model, a real bare-metal server with four firing alerts, SSH, the public docs, and a read-only key. What it fixed, what it correctly declined to touch, and the false-positive bug it found in our own monitoring.",
    image: "https://glassmkr.com/og/haiku-blind-remediation.png?v=20260830",
    datePublished: "2026-07-08",
    dateModified: "2026-07-08",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/haiku-blind-remediation.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/haiku-blind-remediation",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "We gave Claude Haiku root on a broken server", item: "https://glassmkr.com/blog/haiku-blind-remediation" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/haiku-blind-remediation.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title We gave Claude Haiku root on a broken server" width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">July 2026 · Engineering · 5 min read</p>
      <h1>We gave Claude Haiku root on a broken server</h1>
      <p class="lede">
        Every monitoring product says its alerts are "actionable." It is the easiest promise to make and the hardest to test, because the test usually turns on how much the person reading the alert already knows. We wanted a version that does not. So we made the reader as small as we could and handed it the keys.
      </p>
    </header>

    <h2>The setup</h2>
    <p>We run a standing validation exercise against our own product. The rules are deliberately unforgiving:</p>
    <ul>
      <li>A real bare-metal server. This round: an ASUS board, an EPYC 9754, Ubuntu. Real firing alerts, the live Crucible agent, the live dashboard. No staging theater.</li>
      <li>A fresh AI session with zero context about our company, our codebase, or our conventions. It gets exactly three things: SSH to the box, our public docs, and a Glassmkr API key.</li>
      <li>The API key is read-only. That is the detail that keeps the whole thing honest. The session cannot acknowledge or resolve anything through the API; it gets a 403 if it tries. The only way an alert clears is if the underlying condition on the server actually changes and our agent observes it on its next snapshot. The scoreboard cannot be talked into a passing grade by the thing being graded.</li>
      <li>The session works only from what the product tells it: the alert message, the attached evidence, the fix workflow. The moment it has to reach for outside knowledge, we have found a documentation gap worth fixing.</li>
    </ul>
    <p>
      We have run six of these rounds. The earlier ones used mid-size and large models (Sonnet, Opus). This round we used Claude Haiku 4.5, the smallest current model in the family, on purpose, running in a stock Claude Code session with native tools and no custom harness. A large model can quietly paper over a weak instruction with its own background knowledge. A small model mostly has only what you wrote down. If your guidance carries the smallest reader to the right answer, it will carry anyone.
    </p>

    <h2>The round</h2>
    <p>Four alerts were firing when the session connected:</p>
    <ul>
      <li><code>ssh_root_password</code> (warning): root login with a password was enabled.</li>
      <li><code>ipmi_sel_critical</code> (critical): power events logged in the BMC's system event log.</li>
      <li><code>ipmi_fan_failure</code> (critical): 2 of 9 fans reported failed.</li>
      <li><code>memory_channels_underpopulated</code> (warning): 8 of 12 memory channels populated, an advisory our agent derives from the board's SMBIOS DIMM topology.</li>
    </ul>
    <p>Working only from the product, Haiku:</p>
    <ul>
      <li><strong>Hardened SSH exactly per the fix workflow.</strong> It wrote the drop-in config, validated it with <code>sshd -t</code>, reloaded the daemon without dropping live sessions, verified the effective setting, and tested a fresh connection before trusting it. The alert auto-resolved on the next agent snapshot.</li>
      <li><strong>Read the system event log,</strong> recognized the power events as transient and already deasserted, and cleared the log per the workflow. Auto-resolved.</li>
      <li><strong>Checked the fans,</strong> found each one healthy, and declined to "fix" hardware that was working. (Hold that thought.)</li>
      <li><strong>Read the memory advisory,</strong> confirmed the DIMM population with <code>dmidecode</code>, and classified it correctly as an intentional capacity tradeoff to acknowledge, not a fault to repair. That alert is designed to stay open until a human acknowledges it, and it did.</li>
    </ul>

    <h2>The twist, because honesty is the point</h2>
    <p>
      Score at the end of the session: four alerts down to two. One of the two was the memory advisory, exactly where it belonged, waiting for a human. The other was the fan alert, and it would not clear no matter what Haiku did, because clearing it was never in Haiku's power. The bug was ours.
    </p>
    <p>
      Those two "failed" fans are discrete PSU sensors. They report a status string, not an RPM number. Our rule read the missing RPM as 0 RPM and counted the fan as stopped, even though the BMC itself reported the sensor as ok. The alert had been a false positive since the machine was onboarded, and no operator action on earth could have resolved it.
    </p>
    <p>
      We shipped the fix the same day. The BMC's own ok verdict now wins over a missing RPM reading, and the agent-side mirror of that logic is in the public Crucible repo (crucible PR #55). The phantom alert auto-resolved across the fleet within a snapshot cycle.
    </p>
    <p>
      Notice what did and did not happen, because it is the whole reason we trust the result. Haiku's judgment that the fans were healthy was correct. Its report that the fan alert was therefore resolved was wrong, because the alert was stuck on our bug, not on the fans. Right action, wrong conclusion about the outcome. We are not going to tell you the model was flawless; it was not. The honest version is more useful: the smallest model in the family followed our guidance to a correct action on everything it touched, and the exercise surfaced a real defect that no amount of internal review had caught.
    </p>

    <h2>What we believe after six rounds</h2>
    <ul>
      <li>Remediation guidance should be tested like code, against an oracle that cannot be sweet-talked. Read-only credentials are a one-line way to buy that property.</li>
      <li>Small models make better probes than large ones. If the documentation only works when the reader is brilliant, the documentation does not work.</li>
      <li>The valuable output is never the pass. It is the specific, fixable gap: the wrong binary name, the missing step, the false positive that survives for months because nobody stares at an alert they have already filed under "known."</li>
    </ul>
    <p>
      This was the small, careful end of a larger experiment. We also ran the same blind remediation across <a href="/blog/open-model-ladder-blind-remediation">a ladder of open-weight models</a>, from a 120B down to an 8B, and the results there were stranger and more instructive.
    </p>
    <p>
      If you want to see what Glassmkr surfaces on a real host, the <a href="https://app.glassmkr.com/demo">live demo</a> is open with no signup. The Crucible agent is open source on <a href="https://github.com/glassmkr/crucible">GitHub</a>. And for the fuller picture of how we test the product against itself, here is <a href="/blog/what-our-test-suite-looks-like">what our test suite looks like, and why</a>.
    </p>

    <footer class="post-footer">
      <p>Published July 8, 2026. By Simon Rybisar.</p>
      <p>
        <a href="/blog">&larr; All posts</a>
      </p>
    </footer>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
  .post {
    padding: 56px 0 80px;
  }
  .post-header {
    margin-bottom: 40px;
  }
  .post-meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 18px;
  }
  .post h1 {
    font-size: clamp(30px, 4.6vw, 44px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 0 0 20px;
  }
  .lede {
    font-size: clamp(16px, 1.8vw, 19px);
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .post h2 {
    font-size: clamp(22px, 2.4vw, 26px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 44px 0 18px;
    letter-spacing: -0.005em;
  }
  .post p {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 18px;
  }
  .post ul {
    margin: 0 0 18px;
    padding-left: 22px;
  }
  .post li {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 10px;
  }
  .post a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .post a:hover {
    border-bottom-color: var(--accent);
  }
  .post code {
    font-family: var(--font-mono, monospace);
    font-size: 14px;
    background: var(--surface-subtle);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    color: var(--text-primary);
  }
  .post pre {
    margin: 18px 0;
    padding: 16px 20px;
    background: var(--surface-subtle);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .post-footer {
    margin-top: 56px;
    padding-top: 28px;
    border-top: 1px solid var(--surface-border);
    font-size: 13.5px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }
  .post-footer p { font-size: 13.5px; line-height: 1.7; margin: 0 0 8px; }
</style>
