<script lang="ts">
  // /for-gpu per CONTENT_TRANCHE_1 spec (2026-05-17). Audience:
  // GPU / ML infrastructure operators; a high-value, narrow vertical.
  import type { PageData } from "./$types";
  import ShowcaseGpuPanel from "$lib/components/showcase/ShowcaseGpuPanel.svelte";
  import rules from "$lib/data/rules.json";
  // Counts come from the catalogue, never from a word typed into a heading.
  import { ruleCountFor, inWords, inWordsCapitalized, totalRuleCount } from "$lib/vertical-rules";
  import "$lib/components/vertical.css";
  let { data }: { data: PageData } = $props();

  const serviceLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Monitoring for GPU and ML infrastructure",
    provider: {
      "@type": "Organization",
      name: "Glassmkr",
      url: "https://glassmkr.com",
    },
    areaServed: { "@type": "Place", name: "Worldwide" },
    description:
      "Monitoring for datacenter-tier GPU infrastructure. PSU redundancy, XID events, ECC counters, thermals, power draw, PCIe link state, IPMI sensors. Built for ML training clusters and inference fleets.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: "0",
      offerCount: 2,
      offers: [
        {
          "@type": "Offer",
          name: "Self-hosted",
          price: "0",
          priceCurrency: "USD",
          description: "AGPL-3.0-only, free forever, no node limits. The whole stack runs on your hardware with Docker Compose.",
        },
        {
          "@type": "Offer",
          name: "Hosted",
          price: "0",
          priceCurrency: "USD",
          description: "The maintained instance at app.glassmkr.com. Free, signups open, 10-node per-account cap.",
        },
      ],
    },
  });
</script>

<svelte:head>
  <title>Glassmkr for GPU and ML infrastructure: PSU, ECC, thermal monitoring at scale</title>
  <meta
    name="description"
    content="XID events, ECC counters, PCIe link state, PSU redundancy at scale, thermal patterns under sustained load. The boring infrastructure layer that keeps your training runs going."
  />
  <link rel="canonical" href="https://glassmkr.com/for-gpu" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/for-gpu" />
  <meta property="og:title" content="Glassmkr for GPU + ML infrastructure" />
  <meta
    property="og:description"
    content="Monitoring for datacenter GPU boxes: PSU redundancy, ECC counters, XID events, IPMI, PCIe link state. Built for training clusters."
  />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />

  {@html `<script type="application/ld+json">${serviceLd}</` + `script>`}
</svelte:head>

