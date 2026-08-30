<svelte:head>
  <title>IPMI, SMART, and RAID: the hardware monitoring gap - Glassmkr Blog</title>
  <meta name="description" content="Most monitoring stops at the OS layer. Here is what lives below it, why mainstream tools miss it, and what good hardware monitoring looks like." />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/ipmi-smart-raid-hardware-monitoring" />
  <meta property="og:title" content="IPMI, SMART, and RAID: the hardware monitoring gap" />
  <meta property="og:description" content="Most monitoring stops at the OS layer. Here is what lives below it, why mainstream tools miss it, and what good hardware monitoring looks like." />
  <meta property="og:image" content="https://glassmkr.com/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="crucible alerts --by-priority: P1 SMART health FAILING replace now, P2 RAID degraded intervene today, P3 reallocated sectors rising plan replacement, P4 ECC errors review monthly" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="IPMI, SMART, and RAID: the hardware monitoring gap" />
  <meta name="twitter:description" content="Most monitoring stops at the OS layer. Here is what lives below it, why mainstream tools miss it, and what good hardware monitoring looks like." />
  <meta name="twitter:image" content="https://glassmkr.com/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830" />
  <meta name="twitter:image:alt" content="Priority-ordered hardware alerts: P1 SMART failing, P2 RAID degraded, P3 reallocated sectors rising, P4 ECC errors" />
  <link rel="canonical" href="https://glassmkr.com/blog/ipmi-smart-raid-hardware-monitoring" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "IPMI, SMART, and RAID: the hardware monitoring gap",
    description: "Most monitoring stops at the OS layer. Here is what lives below it, why mainstream tools miss it, and what good hardware monitoring looks like.",
    image: "https://glassmkr.com/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830",
    datePublished: "2026-04-10",
    dateModified: "2026-04-10",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/ipmi-smart-raid-hardware-monitoring",
    articleSection: "Operations"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "IPMI, SMART, and RAID", item: "https://glassmkr.com/blog/ipmi-smart-raid-hardware-monitoring" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/ipmi-smart-raid-hardware-monitoring.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title IPMI, SMART, and RAID: The Hardware Layer Your Cloud Monitoring Tool Ignores" width="1200" height="630" loading="eager" decoding="async" />
    <p class="post-meta">April 2026 · Operations</p>

    <h1>IPMI, SMART, and RAID: the hardware monitoring gap</h1>

    <p>If you run physical servers, your monitoring stack almost certainly has a blind spot. Most observability platforms start their coverage at the operating system: CPU utilization, memory pressure, disk space, process health. These are useful signals. But the hardware layer underneath the OS is what ultimately determines whether your server stays online, and that layer is where the most consequential failures begin.</p>

    <p>A drive does not fail between one health check and the next. It degrades over weeks, accumulating reallocated sectors, reporting rising temperatures, and quietly exhausting its spare capacity. A RAID array can lose a member disk and continue serving reads and writes without a single application error. A CPU can run at 95C for days because a fan failed and nobody was watching the IPMI sensor. These are not edge cases. They are the normal failure progression on bare metal infrastructure, and they are invisible to any monitoring tool that only talks to the OS.</p>

    <h2>What lives below the OS</h2>

    <p>Three subsystems provide health data about physical hardware, each with its own protocol, tooling, and failure semantics. Understanding them is the first step toward closing the monitoring gap.</p>

    <h3>IPMI and the baseboard management controller</h3>

    <p>IPMI (Intelligent Platform Management Interface) is a specification for out-of-band hardware management. Every enterprise server ships with a BMC (Baseboard Management Controller), a small embedded system that runs independently of the host OS. The BMC has its own network interface, its own firmware, and access to dozens of hardware sensors: CPU temperature, inlet and exhaust air temperature, fan speeds, power supply status, voltage rails, and memory health.</p>

    <p>You interact with the BMC through <code>ipmitool</code> on the host, or over the network via IPMI LAN. Each server vendor ships their own BMC implementation with its own web interface: Dell iDRAC, HP iLO, Supermicro IPMI, Lenovo XClarity. The underlying sensor data is standardized enough that <code>ipmitool sdr</code> returns a consistent list of sensor readings across vendors.</p>

    <p>The BMC also maintains a System Event Log (SEL) that records critical hardware events: ECC memory errors (both correctable and uncorrectable), power supply redundancy loss, PCI bus errors, and thermal shutdowns. This log persists across reboots and OS reinstalls. It is the black box recorder for your server, and most monitoring setups never read it.</p>

    <h3>SMART and drive health</h3>

    <p>SMART (Self-Monitoring, Analysis and Reporting Technology) is built into every HDD, SSD, and NVMe drive manufactured in the last two decades. The drive firmware tracks internal health metrics and exposes them through a standard interface. On Linux, <code>smartctl</code> reads these attributes.</p>

    <p>The attributes that matter vary by drive type. For HDDs, watch reallocated sector count, current pending sector count, and seek error rate. For SATA SSDs, monitor wear leveling count, program fail count, and erase fail count. For NVMe drives, the critical attributes are percentage used, available spare, and media errors. All drives report temperature and power-on hours.</p>

    <p>SMART also provides a binary overall health status. When the drive firmware determines that failure is imminent, it sets the health status to "FAILING." This is the last warning before data loss. But by the time this flag is set, the drive may already be unreliable. The individual attributes give you far more lead time if you monitor them continuously.</p>

    <h3>RAID and array health</h3>

    <p>Software RAID (managed by <code>mdadm</code> on Linux) and hardware RAID controllers add a layer of redundancy that makes drive failures survivable. A RAID 1 mirror or RAID 5/6 array can lose one or more member disks and continue operating normally. The problem is that "operating normally" means your applications see no errors, your users notice no downtime, and your monitoring reports green across the board.</p>

    <p>A degraded RAID array is a time bomb. Your redundancy is gone. If another drive in the array fails before the rebuild completes, you lose data. Rebuilds themselves are dangerous because they stress every surviving drive with sustained sequential reads, which is exactly the kind of workload that exposes latent defects. The longer a degraded array goes unnoticed, the higher the risk.</p>

    <p><code>mdadm --detail</code> reports array state, active devices, and rebuild progress. <code>cat /proc/mdstat</code> gives a quick summary. Both are trivial to check, yet surprisingly few monitoring setups include them.</p>

    <h3>GPU and accelerator telemetry</h3>

    <p>If you run GPU workloads, the failure surface expands again. NVIDIA GPUs expose health and error data through <code>nvidia-smi</code> (every driver install) and DCGM (data center GPU manager, for the deeper telemetry). The signals that matter, none of which appear in OS-level monitoring: XID error codes in dmesg (cryptic numeric identifiers for specific hardware faults; XID 79 is GPU fallen off the bus, XID 48 is double-bit ECC, XID 13 is graphics-engine error), ECC counters both correctable and uncorrected, PCIe link speed and width (a Gen4 x16 link that downgrades to Gen3 x8 silently halves throughput), NVLink topology and per-link status, thermal trip events, power-cap throttling that reduces utilization quietly without raising an error, retired-page counts that grow as the card ages, and driver / firmware versions that drift across a fleet. On HPE / Dell ProLiant hardware, vendor-side Redfish endpoints carry the same telemetry through the BMC; the OEM stub-parser path is how we surface those signals without locking customers into a vendor management tool.</p>

    <p>This data is available on every GPU server, and almost none of it is in your application monitoring tool. <a href="/blog/gemma-4-l4-gpu-server-analysis">Our own L4 inference server is monitored with the same agent</a>; nothing about GPU monitoring lives in a different tool from the rest of the fleet.</p>

    <h2>The monitoring gap</h2>

    <p>The mainstream observability platforms were built for cloud-native workloads. Their core product is designed around application performance monitoring, distributed tracing, log aggregation, and container orchestration. Hardware monitoring, when it exists, is a secondary concern.</p>

    <p>To be fair, the major players do offer hardware monitoring capabilities. Datadog integrates with MetricsHub for IPMI and SMART data. New Relic has partnerships with Hardware Sentry for physical infrastructure telemetry. Grafana Cloud supports community-maintained collectors for IPMI and smartctl. These are real solutions that work.</p>

    <p class="provenance"><em>Last verified: 2026-05-21.</em></p>

    <p>But they are afterthoughts, not defaults. They require additional agents, separate configuration, third-party integrations, and often a higher pricing tier. When you install the Datadog agent on a bare metal server, it does not start collecting IPMI sensor readings out of the box. You need to discover that the integration exists, configure it, verify that the right tools are installed on the host, and map the sensor data into your existing alerting rules.</p>

    <p>The result is that hardware monitoring becomes the thing that gets set up "later" and then never gets set up at all. The server runs for months with its OS-level metrics looking healthy. Then a drive fails, and the postmortem reveals that SMART had been warning about it for six weeks. Or a CPU throttles under load because a fan died, and nobody knew because IPMI sensor data was not being collected.</p>

    <p>Traditional infrastructure monitoring tools like Nagios, Zabbix, and Icinga can absolutely monitor hardware. They have plugins for IPMI, SMART, and RAID. But they require manual configuration for every check, every threshold, every server. If you have 10 servers, this is manageable. At 100 servers with different hardware vendors and drive models, the configuration burden becomes its own operational problem.</p>

    <h2>What good hardware monitoring looks like</h2>

    <p>Regardless of which tool you use, effective hardware monitoring shares a few characteristics.</p>

    <h3>Continuous collection, not periodic checks</h3>

    <p>Hardware degradation is a trend, not an event. A drive's reallocated sector count that jumps from 0 to 4 in a week is a very different signal than one that has been at 4 for three years. Temperature spikes that correlate with load are normal; a baseline shift of 10C over a month means your thermal paste is drying out or a fan is failing. You need time-series data, not point-in-time snapshots, to distinguish dangerous trends from stable baselines.</p>

    <h3>The right thresholds</h3>

    <p>Not all hardware alerts are created equal. A good monitoring system assigns severity based on operational impact:</p>

    <ul>
      <li><strong>P1 Urgent:</strong> Data loss is imminent or actively occurring. Examples: SMART health status FAILING, RAID array with multiple failed members, uncorrectable ECC memory errors.</li>
      <li><strong>P2 High:</strong> The problem is service-impacting or will become P1 without intervention. Examples: degraded RAID array, CPU temperature exceeding safe limits, power supply redundancy lost.</li>
      <li><strong>P3 Medium:</strong> Something is degrading and needs attention during business hours. Examples: rising reallocated sector count, NVMe spare capacity below threshold, fan speed dropping.</li>
      <li><strong>P4 Low:</strong> Informational signals that may warrant investigation. Examples: correctable ECC errors, drive power-on hours approaching rated lifespan, SEL entries for non-critical events.</li>
    </ul>

    <p>Flat threshold alerting ("temperature above X") generates noise. Priority-based alerting tells you what to fix first.</p>

    <h3>Actionable diagnostics</h3>

    <p>An alert that says "SMART check failed" is almost useless. An alert that says "Drive /dev/sda (Samsung PM883, serial SN1234, in RAID array md0) has 12 reallocated sectors, up from 0 last week. Run <code>smartctl -a /dev/sda</code> to inspect. Consider scheduling a replacement." gives you everything you need to act.</p>

    <p>Good hardware alerts include the affected device, the specific metric, its recent trend, evidence links to the relevant data, and the diagnostic command to run next.</p>

    <h3>Cross-layer correlation</h3>

    <p>Hardware problems manifest at every layer of the stack. A failing drive causes elevated iowait, which causes application latency, which causes user-facing errors. If your hardware monitoring is in a separate tool from your application monitoring, you end up chasing the symptom instead of the cause.</p>

    <p>The most useful setup puts hardware metrics, OS metrics, and application metrics in the same timeline so you can see that the latency spike at 14:32 correlates with a RAID rebuild that started at 14:30 because a drive was removed at 14:28 due to rising error rates visible in SMART data since last Tuesday.</p>

    <h2>How Crucible handles this</h2>

    <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
    <p><a href="https://github.com/glassmkr/crucible">Crucible</a> (v0.13.3 at time of writing) is our open-source monitoring agent, MIT licensed, built specifically for bare metal servers. It is not a general-purpose collector. It collects the data that matters for physical infrastructure health and applies 68 opinionated alert rules across 9 categories based on real operational experience.</p>

    <p class="license-note">Editorial note, August 2026: Crucible versions through 1.0.1 were MIT licensed. Version 1.1.0 and later are AGPL-3.0-only.</p>

    <p>On every collection cycle, Crucible reads from <code>smartctl</code>, <code>ipmitool</code>, <code>mdadm</code>, <code>nvidia-smi</code>, <code>/proc</code>, and <code>/sys</code> to build a complete health snapshot. SMART attributes for every drive: temperature, reallocated sectors, wear leveling, power-on hours, overall health status. IPMI sensor readings: CPU temperature, fan speeds, power supply status, voltage rails. RAID array state: active members, degraded status, rebuild progress. GPU telemetry: XID errors, ECC counters, PCIe link speed, NVLink topology, thermal and power state. OS metrics: per-core CPU, memory, swap, disk space, network interface errors.</p>

    <p>Each alert rule is assigned a priority level (P0 through P4) and includes evidence, diagnostic commands, and context about why the alert matters. Alerts fire through Dashboard with notifications to Slack, Telegram, or email. The AI analysis layer (Furnace) correlates alerts across the hardware and OS layers to surface root causes rather than symptoms.</p>

    <p>There is no configuration file. You install Crucible, and it starts collecting everything relevant to the hardware it detects. If the server has an IPMI BMC, it reads IPMI sensors. If it has SMART-capable drives, it reads SMART data. If it has mdadm arrays, it checks RAID health. You do not need to tell it what to monitor.</p>

    <h2>Getting started</h2>

    <p>Crucible runs on Linux servers. Install it with a single command:</p>

    <pre><code>curl -sf https://glassmkr.com/install.sh | bash</code></pre>

    <p>The installer registers the server with <a href="https://app.glassmkr.com/register">Dashboard</a>, sets up the systemd service, and begins collecting data within minutes. For the full list of alert rules and configuration details, see the <a href="https://glassmkr.com/docs/rules">rules catalog</a> on the marketing site or the <a href="https://github.com/glassmkr/crucible">Crucible source on GitHub</a>. If you want a deeper IPMI-specific walkthrough, see our <a href="/blog/ipmi-diagnostics-bare-metal">practitioner guide to IPMI diagnostics on bare metal</a>.</p>

    <h2>Hardware degrades before it fails</h2>

    <p>The central lesson of operating physical infrastructure is that hardware failures are almost never sudden. Drives report problems weeks before they die. Temperatures climb gradually as cooling degrades. RAID arrays lose redundancy silently. ECC memory accumulates correctable errors before producing uncorrectable ones.</p>

    <p>Every one of these degradation signals is available through standard interfaces that have existed for years: IPMI, SMART, mdadm. The data is there. The question is whether your monitoring stack is collecting it.</p>

    <p>Whether you use Crucible, build your own collection with Prometheus exporters, or configure IPMI plugins in your existing monitoring platform, the important thing is to close this gap. OS-level monitoring tells you how your server is performing right now. Hardware monitoring tells you whether it will still be performing tomorrow.</p>

    <div class="post-footer">
      <a href="https://app.glassmkr.com/register" class="btn-page btn-amber">Try Dashboard Free &rarr;</a>
    </div>
  </article>
</div>

<style>
  .license-note { font-size: 13px; color: var(--text-tertiary); border-left: 2px solid var(--surface-border); padding-left: 12px; line-height: 1.6; }
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
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

  .provenance {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: -8px;
    margin-bottom: 24px;
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

  ul {
    padding-left: 20px;
    margin-bottom: 16px;
  }

  li {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 8px;
  }

  li strong {
    color: var(--text-primary);
  }

  pre {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 14px 18px;
    margin: 16px 0;
    overflow-x: auto;
  }

  code {
    font-size: 13px;
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
