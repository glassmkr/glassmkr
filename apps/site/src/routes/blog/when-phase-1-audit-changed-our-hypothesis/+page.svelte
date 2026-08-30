<svelte:head>
  <title>When a Phase 1 audit changed our hypothesis - Glassmkr Blog</title>
  <meta name="description" content="We had a bug on a validation server. The spec said the detection logic was wrong about a vendor. An hour-long audit said the detection logic was correct and three other things were wrong." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/when-phase-1-audit-changed-our-hypothesis" />
  <meta property="og:title" content="When a Phase 1 audit changed our hypothesis" />
  <meta property="og:description" content="An hour mapping the actual problem before writing any code saved us from fixing the wrong thing. The audit changed everything we were about to ship." />
  <meta property="og:image" content="https://glassmkr.com/og/when-phase-1-audit-changed-our-hypothesis.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="When a Phase 1 audit changed our hypothesis" />
  <meta name="twitter:description" content="The spec said the detection logic was wrong. An hour of audit said it was correct and three other things were broken. Map the problem before you code." />
  <meta name="twitter:image" content="https://glassmkr.com/og/when-phase-1-audit-changed-our-hypothesis.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/when-phase-1-audit-changed-our-hypothesis" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "When a Phase 1 audit changed our hypothesis",
    description: "We had a bug on a validation server. The spec said the detection logic was wrong about a vendor. An hour-long audit said the detection logic was correct and three other things were wrong.",
    image: "https://glassmkr.com/og/when-phase-1-audit-changed-our-hypothesis.png?v=20260830",
    datePublished: "2026-05-13",
    dateModified: "2026-05-13",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/when-phase-1-audit-changed-our-hypothesis.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/when-phase-1-audit-changed-our-hypothesis",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "When a Phase 1 audit changed our hypothesis", item: "https://glassmkr.com/blog/when-phase-1-audit-changed-our-hypothesis" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">May 2026 · Engineering · 6 min read</p>
      <h1>When a Phase 1 audit changed our hypothesis</h1>
      <p class="lede">
        A small story about how spending an hour mapping the actual problem before writing any code saved us from fixing the wrong thing.
      </p>
    </header>

    <p>
      We had a bug to fix. A server in our validation fleet was reporting "IPMI: Not detected" while simultaneously displaying ECC error counts on the same page. Two pieces of data on one screen, telling opposite stories about the same hardware.
    </p>

    <p>The obvious hypothesis: our detection logic is wrong for this vendor.</p>

    <p>
      We almost wrote that fix immediately. Then we ran a Phase 1 audit instead. The audit changed what we thought was wrong.
    </p>

    <h2>The contradicting screens</h2>

    <p>
      A user on our dashboard would have seen this on the server detail page for our ASUS RS700-E10-RS4U test box:
    </p>

    <pre><code>IPMI: Not detected

