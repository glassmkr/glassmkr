<svelte:head>
  <title>Validating GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16 - Glassmkr Blog</title>
  <meta name="description" content="Before returning our validation fleet we pointed the eight GPU rules at three different NVIDIA cards. What we could safely induce, what we refused to, and what the hardware told us, including the A16 that was actually two A16s." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/validating-gpu-monitoring-across-three-nvidia-cards" />
  <meta property="og:title" content="Validating GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16" />
  <meta property="og:description" content="Three cards, eight rules. Three live-tested, five fixture-tested, and we say which. The honest version of GPU monitoring validation." />
  <meta property="og:image" content="https://glassmkr.com/og/validating-gpu-monitoring-across-three-nvidia-cards.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16" />
  <meta name="twitter:description" content="What we tested live on real GPUs, and what we refused to induce because a real fault needs a power cycle to clear." />
  <meta name="twitter:image" content="https://glassmkr.com/og/validating-gpu-monitoring-across-three-nvidia-cards.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/validating-gpu-monitoring-across-three-nvidia-cards" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Validating GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16",
    description: "Before returning our validation fleet we pointed the eight GPU rules at three different NVIDIA cards. What we could safely induce, what we refused to, and what the hardware told us.",
    image: "https://glassmkr.com/og/validating-gpu-monitoring-across-three-nvidia-cards.png?v=20260826",
    datePublished: "2026-05-31",
    dateModified: "2026-05-31",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/validating-gpu-monitoring-across-three-nvidia-cards.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/validating-gpu-monitoring-across-three-nvidia-cards",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Validating GPU monitoring across three NVIDIA cards", item: "https://glassmkr.com/blog/validating-gpu-monitoring-across-three-nvidia-cards" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">May 2026 · Engineering · 7 min read</p>
      <h1>Validating GPU monitoring across three NVIDIA cards: L4, RTX A4000, A16</h1>
      <p class="lede">
        Before we returned our validation fleet, we pointed the eight GPU alert rules at three different NVIDIA cards. Three of the rules we tested live on real hardware. Five we deliberately did not. This is the honest version of what "GPU monitoring, tested" actually means.
      </p>
    </header>

    <p>
      Most of our alert rules can be exercised by safely inducing the condition: fill a disk, load the CPU, fail a RAID member and add it back. GPUs are different. The faults that matter most on a GPU, an uncorrected ECC error, a critical XID event, an NVLink drop, are exactly the faults you cannot safely create on a machine you intend to keep using. A real one usually corrupts state and needs a power cycle to clear. So the interesting question for GPU monitoring is not just "does the rule fire," it is "which rules can you honestly say you tested, and how."
    </p>

    <p>
      We had three cards on the fleet: an NVIDIA L4 (the same card our production inference host runs), an RTX A4000, and an A16. All three on Debian 13, driver 550.163.01. Here is what each one told us.
    </p>

    <h2>Three cards, eight rules</h2>

    <p>
      The GPU rule set is eight rules: thermal critical, power-cap throttling, corrected-ECC storm, uncorrected ECC, XID critical, PCIe link degraded, NVLink down, and driver/firmware drift. We split them into what was safely inducible and what was not, and we recorded the split explicitly rather than quietly marking everything "tested."
    </p>

    <ul class="post-list">
      <li><strong>Live-tested on real hardware (3):</strong> power-cap throttling (A16), thermal critical (L4), driver/firmware drift (all three cards).</li>
      <li><strong>Fixture-tested, not induced (5):</strong> uncorrected ECC, corrected-ECC storm, XID critical, PCIe link degraded, NVLink down.</li>
    </ul>

    <h2>What we refused to induce, and why that is the honest answer</h2>

    <p>
      Five of the eight rules are classified <code>synthesize-only</code>: validated against typed test fixtures that feed the evaluator the exact shape of a real fault, but never induced on the physical card. This is a deliberate policy, not a gap we are hiding.
    </p>

    <p>
      Real uncorrected-ECC injection corrupts VRAM and typically requires a power cycle to recover. A witnessed critical XID event implies a hardware fault that is not safely reproducible. Forcing an NVLink down risks wedging multi-GPU collectives mid-flight. PCIe link-width modification means re-seating the card or issuing raw <code>setpci</code> writes that can hang the device. None of these are reversible in the way a disk-fill test is reversible, and a hung GPU on a fleet we were about to hand back costs more than the test is worth.
    </p>

    <p>
      So for those five we exercise the classification logic with fixtures (for example, the XID rule's mapping of a code to NVIDIA's published severity table, or the NVLink rule's per-link down-state predicate) and we tell you that is what we did. The FIX prose for the forensic rules (XID, uncorrected ECC) correctly directs the operator to capture <code>nvidia-bug-report.sh</code> and <code>dmesg</code> before touching anything, because the first job on a P0 GPU fault is preserving evidence, not clearing the alert.
    </p>

    <h2>The A16 that was actually two A16s</h2>

    <p>
      Our own inventory described the A16 host as "a 4-GPU board." When we actually queried it, <code>nvidia-smi</code> and our API both reported <strong>eight dies across two A16 boards</strong>, uniform vbios 94.07.62.00.AD across all eight. Not a bug, just a reminder that the only inventory you can trust is the one the hardware reports.
    </p>

    <p>
      The A16 was also the most useful host, because it throttles on its own. At any given snapshot, between two and four of its eight dies showed <code>sw_power_cap</code> active, and the active set shifted between snapshots as dies entered and left power-gated state. That gave us a live, ongoing, non-induced power-cap-throttling condition to validate against, which we preserved as ground truth rather than clearing.
    </p>

    <p>
      The thing we most wanted to confirm was per-die deduplication. A naive parser does one of two wrong things: it aggregates eight dies into one host-level alert and hides which die is throttling, or it over-emits and reports a row per die per snapshot even when the die is fine. Ours did neither. Across the event window, fires landed on six of eight distinct PCI BDFs, and at the validation moment the host showed exactly three active alerts, one row per currently-throttling die, each carrying its own <code>gpu_uuid</code>, <code>pci_bdf</code>, <code>power_draw_w</code>, <code>power_limit_w</code> and throttle-reason set. The campaign also confirmed a recent field-name correction (the throttle-reason key <code>hw_power_brake_slowdown</code>) works on driver 550.163.01, by running the rule's own <code>quick_check</code> command over SSH and diffing the output.
    </p>

    <h2>Thermal load on the L4: the rule that correctly stayed quiet</h2>

    <p>
      The L4 is our highest-fidelity card because it matches our production inference host. We ran a sustained thermal load on it: a user-space PyTorch burn loop (repeated 8192x8192 matrix multiplies with a dependency chain to defeat dead-code elimination), 100% utilization for about six minutes. No power-limit change, no fan-curve modification, no thermal-protection bypass. Purely passive observation of where the temperature settled.
    </p>

    <p>
      It settled at 67 degrees C. The thermal-critical threshold is 90 C absolute, with hardware slowdown around 86 C. The card never came close, so <code>gpu_thermal_critical</code> correctly did not fire. That is the result you want from a thermal rule under a healthy heavy workload: silence. A rule that fired here would be a false positive, and a GPU monitoring tool that cries wolf every time someone runs a real training job is worse than no tool.
    </p>

    <p>
      A practical aside that will save you time: the L4 box had <code>docker</code> but no NVIDIA container runtime, so the usual containerized burn tools failed at CDI vendor discovery. The reversible path that worked was a throwaway Python venv with the CUDA-bundled PyTorch wheel, which only needs the host <code>libcuda.so</code>. Worth knowing if you ever need to load-test a GPU box that was set up for inference, not for CUDA development.
    </p>

    <h2>Driver drift, and the limits of per-snapshot detection</h2>

    <p>
      The driver/firmware-drift rule is the clearest example of a rule that is correct precisely because it stays quiet. It fires only when two GPUs <em>of the same model</em> on the same host report different vbios versions, which is a real and nasty failure mode on multi-GPU boxes after a partial firmware update. On the A16's eight dies the vbios was uniform, so it did not fire. On the single-GPU L4 and RTX A4000 it cannot fire at all (one GPU has nothing to disagree with), and the rule returns early on any host with fewer than two GPUs. We validated all three of those as correct proofs-of-no-fire.
    </p>

    <p>
      It is also a useful place to be honest about a limit. This rule detects drift <em>within a single host</em>, because that is what a per-snapshot evaluator can see. Cross-host fleet-wide drift, the same model running different firmware on different machines, is a different and harder problem that needs a cross-snapshot aggregation primitive we have not built yet. We would rather ship the within-host check that works than imply a fleet-wide guarantee we cannot currently make.
    </p>

    <h2>What this means if you run GPUs</h2>

    <p>
      The summary we are comfortable putting our name to: the power-cap-throttling rule is fleet-tested on a real multi-die A16 with confirmed per-die behavior; the thermal rule is validated under a real sustained load on the production-equivalent L4 and correctly stays quiet below threshold; the driver-drift rule is validated as a correct proof-of-no-fire across all three cards. The five fault-injection rules are validated against fixtures that match the real telemetry shape, and we label them that way rather than claiming an induction we did not perform.
    </p>

    <p>
      That distinction, fleet-tested versus fixture-tested, is the entire point. A monitoring vendor that says "GPU monitoring, fully tested" without telling you that nobody can safely create a real uncorrected-ECC error on a production card is either being loose with the word "tested" or does not run GPUs themselves. We do, and this is the honest map.
    </p>

    <p>
      The eight GPU rules and what each one checks are public at <a href="/docs/rules">/docs/rules</a>, and you can see the GPU panel itself on a sample A16 host in the <a href="https://app.glassmkr.com/demo">live demo</a>.
    </p>

    <footer class="post-footer">
      <p>Published May 31, 2026. By Simon Rybisar.</p>
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
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .post em { color: var(--text-primary); font-style: italic; }

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