<article class="vertical">
  <section class="hero">
    <p class="eyebrow">FOR GPU + ML INFRASTRUCTURE</p>
    <h1>A training node is still a server, and most of what kills it is not the GPU.</h1>
    <p class="subhead">
      {inWordsCapitalized(ruleCountFor("gpu"))} rules read the GPUs. The other {inWords(totalRuleCount - ruleCountFor("gpu"))} still apply, because the box also has DIMMs, power supplies, fans,
      drives and a kernel. We monitor the host thoroughly and tell you plainly where that stops.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install in 2 minutes</a>
      <a href="https://github.com/glassmkr/crucible" class="btn btn-ghost btn-lg">View Crucible on GitHub<span class="mit-badge">AGPL-3.0-only</span></a>
    </div>
    <p class="cta-caption">Free hosted or self-hosted. Test on a single GPU box before deploying fleet-wide.</p>

    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
      <p class="install-version">Crucible v{data.crucibleVersion} on npm</p>
    </div>
  </section>

  <section class="section">
    <h2>The problem</h2>
    <p>
      GPU boxes get monitored as GPUs. Utilization, memory, temperature, and if you are thorough, ECC and XID codes.
      That is the interesting part, so it is the part that gets instrumented.
    </p>
    <p>
      Meanwhile the machine is a two-socket server with a lot of DIMMs, four to eight power supplies, a wall of fans,
      checkpoint-hungry NVMe, and a kernel that needs patching. Published fleet studies of large training runs put
      GPU-related faults at roughly a third of unexpected interruptions. The rest is the ordinary server underneath,
      and it is usually the part nobody set up alerts for.
    </p>
    <p>
      So the useful question is not whether a tool can chart GPU utilization. It is whether anything is watching the
      power supply that is about to take the node out mid-epoch.
    </p>

  <section class="section">
    <h2>How Glassmkr fits</h2>

    <div class="fit-grid">
      <div class="fit-item">
        <h3>GPU-aware alert rules.</h3>
        <p>
          Glassmkr’s {rules.length} rules include the specific things that go wrong with GPU hardware: PSU redundancy loss (critical on 8-PSU H100/B200 chassis), ECC errors trending up, IPMI sensor critical from BMC, thermal anomalies, power draw outside expected envelope.
        </p>
      </div>

      <div class="fit-item">
        <h3>Multi-GPU server-level metrics, not just per-GPU.</h3>
        <p>
          The agent collects metrics at the server level (PSU state, chassis temperature, BMC SEL entries) and at the per-GPU level (driver version mismatches, ECC error count, memory bandwidth). Aggregate views show the whole rack.
        </p>
      </div>

      <div class="fit-item">
        <h3>Open-source agent, datacenter-friendly install.</h3>
        <p>
          Crucible is AGPL-3.0-only. Install per box with one bash command. Deploys cleanly across 10, 100, or 1000 nodes via configuration management. Air-gapped variants supported on request.
        </p>
      </div>

      <div class="fit-item">
        <h3>Free in both deployment forms.</h3>
        <p>
          Self-hosted is AGPL-3.0-only with no node limits and runs on your own hardware; the hosted instance is free with a 10-node per-account cap. No per-node or telemetry-volume billing in either form, so monitoring never becomes a line item that scales with the fleet.
        </p>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Every GPU, read at a glance</h2>
    <p style="max-width:680px">Per-GPU temperature, power draw against limit, VRAM, ECC counters, PCIe link width and the XID event log. Everything here comes from nvidia-smi, which is present on every driver install, so there is no exporter or daemon to deploy first.</p>
    <div style="margin-top:24px"><ShowcaseGpuPanel /></div>
  </section>

  <section class="section">
    <h2>Specific alert rules that matter</h2>
    <p>GPU and ML infrastructure operators care most about:</p>

    <ul class="rule-categories">
      <li><strong>PSU state</strong>: redundancy loss on multi-PSU chassis (H100 boxes typically have 4-8 PSUs; losing one is degraded, losing two is at-risk)</li>
      <li><strong>IPMI sensors</strong>: fan failures, temperature thresholds exceeded, SEL critical entries from the BMC indicating hardware-level issues</li>
      <li><strong>ECC errors</strong>: correctable error rate trending up (often a leading indicator of impending DIMM or GPU memory failure)</li>
      <li><strong>NVMe wear</strong>: high write amplification from checkpoint-heavy training workloads</li>
      <li><strong>Network state</strong>: interface errors, link-down events and negotiated-speed drops on the host's Ethernet interfaces, including 100 and 400G and RoCE-capable NICs. We read the kernel's per-interface counters, so a native InfiniBand port is out of scope: it does not appear as a network interface, and its link-layer counters live somewhere we do not currently read</li>
      <li><strong>Disk I/O patterns</strong>: sustained latency anomalies indicating storage degradation under shuffle/dataloader pressure</li>
      <li><strong>Memory pressure</strong>: OOM kills on the host (data loader processes dying)</li>
      <li><strong>Service health</strong>: DCGM exporter unhealthy, NVIDIA driver mismatches across boxes in a multi-node training cluster</li>
      <li><strong>Driver survives a reboot</strong>: on an NVIDIA box where nouveau was never blacklisted, the next reboot binds nouveau first and the GPU never comes back; on a marketplace this silently de-lists the host. Glassmkr reads the loaded modules and the blacklist state and warns while the box is still up, so you fix it in a window you choose instead of finding out from lost earnings.</li>
    </ul>

    <p class="rule-footer">
      Full list at <a href="/docs">/docs</a>. For the GPU vertical specifically, the IPMI sensor coverage is the differentiator: most cloud-era monitoring tools don’t ingest BMC data because cloud workloads don’t expose it.
    </p>
  </section>

  <section class="section">
    <h2>Where we stop, and why we say so</h2>
    <p>
      We monitor the host. We do not monitor the fabric between hosts, and the distinction matters more on GPU
      infrastructure than anywhere else.
    </p>
    <p>
      From inside a node you can see that node's NVLink state, its GPUs, its NIC endpoint and its kernel log. You
      cannot see switch queue depth, adaptive routing, subnet manager health or a far-end transceiver. Those need
      switch or controller access, and no host agent of any kind gets them. Anyone claiming otherwise is either
      reading a switch you have not told them about or guessing.
    </p>
    <p>
      Two specific limits, stated plainly because you will hit them:
    </p>
    <ul>
      <li>
        <strong>We do not report NVLink bandwidth or saturation.</strong> Collective operations move data in short
        bursts between compute, so an average taken minutes apart says nothing useful about whether a link was
        saturated. We would rather report nothing than a confidently wrong number.
      </li>
      <li>
        <strong>We do not claim to predict NVLink failure.</strong> A published study spanning 855 days of production
        GPU fleets found no preceding hardware errors before its NVLink events. We detect a link that has dropped,
        quickly, and we can show one that is accumulating errors. Predicting the rest is not something the evidence
        supports, so we do not sell it.
      </li>
    </ul>
    <p>
      What we do instead is cover the host completely and tell you where the boundary is. On a training node that is
      most of the failure surface.
    </p>
  </section>

  <section class="section">
    <h2>The agent you can read</h2>
    <p>
      If you’re running ML infrastructure for research, you almost certainly have a compliance review process. Crucible passes most of them out of the box: AGPL-3.0-only, source published, no telemetry collection, non-root user, signed releases on npm.
    </p>
    <p>
      For environments where outbound HTTPS is restricted, the agent supports HTTP proxies and air-gapped deployment with manual metric upload. Email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a> if you need an air-gapped variant; we’ll help.
    </p>
  </section>

  <section class="section pricing-reminder">
    <h2>Pricing reminder</h2>
    <p>Free both ways: self-hosted under AGPL-3.0-only with no node limits, or the free hosted instance with a 10-node per-account cap. No telemetry-volume billing in either form, so the cost of monitoring does not grow as your training runs intensify.</p>
    <p class="pricing-note">
      Node counting is per server, not per GPU. An H100 box with 8 GPUs counts as one node.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install now</a>
      <a href="mailto:simon@glassmkr.com" class="btn btn-ghost btn-lg">Talk to us about your deployment</a>
    </div>
  </section>

  <section class="section cta-section">
    <h2>Install on a single GPU box first.</h2>
    <p>
      Install on a single GPU box first to verify integration. The default rules will fire on your hardware within minutes if any of the GPU-specific signals are degraded.
    </p>
    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
    </div>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Sign up free</a>
    </div>
    <div class="selfhost-block">
      <h3>Or self-host it</h3>
      <p>
        The whole stack is open source under AGPL-3.0-only and runs on your own hardware with one docker compose file;
        nothing leaves your network.
      </p>
      <pre><code>curl -fsSL https://glassmkr.com/install.sh | sudo bash -s -- \
  --api-key "gmk_cru_live_..." \
  --ingest-url "http://your-dashboard-host:3000/api/v1/ingest"</code></pre>
      <p><a href="/docs/self-hosting">Self-host in 10 minutes</a></p>
    </div>
    <p class="contact">
      For fleet deployments or air-gapped environments, email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a>. Glassmkr is built and run by one operator; you will be talking to the person who wrote the code.
    </p>
  </section>
</article>

<style>
  /* Page-specific overrides; shared rules live in
     $lib/components/vertical.css. .pricing-note styles the
     per-server node-counting caveat; .selfhost-block is the
     "Or self-host it" block in the closing CTA. */
  .pricing-note {
    font-size: 14px; color: var(--text-tertiary);
    margin: 0 0 28px; font-style: italic;
  }
  .selfhost-block {
    margin-top: 40px;
  }
  .selfhost-block h3 {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px;
  }
  .selfhost-block p {
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }
  .selfhost-block p:last-child {
    margin-bottom: 0;
  }
  .selfhost-block pre {
    background: #0d0d0d;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 18px 22px;
    overflow-x: auto;
    margin: 0 0 14px;
  }
  .selfhost-block pre code {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--accent);
    background: transparent;
    padding: 0;
    display: block;
  }
  .selfhost-block a {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
</style>
