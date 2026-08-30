<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Configuration", item: "https://glassmkr.com/docs/configuration" },
    ],
  });
</script>

<svelte:head>
  <title>Configuration reference: Glassmkr documentation</title>
  <meta name="description" content="Full crucible.yaml schema for the current Crucible agent: collection toggles, dashboard connection, thresholds, notification channels, Prometheus listener." />
  <link rel="canonical" href="https://glassmkr.com/docs/configuration" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/configuration" />
  <meta property="og:title" content="Crucible configuration reference" />
  <meta property="og:description" content="Every field in /etc/glassmkr/crucible.yaml documented for the current Crucible agent." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Crucible configuration reference" />
  <meta name="twitter:description" content="Every crucible.yaml field documented for the current Crucible agent." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / CONFIGURATION</p>
      <h1>Configuration reference</h1>
      <p class="docs-subtitle">The Crucible agent reads <code>/etc/glassmkr/crucible.yaml</code> (legacy installs may have it at <code>/etc/glassmkr/collector.yaml</code>; the agent reads either, preferring the new name). This page documents every option the current agent accepts; the authoritative schema lives in the agent source at <a href="https://github.com/glassmkr/crucible/blob/main/src/config.ts">src/config.ts</a>.</p>
    </header>

    <section id="intro">
      <p>After editing the configuration, restart the service:</p>
      <pre><code>sudo systemctl restart glassmkr-crucible</code></pre>
      <p>Configuration is validated at startup. An out-of-range value (for example an interval below the one-minute minimum) is rejected with a message naming the field; see <a href="#validation">validation behavior</a> for how the agent treats typos and detection-disabling values.</p>
    </section>

    <section id="example">
      <h2><a href="#example" class="anchor-link">#</a>Full example</h2>
      <p>A complete file with every option at its default value (except <code>dashboard</code>, shown enabled with a key, which is what <code>init</code> writes). You only need to include the fields you want to change.</p>
      <pre><code>server_name: "my-server"

collection:
  interval_seconds: 300
  ipmi: true
  enforce_ipmitool_min_version: false
  smart: true
  thermal: true
  dmi: true

dashboard:
  enabled: true
  url: "https://app.glassmkr.com"
  api_key: "gmk_cru_live_your_key_here"
  tls_pin: ""
  allow_insecure_endpoint: false
  allowed_origins: []

thresholds:
  ram_percent: 90
  swap_alert: true
  disk_percent: 85
  iowait_percent: 20
  nvme_wear_percent: 85
  disk_latency_nvme_ms: 50
  disk_latency_hdd_ms: 200
  cpu_temp_warning_c: 80
  cpu_temp_critical_c: 90
  interface_utilization_percent: 90
  acknowledge_disabled_detection: false

channels:
  telegram:
    enabled: false
    bot_token: ""
    chat_id: ""
  email:
    enabled: false
    to: ""
  slack:
    enabled: false
    webhook_url: ""

