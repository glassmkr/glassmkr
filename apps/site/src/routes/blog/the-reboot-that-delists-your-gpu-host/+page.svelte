<svelte:head>
  <title>The reboot that de-lists your GPU host - Glassmkr Blog</title>
  <meta name="description" content="A routine reboot would have silently knocked every box of our 20-box GPU fleet off the Vast marketplace, because nouveau was never blacklisted. The failure mode, the one-line fix, and the case for catching this class of latent fault before the reboot." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/the-reboot-that-delists-your-gpu-host" />
  <meta property="og:title" content="A single reboot would have de-listed our entire GPU fleet" />
  <meta property="og:description" content="On these NVIDIA boxes nouveau was never blacklisted, so the next reboot would have stopped every GPU verifying and dropped the host off the marketplace. The trap, the one-line fix, and why monitoring should catch it first." />
  <meta property="og:image" content="https://glassmkr.com/og/the-reboot-that-delists-your-gpu-host.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="The reboot that de-lists your GPU host" />
  <meta name="twitter:description" content="nouveau was never blacklisted, so the next reboot would have dropped every box off the marketplace. The trap, the fix, and why a monitor should warn you first." />
  <meta name="twitter:image" content="https://glassmkr.com/og/the-reboot-that-delists-your-gpu-host.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/the-reboot-that-delists-your-gpu-host" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "A single reboot would have de-listed our entire GPU fleet",
    description: "How an un-blacklisted nouveau driver turns a routine reboot into a silent marketplace de-list on NVIDIA GPU hosts, the one-line fix, and why monitoring should catch the latent fault first.",
    image: "https://glassmkr.com/og/the-reboot-that-delists-your-gpu-host.png?v=20260826",
    datePublished: "2026-06-30",
    dateModified: "2026-06-30",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/the-reboot-that-delists-your-gpu-host.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/the-reboot-that-delists-your-gpu-host",
    articleSection: "GPU"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "The reboot that de-lists your GPU host", item: "https://glassmkr.com/blog/the-reboot-that-delists-your-gpu-host" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">June 2026 · GPU · 6 min read</p>
      <h1>A single reboot would have de-listed our entire GPU fleet. Here is the trap, and why monitoring should catch it before you hit it.</h1>
      <p class="lede">
        A reboot is the most routine thing a server does. On a marketplace GPU host it can also be the most expensive. While working through alerts on a <a href="/blog/20-box-gpu-fleet-88-to-11-alerts">20-box fleet</a>, we found that one restart, the kind any host eats during maintenance or a power blip, would have silently knocked every box off Vast and stopped it earning. Three had already fallen into the trap. Here is the failure mode, the one-line fix, and the case for a monitor that warns you before the reboot, not after.
      </p>
    </header>

    <h2>The trap: nouveau wins the boot race</h2>
    <p>
      These are NVIDIA GPU boxes. The open-source <code>nouveau</code> driver was never blacklisted on them. As long as a box stays up, that is invisible: the real NVIDIA driver was loaded live at onboarding and everything works. The problem is latent, and it only springs on the next boot.
    </p>
    <p>
      On reboot, <code>nouveau</code> claims the GPU first, and the real <code>nvidia</code> module cannot take ownership of the device. The signature is in <code>dmesg</code>:
    </p>
    <pre><code>NVRM: This can occur when another driver such as nouveau has already obtained ownership of the NVIDIA device(s).
nvidia: probe of 0000:01:00.0 failed with error -16</code></pre>
    <p>
      <code>nvidia-smi</code> then fails. On a Vast host, the vast daemon cannot verify the GPUs, and the machine drops off the marketplace. The box is still powered on, still costing you, and earning nothing.
    </p>

    <h2>On a marketplace, downtime is not free</h2>
    <p>
      This is worse on a rented fleet than on your own servers. Vast.ai's documentation is blunt: hosts are told not to take their machines offline, and a machine's "reliability" is a documented measure of its historical uptime and health that feeds Vast's default search ranking. Lower reliability means your boxes rank lower and rent less. An unplanned outage, especially one that interrupts a running rental, is exactly the kind of event that hurts.
    </p>
    <p>
      Vast does give you a real maintenance mechanism: the <code>vastai schedule maint</code> command, which lets you announce a window to renters. The point is not that maintenance is impossible. It is the difference between planned downtime you schedule and announce, and unplanned downtime that arrives because a latent fault detonated on a reboot you did not know was dangerous. The nouveau trap is the second kind. You reboot for something unrelated, and the box quietly de-lists.
    </p>

    <h2>We were already three boxes deep</h2>
    <p>
      When we found this, three of the twenty boxes had been rebooted a few hours earlier and were sitting off the marketplace, not earning, with no alert that said why. The other seventeen were one maintenance window, one power blip, or one kernel panic away from the same place.
    </p>

    <h2>The fix is one line and it is non-disruptive</h2>
    <pre><code>echo -e "blacklist nouveau\noptions nouveau modeset=0" | sudo tee /etc/modprobe.d/blacklist-nouveau.conf
sudo update-initramfs -u</code></pre>
    <p>
      It is idempotent and changes nothing about the running system. It only affects the next boot, which is the entire point: it makes the box reboot-safe before the reboot happens. We applied it to all twenty, recovered the three that were down (one reboot each: GPUs came back, re-listed on Vast), and baked this exact block into onboarding so future boxes are born reboot-safe.
    </p>

    <h2>This is a monitoring problem, and monitoring should own it</h2>
    <p>
      Here is the part that matters for Glassmkr. Every signal needed to catch this is already on the box: <code>nouveau</code> is loaded, the NVIDIA hardware is present, and no <code>nvidia</code> kernel module is bound to it. That combination means one thing: this host's GPU will not come back after a reboot. A monitor that can see the running kernel modules can see that, and it can tell you while the box is still up and earning, not after it has gone dark.
    </p>
    <p>
      That is the honest version of "predictive." Not guessing at the future, just noticing a loaded gun on the table. This check now ships in Crucible and runs on the exact fleet that hit the trap. It warns in both cases: when an NVIDIA box is already running without its driver bound, and, the more useful one, while the box is still healthy but nouveau was never blacklisted, so the danger is only latent. Either way you blacklist nouveau and rebuild the initramfs in a window you chose, instead of learning about it from a drop in your earnings.
    </p>

    <h2>Check one thing today</h2>
    <p>
      If you run NVIDIA GPUs on a marketplace, check one thing: <code>lsmod | grep -e nouveau -e nvidia</code>. If you see <code>nouveau</code> and not <code>nvidia</code>, or you never blacklisted nouveau, you are one reboot from an outage. Fix it in a window you control. And if you want something watching for the class of latent fault that only bites on reboot, that is what we built Glassmkr to catch.
    </p>

    <footer class="post-footer">
      <p>Published June 30, 2026. By Simon Rybisar.</p>
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