ECC Errors: Correctable: 0, Uncorrectable: 0</code></pre>

    <p>
      Two statements on one card. One says we cannot talk to the BMC. The other quotes numbers that, in the rest of the product, come from the BMC.
    </p>

    <p>
      A customer reading this would land in one of three places. They might assume the dashboard is broken in a small way and ignore both numbers. They might assume the monitoring layer is unreliable in general and reduce their trust in everything else we surface. Or they might assume we have a stub somewhere that emits "0, 0" by default and we never thought to ask whether the data was real. The third reading is the worst, because it is the correct one.
    </p>

    <p>We had a fix queued up. We were ready to start coding.</p>

    <h2>The wrong fix we almost shipped</h2>

    <p>
      The initial spec said the detection logic had a vendor-string allowlist somewhere, ASUS was not in the list, and the fix was to switch to capability-based detection. Vendor allowlists are a familiar bug shape on cross-vendor hardware code; we had hit similar shapes before. The story sounded right.
    </p>

    <p>
      It also fit the visible symptom: one specific vendor reports "Not detected", the others report fine, therefore the allowlist is at fault. The conclusion flowed naturally from the symptom.
    </p>

    <p>We almost wrote that fix immediately.</p>

    <p>
      Two things stopped us. One was a habit we had been building for a few months: before code on any non-trivial fix, do a Phase 1 audit. Map what is actually broken across all systems in the fleet, not just the one you noticed. The other was a small unease: if it really was a vendor allowlist, why had we not seen the issue earlier on the other vendors that should also be missing from the list?
    </p>

    <p>
      The audit was meant to take an hour. We expected it to confirm the hypothesis and validate the spec. We were going to ship the same afternoon.
    </p>

    <h2>What the audit found</h2>

    <p>The audit produced three findings, none of which matched the original hypothesis.</p>

    <p>
      <strong>Finding 1: there was no vendor allowlist.</strong> Detection was already capability-based. The code did three probes in order: stat <code>/dev/ipmi0</code>, run <code>ipmitool -V</code>, and if both succeeded, mark IPMI as available. No vendor strings were involved anywhere in the detection path. The hypothesis was wrong from the start. We would have spent a day refactoring a vendor allowlist that did not exist.
    </p>

    <p>
      <strong>Finding 2: the detection logic was actually correct.</strong> The box reporting "Not detected" had <code>ipmitool</code> simply not installed. The agent's detection chain found <code>/dev/ipmi0</code>, did not find <code>ipmitool</code>, and recorded <code>detection.reason: "no_ipmitool_binary"</code>. That is honest behavior. The bug was downstream. Our collection path emitted stub <code>ecc_errors: &lbrace; correctable: 0, uncorrectable: 0 &rbrace;</code> whenever detection failed, and our dashboard rendered those stubs as if they were real measurements. The two contradicting screens were not a detection bug; they were a rendering layer trusting zeros that were never measurements.
    </p>

    <p>
      <strong>Finding 3: detection ran once at startup and cached forever.</strong> A customer who installed <code>ipmitool</code> after Crucible started would see no change until they restarted the agent. This is the exact shape of a real incident we had hit weeks earlier on a different box, where a missing package was fixed in five minutes but the dashboard kept lying for a day because nobody thought to restart the daemon.
    </p>

    <p>
      So the actual bug was not "detection is wrong about ASUS." It was three problems stacked together: collection emits fake data when detection fails, rendering treats fake data as real, and detection never re-checks. Three different fixes, none of them what the original spec said.
    </p>

    <p>
      If we had shipped the original spec, we would have refactored a non-existent vendor allowlist and missed all three real problems.
    </p>

    <h2>What we shipped</h2>

    <p>Four fixes, all in roughly a day:</p>

    <ol class="post-list">
      <li><strong>Stop emitting stub zeros.</strong> When detection fails, the agent now emits <code>null</code> for ECC counters and SEL entry counts. The Dashboard's snapshot schema was updated to accept both the new <code>null</code> shape and the legacy stub-zero shape, so older agents on the rollback path keep working during the upgrade window.</li>
      <li><strong>Render <code>null</code> as "no signal".</strong> The dashboard now distinguishes "the BMC said zero" from "we could not ask the BMC". The ECC block displays <code>no signal (BMC not probed)</code> instead of <code>0 / 0</code> when the agent could not probe.</li>
      <li><strong>Surface the detection reason.</strong> Crucible already emitted a structured <code>detection.reason</code> field with four possible values (<code>no_ipmitool_binary</code>, <code>permission_denied</code>, <code>no_bmc_device</code>, <code>execution_failed</code>). The Dashboard now reads it and appends a one-line, human-readable explanation next to "IPMI: Not detected" on the header. A user looking at the box now sees: "IPMI: Not detected (ipmitool not installed)." That is enough information to fix the problem in one minute, no support ticket.</li>
      <li><strong>Re-detect every hour.</strong> Detection is no longer cached forever. Customers who install <code>ipmitool</code> after the agent started do not need to restart anything; the next hourly re-check picks up the change and the dashboard flips on the following ingest.</li>
    </ol>

    <p>
      Plus a new self-diagnosis subcommand: <code>glassmkr-crucible doctor ipmi</code> runs the same probes the agent uses internally and prints actionable guidance per failure mode. For <code>no_ipmitool_binary</code> it gives the per-distro install command. For <code>permission_denied</code> it points at the systemd unit's <code>User=</code> directive. For <code>no_bmc_device</code> it suggests <code>modprobe ipmi_si ipmi_devintf</code> or accepting that this host has no BMC. For <code>execution_failed</code> it gives a one-liner reproducer and a deliberate warning against <code>mc reset cold</code> on a remote machine without vendor confirmation.
    </p>

    <p>
      Total work, including the audit hour: about a day. If we had shipped the original spec, we would have spent the same day building something irrelevant to the actual bug.
    </p>

    <h2>Why Phase 1 audits are worth the hour</h2>

    <p>
      When a bug has more than one possible explanation, the cheapest move is to enumerate the explanations and check which is true before writing code. An hour of audit can save a week of building the wrong thing.
    </p>

    <p>The audit format that worked for us:</p>

    <ul class="post-list">
      <li>For each candidate explanation, decide what data would prove or disprove it.</li>
      <li>Run the data collection on the real systems, not just the one that surfaced the symptom.</li>
      <li>Compare the findings against the hypothesis explicitly. Write down the comparison.</li>
      <li>If the data contradicts the hypothesis, update the spec before writing code.</li>
    </ul>

    <p>
      The audit will sometimes confirm the original hypothesis. That is fine. An hour to validate a spec is cheap insurance, and you go into the implementation with a sharper picture of the edges.
    </p>

    <p>
      But sometimes the audit changes the diagnosis entirely, like ours did. That is when the hour pays for itself many times over. We saved a day of refactor, surfaced two bugs we did not know we had, and shipped something the customer can actually use.
    </p>

    <p>
      The lesson is not "be slower." The lesson is "be honest about which step is hypothesis and which step is verified." Code written from a verified diagnosis is faster to write and likelier to be correct. Code written from an unverified diagnosis is often the most expensive kind of code: the kind that ships, looks fine in review, and does not solve the problem.
    </p>

    <p>
      The audit also surfaced a PSU monitoring bug across our entire fleet that we had silently for months. That is a separate story.
    </p>

    <footer class="post-footer">
      <p>Published May 13, 2026. By Simon Rybisar.</p>
      <p>
        <a href="/blog">&larr; All posts</a>
      </p>
    </footer>
  </article>
</div>

<style>
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
  .post-list {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 18px;
    padding-left: 22px;
  }
  .post-list li {
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
