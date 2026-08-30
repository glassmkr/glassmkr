<svelte:head>
  <title>When your monitoring tool punishes customers for doing the right thing - Glassmkr Blog</title>
  <meta name="description" content="A week after running an experiment on our own alert docs, we ran a follow-up: actually fixing every alert on the validation fleet. Two distinct bugs surfaced that the first experiment missed. Both punished customers for doing exactly what we told them to do." />
  <meta name="keywords" content="monitoring feedback loop, alert latency, ufw stale alert, kernel reboot alert, customer trust, agent caching, Glassmkr" />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/when-monitoring-punishes-customers" />
  <meta property="og:title" content="When your monitoring tool punishes customers for doing the right thing" />
  <meta property="og:description" content="60 minutes of stale alerts after a legitimate fix. A kernel reboot that fired its own critical alert. Two distinct bugs surfaced when we actually applied our own remediation guidance end to end on the validation fleet." />
  <meta property="og:image" content="https://glassmkr.com/og/when-monitoring-punishes-customers.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Timeline showing pre-fix latency of 60 minutes between customer enabling ufw and the no_firewall alert clearing, versus post-fix latency of 5 minutes" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="When your monitoring tool punishes customers for doing the right thing" />
  <meta name="twitter:description" content="60 minutes of stale alerts after a legitimate fix, plus a kernel reboot that fired its own critical alert. Two bugs surfaced when we actually applied our own remediation guidance end to end." />
  <meta name="twitter:image" content="https://glassmkr.com/og/when-monitoring-punishes-customers.png?v=20260830" />
  <meta name="twitter:image:alt" content="Timeline of a stale no_firewall alert: customer enables ufw at 21:35, dashboard still shows the alert through 21:45, finally clears at 21:54. Post-fix the latency is 5 minutes." />
  <link rel="canonical" href="https://glassmkr.com/blog/when-monitoring-punishes-customers" />

  <!-- Structured data: Article + BreadcrumbList. Emitted via {@html}
       so Svelte doesn't HTML-escape the JSON payload. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "When your monitoring tool punishes customers for doing the right thing",
    description: "A week after running an experiment on our own alert documentation, we ran a follow-up: actually fixing every alert on the validation fleet. Two distinct bugs in our monitoring software surfaced that the first experiment had not caught. Both punished customers for doing exactly what we told them to do.",
    image: "https://glassmkr.com/og/when-monitoring-punishes-customers.png?v=20260830",
    datePublished: "2026-05-20",
    dateModified: "2026-05-20",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/when-monitoring-punishes-customers.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/when-monitoring-punishes-customers",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "When monitoring punishes customers", item: "https://glassmkr.com/blog/when-monitoring-punishes-customers" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <p class="post-meta">May 2026 · Engineering</p>

    <h1>When your monitoring tool punishes customers for doing the right thing</h1>

    <p>A week ago we ran an experiment where a coding agent tried to resolve alerts on our validation fleet using only our own documented guidance. The experiment surfaced three real gaps in our alert design. We fixed all three, shipped them, and considered the work done.</p>

    <p>Then we ran a follow-up: actually clean up the fleet. Apply our guidance to every active alert. Observe what happens.</p>

    <p>The follow-up surfaced two bugs the first experiment had not. Both fall into the same shape: the customer follows our guidance, does the right thing, and our monitoring punishes them for it.</p>

    <h2>The cache that held too long</h2>

    <p>The validation fleet has seven boxes. The cleanup work was nominally simple: enable ufw where it was missing, install unattended-upgrades where it was disabled, harden SSH where the config still permitted password root login. Standard sysadmin hygiene with a clear concrete fix per alert.</p>

    <p>The cleanup ran. The fixes worked. But the alerts kept firing.</p>

    <p>A customer would have enabled ufw, watched the dashboard, seen the <code>no_firewall</code> alert still active in the next snapshot. And the snapshot after that. And the one after that. They would have thought: "Did the fix not take? Let me check ufw status again." They would have run <code>sudo ufw status</code>. It would have said <code>Status: active</code>. They would have looked back at the dashboard. The alert would still be firing.</p>

    <p>For up to 60 minutes after the fix.</p>

    <p>The root cause, when we found it, was straightforward and embarrassing. Our agent (Crucible) collects security-related state in a single block: firewall status, SSH config, unattended-updates status, pending security updates count. The pending-updates check is genuinely slow: it queries the apt or dnf metadata cache, which can take seconds on a busy system. To keep collection cheap, we had cached the entire security block at one-hour cadence.</p>

    <p>The intent was reasonable: do not query apt every five minutes. The implementation was wrong: do not cache the firewall config alongside the pending updates count. The pending updates count changes hours apart. The firewall config can change in seconds, the moment a customer enables ufw. Caching them together meant that legitimate, fast-changing state was being held stale to subsidise a slow check.</p>

    <p>From the customer's view there was no signal of a cache at all. They saw "I fixed it" and "the dashboard still says broken." The natural next question is: "Is the dashboard wrong, or am I?" Both answers erode trust in the product.</p>

    <p>The fix was a one-cache-extraction change. The cache moved out of the top-level security collector and into the specific sub-check that needed it. The pending-updates query still caches at one-hour cadence. Everything else runs every five minutes. The latency between customer fix and alert clearing dropped from "up to 60 minutes" to "5 minutes" (one ingest cycle). We shipped this as Crucible 0.9.3.</p>

    <h2>The reboot that fired its own alert</h2>

    <p>The second bug found us in a different way.</p>

    <p>Our <code>kernel_needs_reboot</code> rule fires when a Debian-family or RHEL-family box has applied a kernel update without yet rebooting to use it. The documented fix is simple: schedule a maintenance window and reboot. Our guidance had said this for as long as the rule had existed.</p>

    <p>We rebooted six boxes during the cleanup. Each came back cleanly. Each updated to the new kernel. The <code>kernel_needs_reboot</code> alerts on those boxes cleared. Six wins.</p>

    <p>Then the dashboard fired six <code>unexpected_reboot</code> critical alerts.</p>

    <p>From the agent's perspective, this was working as designed. <code>unexpected_reboot</code> exists to flag situations where a box came back from an unscheduled reboot, which can indicate a crash, a power event, or a kernel panic. The agent suppresses the alert when it sees a marker file written by an operator before a planned reboot. The marker file is created by a single command: <code>sudo glassmkr-crucible mark-reboot</code>.</p>

    <p>We had documented the reboot. We had not documented the marker.</p>

    <p>From the customer's perspective, this is the same shape as the cache bug. The customer reads "your kernel is outdated, please reboot." The customer reboots. The dashboard responds with a critical alert. The natural next question is: "Did I do something wrong?" The answer is no. The customer did exactly what we told them. We just forgot to mention the suppress command.</p>

    <p>The fix here was even smaller than the cache fix. One sentence added to the rule's documentation, cross-linking the <code>mark-reboot</code> command as step zero before the reboot itself. Five minutes of doc work for a bug whose customer-experience impact was real.</p>

    <h2>Both bugs share a shape</h2>

    <p>The cache bug is a caching design mistake. The mark-reboot bug is a documentation gap. They look entirely different. They come from different parts of the codebase. The teams that own them are different teams (one is agent code, one is docs).</p>

    <p>But from a customer's view they are identical. The customer reads our dashboard. The dashboard tells them to do something. They do it. The dashboard punishes them for it.</p>

    <p>This shape is worth taking seriously because the customer's response to it is the same response in both cases: stop trusting the dashboard. Once a customer learns that "I fixed it but it still says broken" is something the dashboard does, they will start ignoring alerts even when those alerts are legitimate. Trust in a monitoring tool is built or eroded one false alarm at a time.</p>

    <p>The remediation is therefore not just "fix the bugs" (which we did), but also "audit for other instances of this shape" (which is harder). The audit is ongoing. Some questions we are asking ourselves:</p>

    <ul>
      <li>Where else might agent-side caching hold customer-actionable state stale?</li>
      <li>Where else does our docs describe a fix without mentioning the agent-side coordination?</li>
      <li>Where else does an action on the customer side trigger an alert on our side that suppresses cleanly with another action they do not know about?</li>
    </ul>

    <p>These are not bugs in any one place. They are a category of bug. They emerge specifically when you have a feedback loop between customer state and your own monitoring, which is the whole game in our product.</p>

    <h2>Latency dropped, trust gradually rebuilds</h2>

    <p>The cache fix shipped in Crucible 0.9.3 and propagated to the validation fleet within one upgrade cycle. The next round of fleet cleanup we did, the fixes cleared their alerts at the very next ingest. From 60 minutes to 5 minutes, then to "essentially as fast as the cycle allows." That feels right.</p>

    <p>The <code>mark-reboot</code> cross-link shipped as a one-line addition to <code>/docs/alerts</code>. We have not yet had to reboot a box again, so we have not yet seen the post-fix shape in production. We will.</p>

    <p>The bigger commitment is the audit. Both of these bugs were caught not by the experiment that found the three evidence-shape gaps, but by the follow-up work of actually applying the fixes. The pattern is: experiments find what is wrong with the surface; cleanups find what is wrong with the loop. We are running more cleanups.</p>

    <p>If you operate monitoring software (or any product where customer state and your product's view of customer state are in a feedback relationship), the same shape will exist somewhere in your product. The way to find it is to actually use the product as a customer would, end-to-end, fix to feedback. Not just docs review. Not just usage in normal operations. Specifically: take an action your dashboard told the customer to take, and watch what your dashboard then says.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Dashboard Free &rarr;</a>
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
