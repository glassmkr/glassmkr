<svelte:head>
  <title>Why bare metal monitoring is different - Glassmkr Blog</title>
  <meta name="description" content="Cloud monitoring tools were built for ephemeral workloads. Bare metal servers fail in fundamentally different ways." />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/why-bare-metal-monitoring-is-different" />
  <meta property="og:title" content="Why bare metal monitoring is different" />
  <meta property="og:description" content="Cloud monitoring tools were built for ephemeral workloads. Bare metal servers fail in fundamentally different ways." />
  <meta property="og:image" content="https://glassmkr.com/og/why-bare-metal-monitoring-is-different.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="crucible rules --group-by category: STORAGE reallocated sectors and silent RAID degradation, HARDWARE CPU temp and PSU redundancy, NETWORK physical NIC errors and bond member down, OS OOM patterns and swap climb. 68 rules across 9 categories as of publication, none fire in a cloud APM" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Why bare metal monitoring is different" />
  <meta name="twitter:description" content="Cloud monitoring tools were built for ephemeral workloads. Bare metal servers fail in fundamentally different ways." />
  <meta name="twitter:image" content="https://glassmkr.com/og/why-bare-metal-monitoring-is-different.png?v=20260826" />
  <meta name="twitter:image:alt" content="Bare metal failure modes across storage, hardware, network, OS - none of which a cloud APM sees" />
  <link rel="canonical" href="https://glassmkr.com/blog/why-bare-metal-monitoring-is-different" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Why bare metal monitoring is different",
    description: "Cloud monitoring tools were built for ephemeral workloads. They track HTTP latency and container restarts. But when you run physical servers, the failure modes are fundamentally different: drives wear out, DIMM slots develop bit errors, fans fail silently, and RAID arrays degrade without anyone noticing.",
    image: "https://glassmkr.com/og/why-bare-metal-monitoring-is-different.png?v=20260826",
    datePublished: "2026-04-10",
    dateModified: "2026-04-10",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/why-bare-metal-monitoring-is-different.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/why-bare-metal-monitoring-is-different",
    articleSection: "Operations"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Why bare metal monitoring is different", item: "https://glassmkr.com/blog/why-bare-metal-monitoring-is-different" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <p class="post-meta">April 2026 · Operations</p>

    <h1>Why bare metal monitoring is different</h1>

    <p>Cloud monitoring tools were built for ephemeral workloads. They track HTTP latency and container restarts. But when you run physical servers, the failure modes are fundamentally different: drives wear out, DIMM slots develop bit errors, fans fail silently, and RAID arrays degrade without anyone noticing.</p>

    <h2>Cloud assumptions do not apply</h2>
    <p>In a cloud environment, the infrastructure is someone else's problem. If a VM host has a failing drive, AWS replaces it. If a network switch drops packets, Azure reroutes. Your monitoring focuses on application behavior because that is what you control.</p>
    <p>On bare metal, you own the full stack. A degrading NVMe drive does not send you an email. A fan spinning down from 8000 RPM to 2000 RPM does not trigger a PagerDuty alert. An IPMI sensor reading 85C on a CPU does not appear in your Grafana dashboard unless you built the check yourself.</p>

    <h2>Failure modes that matter</h2>
    <p>After a decade of operating bare metal across 60+ locations, we have seen the same patterns repeat. These are the categories of failure that cloud monitoring tools completely miss:</p>

    <h3>Storage degradation is gradual</h3>
    <p>Drives rarely fail suddenly. An HDD develops reallocated sectors over weeks. An SSD's wear leveling counter ticks down predictably. NVMe drives report available spare capacity that decreases over their lifespan. SMART data tells you exactly when a drive is approaching end of life, but only if something is reading and alerting on those attributes.</p>
    <p>RAID makes this worse. A degraded RAID array continues serving data normally. There is no performance impact, no application error, no user-visible symptom. But your redundancy is gone, and the next drive failure means data loss.</p>

    <h3>Hardware sensors need context</h3>
    <p>An IPMI temperature reading of 72C means nothing without context. Is this a CPU? Normal under load. An inlet temperature? Your cooling failed. A VRM? Check your airflow. A drive bay? Potentially dangerous.</p>
    <p>Generic monitoring tools that alert on "temperature > threshold" generate noise. Effective hardware monitoring needs to understand what each sensor means and what the appropriate response is.</p>

    <h3>Network errors are physical</h3>
    <p>In the cloud, network issues mean configuration problems or capacity limits. On bare metal, network errors often have physical causes: a loose cable, a failing SFP transceiver, a bad port on a switch. RX errors on a bonded interface might mean one member has a cable problem while the bond continues functioning at reduced capacity.</p>
    <p>These problems are invisible to application monitoring. Your service responds normally, just on a degraded link that could fail completely at any time.</p>

    <h3>OS-level signals get ignored</h3>
    <p>OOM kills happen and applications restart. Zombie processes accumulate. Time drift creeps in. Kernel security mitigations get disabled for performance. Swap usage slowly climbs. Each of these is a signal that something needs attention, but individually they rarely cause outages. Together, they paint a picture of a server heading toward trouble.</p>

    <h3>GPU and accelerator degradation is its own taxonomy</h3>
    <p>If you run inference, training, or any GPU workload on bare metal, the failure modes are different again. NVIDIA XID errors land in dmesg with cryptic codes that map to specific hardware faults: XID 79 is GPU fallen off the bus, XID 48 is double-bit ECC, XID 13 is graphics engine error. Generic monitoring treats them as log spam. ECC counters (correctable and uncorrected) drift up over the card's lifetime and predict failure long before the GPU goes offline. NVLink topology changes silently when a link drops out: the GPU is still present, but tensor-parallel workloads suddenly serialize across the surviving links. PCIe link-speed downgrades from Gen4 x16 to Gen3 x8 silently halve throughput, often after a thermal event reseated the link. Power-cap throttling shows up as quiet utilization drops, not errors. Driver and firmware drift across a fleet creates inconsistent behavior that's almost impossible to diagnose without per-node version visibility.</p>
    <p>None of these signals appear in a cloud APM. Most don't appear in vendor management tools either unless you're paying for the enterprise tier. We have written separately about <a href="/blog/gemma-4-l4-gpu-server-analysis">how this taxonomy applies to a real GPU server</a>: the same L4 box that runs our self-hosted inference is also a fleet member that surfaces every one of these signals.</p>

    <h2>What we built</h2>
    <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
    <p>This is why we built Glassmkr. The open-source agent (published on npm as <a href="https://www.npmjs.com/package/@glassmkr/crucible">@glassmkr/crucible</a> v0.13.3 at time of writing) is specifically built for the failure modes that bare metal operators encounter. 68 alert rules across 9 categories (storage, ZFS, filesystem, memory and CPU, network, hardware and BMC, time and services, security and patching, and GPU), each one based on a real incident we have dealt with. 30+ rules are verified end-to-end on real hardware. No configuration required because the thresholds come from operational experience, not guesswork.</p>
    <p>The hosted dashboard gives you fleet-level visibility, historical trends, and managed alerting. But the core insight is the same: bare metal monitoring needs to be purpose-built, not adapted from cloud tooling.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Glassmkr Free &rarr;</a>
    </div>
  </article>
</div>

<style>
  .container-narrow {
    max-width: 680px;
    margin: 0 auto;
    padding: 0 24px 80px;
    position: relative;
    z-index: 1;
  }

  article {
    padding-top: 48px;
  }
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
    font-size: 16px;
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

  a {
    color: var(--accent);
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
    transition: all 0.2s;
  }

  .btn-amber {
    background: rgba(245, 166, 35, 0.12);
    border: 1px solid rgba(245, 166, 35, 0.25);
    color: var(--accent);
  }

  .btn-amber:hover {
    background: rgba(245, 166, 35, 0.18);
    border-color: rgba(245, 166, 35, 0.35);
    text-decoration: none;
  }
</style>
