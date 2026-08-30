<svelte:head>
  <title>We found a security false-negative in our own monitoring - Glassmkr Blog</title>
  <meta name="description" content="On RHEL-family hosts, download-only dnf-automatic timers were treated as 'auto-updates configured,' silently suppressing the pending_security_updates alert. Here is exactly what the bug was, how dogfooding caught it, and the fix in Crucible 0.13.6." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/we-found-a-security-false-negative-in-our-own-monitoring" />
  <meta property="og:title" content="We found a security false-negative in our own monitoring" />
  <meta property="og:description" content="The worst failure mode for a monitoring tool is the alert that stays quiet while something is wrong. We found one in our own product, caught it by dogfooding, and fixed it in Crucible 0.13.6." />
  <meta property="og:image" content="https://glassmkr.com/og/we-found-a-security-false-negative-in-our-own-monitoring.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="We found a security false-negative in our own monitoring" />
  <meta name="twitter:description" content="Download-only dnf-automatic on RHEL hosts silently suppressed our pending-patch alert. We caught it dogfooding, fixed it in 0.13.6, and we are telling you about it." />
  <meta name="twitter:image" content="https://glassmkr.com/og/we-found-a-security-false-negative-in-our-own-monitoring.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/we-found-a-security-false-negative-in-our-own-monitoring" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "We found a security false-negative in our own monitoring",
    description: "On RHEL-family hosts, download-only dnf-automatic timers were treated as auto-updates configured, silently suppressing the pending_security_updates alert. What the bug was, how dogfooding caught it, and the fix in Crucible 0.13.6.",
    image: "https://glassmkr.com/og/we-found-a-security-false-negative-in-our-own-monitoring.png?v=20260830",
    datePublished: "2026-05-29",
    dateModified: "2026-05-29",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/we-found-a-security-false-negative-in-our-own-monitoring.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/we-found-a-security-false-negative-in-our-own-monitoring",
    articleSection: "Security"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "We found a security false-negative in our own monitoring", item: "https://glassmkr.com/blog/we-found-a-security-false-negative-in-our-own-monitoring" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">May 2026 · Security · 5 min read</p>
      <h1>We found a security false-negative in our own monitoring. Here is exactly what it was.</h1>
      <p class="lede">
        The worst failure mode for a monitoring tool is not a noisy false alarm. It is the alert that stays quiet while something is actually wrong. We found one of those in our own product, caught it by running Glassmkr against our own fleet, fixed it, and we are telling you about it because that is the only honest thing to do.
      </p>
    </header>

    <h2>The bug</h2>

    <p>
      On RHEL-family hosts (Rocky, AlmaLinux, RHEL, CentOS, Fedora), Crucible has a check that asks "are automatic security updates configured?" If the answer is yes, the dashboard suppresses the <code>pending_security_updates</code> alert, on the reasoning that a host applying its own patches does not need to be nagged about pending ones.
    </p>

    <p>
      The check was wrong on one specific configuration. <code>dnf-automatic</code> ships with a download-only mode: the timer runs, it downloads updates, and it never installs them unless <code>apply_updates = yes</code> is set in <code>/etc/dnf/automatic.conf</code>. Our detector saw the timer enabled and reported "auto-updates configured: true." So on a host that was downloading security patches and never applying them, we suppressed the very alert that should have been screaming.
    </p>

    <p>
      The result: a host could sit with pending Critical-rated security updates, indefinitely unapplied, and the dashboard would show it as fine.
    </p>

    <h2>Why it happened</h2>

    <p>
      The Debian code path got it right and the RHEL path did not, for a specific reason. The Debian/Ubuntu side of the same check inspected the actual contents of the <code>unattended-upgrades</code> config to decide "configured." The RHEL side trusted the timer-enabled state alone and never read the config. Two code paths, two standards.
    </p>

    <p>
      The underlying trap is that <code>dnf-automatic</code> has a download-versus-install split that <code>unattended-upgrades</code> does not. There is no Debian equivalent of "the updater is running but deliberately not applying anything." So the RHEL path modeled a world that does not have a download-only mode, and download-only is exactly the mode that bites you.
    </p>

    <h2>How we caught it</h2>

    <p>
      We run Crucible on our own validation fleet. During a structured validation campaign we walked every alert rule on real hardware, and one of the RHEL hosts (Rocky 9.6, with a download-only <code>dnf-automatic</code> timer) had 26 pending updates including one rated Critical. The <code>pending_security_updates</code> alert was not firing. That silence was the bug. A monitoring tool that goes quiet in the presence of unapplied Critical patches has failed at its one job.
    </p>

    <p>
      This is the entire argument for dogfooding. We did not find this from a customer ticket or a CVE write-up; we found it by pointing our own product at our own machines.
    </p>

    <h2>The fix</h2>

    <p>
      Crucible 0.13.6 makes the RHEL path as config-aware as the Debian path. It now reports auto-updates as configured only when one of two things is true:
    </p>

    <ul class="post-list">
      <li><code>dnf-automatic-install.timer</code> is enabled (that timer applies updates unconditionally), or</li>
      <li>a legacy or download timer is enabled <strong>and</strong> <code>apply_updates = yes</code> in <code>/etc/dnf/automatic.conf</code>.</li>
    </ul>

    <p>
      Otherwise it reports "not configured" with a reason, which un-suppresses <code>pending_security_updates</code>. We validated the fix end to end: on the affected host, after upgrading to 0.13.6, the alert fired on the very first collection cycle, correctly, on the patches that had been sitting there the whole time.
    </p>

    <p>
      Debian and Ubuntu hosts were never affected. That path already read the config.
    </p>

    <h2>What you should do</h2>

    <p>
      If you run RHEL-family hosts with <code>dnf-automatic</code>, upgrade the agent:
    </p>

    <pre><code>sudo npm install -g @glassmkr/crucible@latest
sudo systemctl restart glassmkr-crucible</code></pre>

    <p>
      If you want to check whether you were in the affected state, look for a <code>dnf-automatic.timer</code> enabled with <code>apply_updates = no</code> in <code>/etc/dnf/automatic.conf</code>. That is the download-only configuration: patches arriving, nothing installing them. 0.13.6 will now tell you.
    </p>

    <h2>The principle</h2>

    <p>
      We would rather publish our own false-negative than let you discover it. A monitoring tool earns trust by failing loudly, and the failures it must never have are the silent ones. We found a silent one, we fixed it, and we are writing it down in public because a vendor that hides its own near-misses is not a vendor you should trust to watch your infrastructure.
    </p>

    <p>
      If you want to read the alert rules and what each one checks, they are public at <a href="/docs/rules">/docs/rules</a>. The changelog entry for this fix is at <a href="/docs/changelog">/docs/changelog</a>.
    </p>

    <footer class="post-footer">
      <p>Published May 29, 2026. By Simon Rybisar.</p>
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
    margin: 0 0 8px;
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