prometheus:
  enabled: false
  address: "127.0.0.1"
  port: 9101</code></pre>
    </section>

    <section id="validation">
      <h2><a href="#validation" class="anchor-link">#</a>Validation behavior</h2>
      <p>Three behaviors are worth knowing before you edit:</p>
      <ul>
        <li><strong>Out-of-range values fail at startup</strong> with a message naming the field, so a bad edit cannot run silently.</li>
        <li><strong>Unknown keys under <code>collection:</code> produce a startup warning naming the key</strong> instead of an error. A typo like <code>enforce_ipmitool_min_versions</code> (plural) would otherwise silently leave the real setting at its default; the warning names the near-miss, and the agent keeps running, because an agent that refuses to start takes monitoring down with it.</li>
        <li><strong>Thresholds pushed to their limits count as disabled detection.</strong> A percent threshold at 100, or a latency threshold above 10,000 ms, effectively turns that detection off. The agent warns and flags the snapshot unless you set <code>thresholds.acknowledge_disabled_detection: true</code> to state that this is intentional.</li>
      </ul>
    </section>

    <section id="server-name">
      <h2><a href="#server-name" class="anchor-link">#</a><code>server_name</code></h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>server_name</code></td><td>string</td><td><code>unnamed-server</code></td><td>Display name for this server in the Dashboard. <code>init</code> writes the system hostname here.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="collection">
      <h2><a href="#collection" class="anchor-link">#</a><code>collection</code></h2>
      <p>What is collected and how often. Collectors not listed here (RAID, ZFS, GPU, network, security posture, and the rest) run automatically and skip themselves on hosts where their subsystem is absent; they have no config switches.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>interval_seconds</code></td><td>int</td><td><code>300</code></td><td>Snapshot interval in seconds. Minimum 60, maximum 3600; a value outside the bounds is rejected at startup.</td></tr>
            <tr><td><code>ipmi</code></td><td>bool</td><td><code>true</code></td><td>Collect IPMI sensors, SEL events, and PSU state. Requires <code>ipmitool</code> and a BMC; skipped cleanly where absent.</td></tr>
            <tr><td><code>enforce_ipmitool_min_version</code></td><td>bool</td><td><code>false</code></td><td>Refuse IPMI collection when <code>ipmitool -V</code> reads below 1.8.19 (CVE-2020-5208). Off by default because the version check cannot see distro backports, so on stock Ubuntu 20.04/22.04 and RHEL-family 9 it fires on suspicion and silently disables BMC monitoring. Turn it on if you model BMC compromise.</td></tr>
            <tr><td><code>smart</code></td><td>bool</td><td><code>true</code></td><td>Collect SMART health from disks. Requires <code>smartmontools</code>; skipped cleanly where absent.</td></tr>
            <tr><td><code>thermal</code></td><td>bool</td><td><code>true</code></td><td>Collect temperature readings (hwmon, with IPMI as an additional source).</td></tr>
            <tr><td><code>dmi</code></td><td>bool</td><td><code>true</code></td><td>Collect DMI hardware identity (vendor, board, BIOS) for the server detail page.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="dashboard">
      <h2><a href="#dashboard" class="anchor-link">#</a><code>dashboard</code></h2>
      <p>Connection settings for the Dashboard API, hosted or self-hosted.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>enabled</code></td><td>boolean</td><td><code>false</code></td><td>Enable pushing snapshots to the Dashboard. <code>init</code> writes <code>true</code>.</td></tr>
            <tr><td><code>url</code></td><td>string</td><td><code>https://app.glassmkr.com</code></td><td>Dashboard base URL. Self-hosted instances point this at their own origin. Validated at startup: HTTPS is required unless the endpoint qualifies under <code>allow_insecure_endpoint</code> or <code>allowed_origins</code>.</td></tr>
            <tr><td><code>api_key</code></td><td>string</td><td><em>required</em></td><td>Per-server collector key (<code>gmk_cru_live_xxx</code>; older agents may still have <code>col_xxx</code>). Issued once when the server is enrolled; rotate via <code>POST /api/v1/servers/&#123;id&#125;/rotate-key</code> or the dashboard.</td></tr>
            <tr><td><code>tls_pin</code></td><td>string</td><td><code>""</code></td><td>Optional SPKI pin for the dashboard endpoint's certificate. When set, connections to an endpoint whose key does not match are refused.</td></tr>
            <tr><td><code>allow_insecure_endpoint</code></td><td>bool</td><td><code>false</code></td><td>Permit a plain-HTTP dashboard URL. Meant for self-hosted lab setups; never use it across a network you do not control.</td></tr>
            <tr><td><code>allowed_origins</code></td><td>list</td><td><code>[]</code></td><td>Additional origins accepted by the endpoint validator beyond the default rules, for self-hosted deployments with unusual addressing.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="thresholds">
      <h2><a href="#thresholds" class="anchor-link">#</a><code>thresholds</code></h2>
      <p>Agent-side detection thresholds. Percent thresholds accept 1 to 100. Rule behavior beyond these knobs (severities, evidence, remediation) is documented per rule in the <a href="/docs/rules">alert rules catalog</a>; rules can also be muted per server from the Dashboard.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>ram_percent</code></td><td>number</td><td><code>90</code></td><td>RAM usage percent above which memory pressure is flagged.</td></tr>
            <tr><td><code>swap_alert</code></td><td>bool</td><td><code>true</code></td><td>Flag active swapping.</td></tr>
            <tr><td><code>disk_percent</code></td><td>number</td><td><code>85</code></td><td>Filesystem usage percent above which disk space is flagged.</td></tr>
            <tr><td><code>iowait_percent</code></td><td>number</td><td><code>20</code></td><td>CPU iowait percent above which I/O wait is flagged.</td></tr>
            <tr><td><code>nvme_wear_percent</code></td><td>number</td><td><code>85</code></td><td>NVMe percentage-used above which wear is flagged.</td></tr>
            <tr><td><code>disk_latency_nvme_ms</code></td><td>number</td><td><code>50</code></td><td>NVMe latency in milliseconds above which latency is flagged.</td></tr>
            <tr><td><code>disk_latency_hdd_ms</code></td><td>number</td><td><code>200</code></td><td>HDD/SATA latency in milliseconds above which latency is flagged.</td></tr>
            <tr><td><code>cpu_temp_warning_c</code></td><td>number</td><td><code>80</code></td><td>CPU temperature warning threshold, Celsius. Must be below the critical threshold.</td></tr>
            <tr><td><code>cpu_temp_critical_c</code></td><td>number</td><td><code>90</code></td><td>CPU temperature critical threshold, Celsius.</td></tr>
            <tr><td><code>interface_utilization_percent</code></td><td>number</td><td><code>90</code></td><td>Interface utilization percent above which saturation is flagged.</td></tr>
            <tr><td><code>acknowledge_disabled_detection</code></td><td>bool</td><td><code>false</code></td><td>Acknowledge that thresholds set to their limits intentionally disable detection; silences the startup warning and the snapshot flag.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="channels">
      <h2><a href="#channels" class="anchor-link">#</a><code>channels</code></h2>
      <p>Agent-side notification channels for standalone operation. When the agent reports to a Dashboard, notification routing normally lives there (six channel types, per-priority routing); these agent-side channels exist so a standalone agent can still page someone.</p>
      <h3><code>channels.telegram</code></h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>enabled</code></td><td>bool</td><td><code>false</code></td><td>Send agent-side alerts to Telegram.</td></tr>
            <tr><td><code>bot_token</code></td><td>string</td><td><code>""</code></td><td>Bot token from @BotFather.</td></tr>
            <tr><td><code>chat_id</code></td><td>string</td><td><code>""</code></td><td>Target chat id.</td></tr>
          </tbody>
        </table>
      </div>
      <h3><code>channels.email</code></h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>enabled</code></td><td>bool</td><td><code>false</code></td><td>Send agent-side alerts by email (requires a local MTA).</td></tr>
            <tr><td><code>to</code></td><td>string</td><td><code>""</code></td><td>Recipient address.</td></tr>
          </tbody>
        </table>
      </div>
      <h3><code>channels.slack</code></h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>enabled</code></td><td>bool</td><td><code>false</code></td><td>Send agent-side alerts to a Slack webhook.</td></tr>
            <tr><td><code>webhook_url</code></td><td>string</td><td><code>""</code></td><td>Incoming webhook URL.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="prometheus">
      <h2><a href="#prometheus" class="anchor-link">#</a><code>prometheus</code></h2>
      <p>An optional local metrics listener. Off by default: with it off, the agent opens no inbound ports at all.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>enabled</code></td><td>bool</td><td><code>false</code></td><td>Serve Prometheus metrics from the agent.</td></tr>
            <tr><td><code>address</code></td><td>string</td><td><code>127.0.0.1</code></td><td>Listen address. Loopback by default; widen deliberately.</td></tr>
            <tr><td><code>port</code></td><td>int</td><td><code>9101</code></td><td>Listen port, 1 to 65535.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="env">
      <h2><a href="#env" class="anchor-link">#</a>Environment variables</h2>
      <p>The running agent is configured by <code>crucible.yaml</code> only; it does not read configuration overrides from the environment. Two variables exist around the edges of the install flow:</p>
      <ul>
        <li><code>GLASSMKR_API_KEY</code>: read by the install script as an alternative to passing <code>--api-key</code> (<code>curl -sf https://glassmkr.com/install.sh | sudo GLASSMKR_API_KEY=... bash</code>). The script hands it to <code>glassmkr-crucible init</code>, which writes it into <code>crucible.yaml</code>; the agent then reads the file.</li>
        <li><code>GLASSMKR_UBUNTU_PRO_TOKEN</code>: optional; read by the agent's CVE collector to query the Ubuntu Pro security feed.</li>
      </ul>
      <p class="note">Last verified: 2026-08-29 against the Crucible v1.1.0 config schema (src/config.ts).</p>
    </section>
  </article>

<style>
  section { margin-bottom: 3.5rem; scroll-margin-top: 80px; }
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.75rem; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 14px 16px; overflow-x: auto; margin: 0.75rem 0 1.25rem; }
  pre code { font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.65; color: var(--text-primary); background: transparent; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.875rem; }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
