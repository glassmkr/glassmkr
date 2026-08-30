<svelte:head>
  <title>We pointed Glassmkr at a 20-box GPU fleet: 88 alerts to 11 - Glassmkr Blog</title>
  <meta name="description" content="We put twenty GPU boxes on Vast and pointed Glassmkr at them. The dashboard lit up with 88 active alerts; a day later we were at 11. The honest part is the breakdown: real hardware, deliberate noise, self-inflicted, and the false positives we then fixed." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/20-box-gpu-fleet-88-to-11-alerts" />
  <meta property="og:title" content="We pointed Glassmkr at a 20-box GPU fleet. It went from 88 alerts to 11." />
  <meta property="og:description" content="The headline number is not the interesting part. The breakdown is: real hardware, noise we muted on purpose, self-inflicted reboots, and the false positives we fixed in the product." />
  <meta property="og:image" content="https://glassmkr.com/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="A 20-box GPU fleet: 88 alerts to 11" />
  <meta name="twitter:description" content="The honest part is the breakdown: real hardware, deliberate noise, self-inflicted, and the false positives we fixed." />
  <meta name="twitter:image" content="https://glassmkr.com/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/20-box-gpu-fleet-88-to-11-alerts" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "We pointed Glassmkr at a 20-box GPU fleet. It went from 88 alerts to 11.",
    description: "A field report from running Glassmkr against twenty GPU boxes on Vast: the breakdown of 88 alerts down to 11, what was real, what was noise, and the false positives we fixed.",
    image: "https://glassmkr.com/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830",
    datePublished: "2026-06-28",
    dateModified: "2026-06-28",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/20-box-gpu-fleet-88-to-11-alerts",
    articleSection: "GPU"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "A 20-box GPU fleet: 88 alerts to 11", item: "https://glassmkr.com/blog/20-box-gpu-fleet-88-to-11-alerts" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/20-box-gpu-fleet-88-to-11-alerts.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title We pointed Glassmkr at a 20-box GPU fleet. It went from 88 alerts to 11." width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">June 2026 · GPU · 7 min read</p>
      <h1>We pointed Glassmkr at a 20-box GPU fleet. It went from 88 alerts to 11. The honest part is the breakdown.</h1>
      <p class="lede">
        We put twenty GPU boxes on the Vast.ai marketplace and pointed Glassmkr at all of them. The dashboard lit up with 88 active alerts. A day of working through them got us to 11. The headline number is not the interesting part. The breakdown is: what was real hardware, what was noise we muted on purpose, what was self-inflicted, and what was a false positive we then fixed in the product. A monitor's job is not zero alerts. It is that every alert left standing is true and worth acting on.
      </p>
    </header>

    <h2>The fleet</h2>
    <p>
      Not the uniform fleet we expected. Three A16 boxes (one with 4 GPUs, two with 8), fifteen L4s, one RTX A4000, one RTX A6000. GPU model and count both vary per box, which already tells you something: any monitoring that assumes a fixed hardware profile will be wrong somewhere.
    </p>

    <h2>Where the 88 went</h2>

    <p><strong>Real hardware: one genuine item, not the three we first flagged.</strong></p>
    <p>
      Our first pass flagged three candidates for replacement: an L4 with an uncorrected ECC error, a drive reporting SMART failure, and a GPU on a degraded PCIe link. Then we read each one to the metal, and two did not survive scrutiny:
    </p>
    <ul>
      <li>The "uncorrected ECC" L4 had a single lifetime error with none since boot, no remapped rows, and the SRAM error threshold not exceeded: the signature of a one-off bit flip in on-die SRAM (the L2 cache), not in the VRAM. NVIDIA warrants a replacement only on a row-remapping failure or an exceeded SRAM error threshold, and neither was present, so this is not an RMA. (NVIDIA's GPU Memory Error Management documentation sets those thresholds: a row-remap failure, or "SRAM Threshold Exceeded" at more than four uncorrectable-error events per bank for parity-protected SRAM, more than two for SECDED.)</li>
      <li>The "degraded PCIe link" was a GPU sitting idle. The link narrows its width (to x4 of the full x16) to save power while the link generation stays maxed, and it retrains to full width the moment a job loads it. Expected power management, not a fault.</li>
    </ul>
    <p>
      That left one genuine hardware item: a drive with a declining SMART health trend, which stays on the dashboard until the RMA goes out. The uncomfortable lesson, worth saying out loud: two of our own three "real hardware" calls were false positives. The fix was not to wave them away. It was to teach the rules to read the same deeper signals we had to read by hand (more below).
    </p>

    <p><strong>Required-by-design config, muted on purpose.</strong></p>
    <p>Three rules fired across all twenty boxes because of configuration a Vast GPU host must have:</p>
    <ul>
      <li><code>no_firewall</code>: a marketplace GPU host has to keep its rental port range open (a small block from port 40000), and ufw fights Docker's iptables. Turning on a firewall would break the box.</li>
      <li><code>unattended_upgrades_disabled</code>: enabling auto-updates would bump the NVIDIA driver out from under the running CUDA stack and de-verify the host.</li>
      <li><code>gpu_power_cap_throttling</code>: the A16 and A6000 ship a conservative default power cap.</li>
    </ul>
    <p>
      Muting these is not the monitor being wrong and us papering over it. It is context the monitor did not have, which is itself a product finding (below).
    </p>

    <p><strong>Self-inflicted, correctly detected.</strong></p>
    <p>
      Three <code>unexpected_reboot</code> alerts from our own recovery reboots during the work. They are the same three boxes from the nouveau story below: trapped on the first reboot, recovered on the second. The detection was right, and they age out on their own.
    </p>

    <p><strong>False positives we fixed.</strong></p>
    <p>
      <code>kernel_needs_reboot</code> fired on boxes where the running kernel was already the newest installed: a bug in the comparison, now fixed. With the two reclassified hardware calls, that is three rules an honest field test caught crying wolf. We fixed each at the source: the ECC rule now separates a benign lifetime SRAM blip from active VRAM damage, the PCIe rule ignores an idle power-capped GPU, and the kernel-reboot check compares the running kernel to the newest installed one.
    </p>

    <p><strong>The big latent one.</strong></p>
    <p>
      The single most valuable thing we found was not in the 88 at all: a reboot would have silently de-listed the whole fleet from Vast, because nouveau was never blacklisted. That one gets <a href="/blog/the-reboot-that-delists-your-gpu-host">its own post</a>.
    </p>

    <p>
      <strong>The tally.</strong> The bulk of the 88 were the required-config mutes (<code>no_firewall</code> and <code>unattended_upgrades_disabled</code> on all twenty, the kernel false positives on most), with the ssh hardening and the nouveau-caused service failures fixed outright. That left 11: four <code>gpu_power_cap_throttling</code>, three <code>unexpected_reboot</code>, two <code>disk_latency_high</code>, one <code>gpu_pcie_link_degraded</code>, and one <code>gpu_uncorrected_ecc</code>. Two of those 11 (the PCIe and the ECC) are the ones we went on to reclassify as false positives.
    </p>

    <h2>What this says about monitoring</h2>
    <p>
      The goal was never to drive the count to zero. Plenty of monitors will happily show you a green dashboard by being quiet. The goal is that the alerts left standing are all true: real hardware to replace, or self-inflicted and aging out. Getting there meant a monitor that lets you say "this is expected on this host" without losing the ability to see it. Noise is not the alerts you mute. Noise is the alerts you cannot mute and cannot trust.
    </p>

    <h2>What we changed in Glassmkr because of this</h2>
    <p>A field test that does not change the product is just a status report. This one changed ours, in two rounds:</p>
    <ul>
      <li>A check for the reboot-de-list trap, so the latent fault is caught before the reboot. It is shipped and running on the exact fleet that hit it.</li>
      <li>Host-type profiles, so the "required config" alerts above are suppressed by host role instead of muted one rule at a time. Then we found the feature did nothing until a host opts in, so we added auto-detection: a box that looks like a marketplace GPU host now gets a one-click prompt to apply the profile.</li>
      <li>The false-positive fixes above: the PCIe rule is load-aware, the ECC rule reads since-boot and row-remap signals, the disk-latency rule tells saturation from a failing drive, and the kernel-reboot comparison is fixed.</li>
      <li>The active count was hiding worse noise underneath. Every rule that stayed true re-fired into the event log on each five-minute snapshot, so a single always-true alert logged twelve identical rows an hour, and with dozens of them across twenty boxes the log buried the real state changes. We changed it to record state transitions, not snapshots. A rule that keeps firing and clearing (flapping) is a separate failure, so we added a detector that folds it into one "this is flapping" warning instead of a stream of on-off rows.</li>
    </ul>
    <p>
      That is the loop we care about: run the product against a real fleet, write down everything that was noise or wrong, and close the gap. The active count went from 88 to 11 in the first pass, and to a short, trustworthy list once we fixed the noise floor itself: the one drive we are replacing, plus the occasional transient that clears on its own.
    </p>

    <h2>What the number is for</h2>
    <p>
      If you operate a GPU fleet, especially on a marketplace, the number on your dashboard matters less than whether you trust it. Eighty-eight alerts you cannot reason about is worse than eleven you can. We would rather show you eleven true things than a green light we cannot defend.
    </p>

    <footer class="post-footer">
      <p>Published June 28, 2026. By Simon Rybisar.</p>
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
