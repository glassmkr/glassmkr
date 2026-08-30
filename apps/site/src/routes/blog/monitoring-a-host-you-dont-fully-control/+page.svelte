<svelte:head>
  <title>Monitoring a host you don't fully control - Glassmkr Blog</title>
  <meta name="description" content="Three alert rules fired on every box in our GPU fleet, and all three were correct readings of config a marketplace GPU host is supposed to have. The same signal is a finding on one host and required config on another, so we taught Glassmkr the difference with host-type profiles." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/monitoring-a-host-you-dont-fully-control" />
  <meta property="og:title" content="Half the problems on a marketplace GPU host are required config" />
  <meta property="og:description" content="The same signal that is a finding on a web server is required config on a Vast GPU host. So we stopped treating every host the same, with host-type profiles that suppress the expected noise and keep the real problems loud." />
  <meta property="og:image" content="https://glassmkr.com/og/monitoring-a-host-you-dont-fully-control.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Monitoring a host you don't fully control" />
  <meta name="twitter:description" content="The same signal is a finding on one host and required config on another. Host-type profiles teach the monitor the difference." />
  <meta name="twitter:image" content="https://glassmkr.com/og/monitoring-a-host-you-dont-fully-control.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/monitoring-a-host-you-dont-fully-control" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Half the problems on a marketplace GPU host are required config. So we taught Glassmkr the difference.",
    description: "Why the same alert signal is a finding on one host and required config on another, and how host-type profiles suppress expected noise by role while keeping genuine problems loud.",
    image: "https://glassmkr.com/og/monitoring-a-host-you-dont-fully-control.png?v=20260830",
    datePublished: "2026-07-01",
    dateModified: "2026-07-01",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/monitoring-a-host-you-dont-fully-control.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/monitoring-a-host-you-dont-fully-control",
    articleSection: "Product"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Monitoring a host you don't fully control", item: "https://glassmkr.com/blog/monitoring-a-host-you-dont-fully-control" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/monitoring-a-host-you-dont-fully-control.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title Half the &quot;problems&quot; on a marketplace GPU host are required config" width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">July 2026 · Product · 5 min read</p>
      <h1>Half the "problems" on a marketplace GPU host are required config. So we taught Glassmkr the difference.</h1>
      <p class="lede">
        Three alert rules fired on every box in our 20-box GPU fleet on Vast: no firewall, automatic updates disabled, GPU power cap throttling. All three were correct readings of the system. All three were the wrong thing to alert on, because that configuration is exactly what a marketplace GPU host is supposed to have. The same signal that is a finding on one host is required config on another. So we stopped treating every host the same.
      </p>
    </header>

    <h2>Same signal, different meaning</h2>
    <p>
      A firewall that is off is a real finding on a public web server. On a Vast GPU host it is mandatory: the box has to keep its rental port range open, and a host firewall fights Docker's own iptables rules. Turn it on and you break the box.
    </p>
    <p>
      Automatic security updates being disabled is a finding on a normal Linux server. On a GPU host it is deliberate: an unattended upgrade will bump the NVIDIA driver out from under the running CUDA stack, fail to match the loaded kernel module, and de-verify the host on the marketplace. You disable auto-updates on purpose and patch in a controlled window.
    </p>
    <p>
      A GPU sitting under its factory power cap is worth a look on a box you own and tune. On a fleet of rented A16s and A6000s that ship a conservative default, it is just the default.
    </p>
    <p>
      None of these readings are wrong. The mistake would be to nag the operator about all of them, on every box, forever. That is how a monitor trains you to ignore it.
    </p>

    <h2>Muting one rule at a time does not scale</h2>
    <p>
      The blunt tool is muting: silence <code>no_firewall</code> on box 1, box 2, box 3, and so on. We did exactly that to get our fleet quiet, and it works, but it has three problems. It is manual and per-host, so a new box starts noisy again. It records that you silenced a rule but not why, so the next operator cannot tell an intentional mute from a forgotten one. And it hides the rule entirely, so if the meaning ever changes you do not find out.
    </p>

    <h2>Host-type profiles</h2>
    <p>
      So Glassmkr now understands that a host has a role. Set a server's profile to Marketplace GPU host and the rules that are expected-by-design for that role stop nagging: the firewall, the auto-updates, and the default power cap go quiet for that profile, with the reason recorded, while everything that is genuinely a problem (a failing drive, the driver-will-not-survive-reboot check) keeps firing exactly as before. We later folded the kernel-CVE alert into the same profile, for the same reason: on these hosts those CVEs are patched on a scheduled maintenance reboot the operator chooses, not auto-applied. The profile silences the rules that are wrong for this host type, not the ones that matter.
    </p>
    <p>
      The difference from muting is that this is declarative and correct by construction. A box you onboard into the profile is born quiet on the expected noise and loud on the real problems. The suppression is documented as "expected for this host type," not buried as a per-rule mute. And the alerts are suppressed, not deleted: you can still see them when you want the full picture.
    </p>

    <h2>Shipping the feature was not enough</h2>
    <p>
      There is a postscript worth telling, because it is the kind of thing that usually goes unsaid. We shipped host profiles, and a few days later looked at the fleet: every box still read "no profile." The feature worked. Nobody had applied it, so it was suppressing nothing. A feature that needs a manual step on twenty boxes is a feature that mostly does not happen.
    </p>
    <p>
      So we made the monitor do the noticing. A host whose tags mark it as a marketplace box, with no profile set, now gets a one-click prompt on its page: this looks like a marketplace GPU host, apply the profile? The suppression you would have configured by hand is offered at the moment you are looking at the noise. The lesson generalizes past this one feature: context-awareness you have to switch on by hand mostly stays off.
    </p>

    <h2>This is the same principle, applied to context</h2>
    <p>
      We have written before about <a href="/blog/when-monitoring-punishes-customers">monitoring that punishes the people it is supposed to help</a>: alerts that fire on things the operator cannot or should not change, until the operator stops reading them. Host profiles are the same idea pointed at host context. An alert is only useful if it is actionable for this host. A marketplace GPU box and a database server are not the same machine wearing different names, and a monitor that pretends they are will be wrong on one of them.
    </p>

    <h2>A monitor should know what it is looking at</h2>
    <p>
      If you run hosts you do not fully control, or fleets where the "right" configuration is unusual on purpose, the answer is not to lower your standards or to drown in mutes. It is for the monitor to understand what kind of host it is looking at. That is what host profiles do, and it is why our 20-box fleet went from a wall of expected noise to a short list of things actually worth your time.
    </p>

    <footer class="post-footer">
      <p>Published July 1, 2026. By Simon Rybisar.</p>
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
