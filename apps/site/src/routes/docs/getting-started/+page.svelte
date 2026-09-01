<script lang="ts">
  import rules from "$lib/data/rules.json";
  import { FALLBACK_CRUCIBLE_VERSION as AGENT_VERSION } from "$lib/crucible-version";
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Getting started", item: "https://glassmkr.com/docs/getting-started" },
    ],
  });
</script>

<svelte:head>
  <title>Getting started: Glassmkr documentation</title>
  <meta name="description" content="Install Crucible and ship your first server snapshot to Glassmkr in about five minutes. Linux server, one collector key, one install command." />
  <link rel="canonical" href="https://glassmkr.com/docs/getting-started" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/getting-started" />
  <meta property="og:title" content="Getting started with Glassmkr" />
  <meta property="og:description" content="Register a server, install Crucible, verify the first snapshot. About five minutes end to end." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Getting started with Glassmkr" />
  <meta name="twitter:description" content="Install Crucible and ship your first snapshot. Five minutes end to end." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / GETTING STARTED</p>
      <h1>Getting started</h1>
      <p class="docs-subtitle">Register a server, install the Crucible agent, see the first snapshot. About five minutes end to end.</p>
    </header>

    <section id="overview">
      <h2><a href="#overview" class="anchor-link">#</a>Overview</h2>
      <p>Glassmkr has two parts:</p>
      <ul>
        <li><strong>Dashboard</strong> is the hosted service at <a href="https://app.glassmkr.com">app.glassmkr.com</a>. It stores your data, evaluates alerts, and renders server health.</li>
        <li><strong>Crucible</strong> is the open-source (AGPL-3.0-only) agent. It runs on your server, collects health data, and pushes snapshots to the Dashboard.</li>
      </ul>
      <p>You register a server in the Dashboard (which gives you a collector key), then install Crucible on that server with the key. That is the entire flow for a single server.</p>
      <div class="callout">
        <strong>Want it on your own hardware?</strong> The whole stack self-hosts with one compose file: see <a href="/docs/self-hosting">/docs/self-hosting</a>. The steps below cover the hosted service.
      </div>
      <div class="callout">
        <strong>Automating, or onboarding many servers?</strong> The whole flow runs over the API, no dashboard clicks. A <code>write</code>-scoped account key (<code>gmk_acct_live_</code>) creates each server with <code>POST /api/v1/servers</code>, and the response returns that server's collector key. See the <a href="/docs/programmatic-api">Programmatic API quickstart</a>.
      </div>
      <p class="note">Last verified: 2026-08-30 against Crucible v1.1.1 (fresh installs on four validation hosts: Rocky, Debian, Alma, Ubuntu).</p>
    </section>

    <section id="prerequisites">
      <h2><a href="#prerequisites" class="anchor-link">#</a>Prerequisites</h2>
      <ul>
        <li>A Linux server. Debian, Ubuntu, RHEL, Rocky, Alma and Fedora can use the one-line installer; Arch, Alpine and anything without apt or dnf use the single-file binary, which needs no Node. See step 3.</li>
        <li>Root or sudo access.</li>
        <li>Outbound HTTPS (port 443) to <code>app.glassmkr.com</code>. No inbound ports required.</li>
      </ul>
    </section>

    <section id="step-1">
      <h2><a href="#step-1" class="anchor-link">#</a>Step 1: Create a Dashboard account</h2>
      <p>Go to <a href="https://app.glassmkr.com/#register">app.glassmkr.com</a> and sign up with email, Google, or GitHub. Hosted accounts are free, with a 10-node per-account cap (a capacity protection, not a tier) and 90-day retention.</p>
    </section>

    <section id="step-2">
      <h2><a href="#step-2" class="anchor-link">#</a>Step 2: Register a server</h2>
      <p>After logging in, click <strong>+ Add Server</strong>. Enter a name (for example, <code>web-01</code> or <code>db-prod</code>).</p>
      <p>The Dashboard generates a <strong>collector key</strong> that starts with <code>gmk_cru_live_</code>. This key is shown once. Copy it. Servers created before Crucible 0.9.0 may have a legacy <code>col_xxx</code> key; both formats work.</p>
      <div class="callout">
        <strong>What is this key?</strong> The collector key (<code>gmk_cru_live_xxx</code>) authenticates snapshot pushes from this specific server to the Dashboard. Each server gets its own key, scoped to that server's telemetry only. This is different from the account API key (<code>gmk_acct_live_xxx</code>) in Settings, which is for programmatic API access from automation like Ansible, Terraform, or scripts.
      </div>
    </section>

    <section id="step-3">
      <h2><a href="#step-3" class="anchor-link">#</a>Step 3: Install Crucible</h2>
      <p>SSH into your server. There are three ways in, and which one you use depends on your distribution.</p>

      <h3>Bootstrap installer (apt and dnf/yum families)</h3>
      <p>The dashboard shows this command with your collector key pre-filled:</p>
      <pre><code>curl -sf https://glassmkr.com/install.sh | sudo bash -s -- --api-key gmk_cru_live_your_key_here</code></pre>
      <div class="callout">
        <strong>This script supports the apt and dnf/yum families</strong> (Debian, Ubuntu, RHEL, Rocky, Alma, Fedora, CentOS). It installs distribution packages and a Node runtime for those. On other distributions (Arch, Alpine, and anything without apt or dnf) use the single-file binary below.
      </div>
      <p>The installer:</p>
      <ul>
        <li>Installs Node.js 24 if not present.</li>
        <li>Installs <code>smartmontools</code> (SMART disk monitoring).</li>
        <li>Installs <code>ipmitool</code> if available (IPMI hardware monitoring).</li>
        <li>Runs <code>glassmkr-crucible init</code> to validate the key against the Dashboard, write <code>/etc/glassmkr/crucible.yaml</code> (mode 0600; migrates a pre-0.13.5 <code>/etc/glassmkr/collector.yaml</code> in place when present), and install the systemd unit.</li>
        <li>Starts the <code>glassmkr-crucible</code> service (runs as the non-root <code>glassmkr</code> user).</li>
      </ul>
      <p><strong>Reading the key from a password manager?</strong> Pipe it through stdin:</p>
      <pre><code>op read "op://Private/Dashboard/key" | sudo glassmkr-crucible init --api-key -</code></pre>
      <p>The legacy <code>--dashboard-key</code> flag is preserved as an alias for <code>--api-key</code> so existing Ansible or Terraform automation keeps working without changes.</p>

      <h3>Single-file binary (any distribution, no Node required)</h3>
      <p>The release binaries bundle their own runtime, so a host with no Node can run them. This is the path for RHEL family, Arch and Alpine, and it works on Debian family too:</p>
      <pre><code>curl -fsSLO https://github.com/glassmkr/crucible/releases/download/v{AGENT_VERSION}/glassmkr-crucible-linux-x64
curl -fsSLO https://github.com/glassmkr/crucible/releases/download/v{AGENT_VERSION}/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
sudo install -m 0755 glassmkr-crucible-linux-x64 /usr/local/bin/glassmkr-crucible
sudo glassmkr-crucible init --api-key gmk_cru_live_your_key_here</code></pre>
      <p>Use <code>glassmkr-crucible-linux-arm64</code> on arm64. Each binary carries a build-provenance attestation; the <a href="/trust">Trust page</a> shows how to check one without a GitHub account.</p>
      <p>The binary does not bundle system tools, so install those separately for SMART and IPMI data:</p>
      <pre><code>sudo dnf install -y smartmontools ipmitool     # RHEL, Rocky, Alma
sudo apt install -y smartmontools ipmitool     # Debian, Ubuntu</code></pre>

      <h3>npm install (any distribution with Node 22.19.0 or newer)</h3>
      <p>If you would rather not pipe to bash, and the host already has a recent Node:</p>
      <pre><code>sudo npm install -g @glassmkr/crucible
sudo glassmkr-crucible init --api-key gmk_cru_live_your_key_here</code></pre>

      <p>Check with <code>node -v</code> first. Several distributions still ship Node 16 or 18 by default, including AlmaLinux and Rocky, and the agent refuses to start below 22.19.0. Either add your distribution's current Node repository, or use the binary above and skip Node entirely.</p>
      <p>Run <code>glassmkr-crucible init --help</code> to see the full flag list (custom server name, alternate Dashboard URL, etc.).</p>
      <p><strong>Already installed, or moving this box to a different account/key?</strong> A plain <code>init</code> preserves the existing config and keeps the old key. To switch, add <code>--force</code>: <code>sudo glassmkr-crucible init --api-key - --force</code>. The one-line installer above always passes <code>--force</code>, so re-running it re-points the agent.</p>
    </section>

    <section id="step-4">
      <h2><a href="#step-4" class="anchor-link">#</a>Step 4: Verify</h2>
      <p>Check that Crucible is running:</p>
      <pre><code>sudo systemctl status glassmkr-crucible</code></pre>
      <p>You should see <code>active (running)</code>. Check the logs for the first collection:</p>
      <pre><code>sudo journalctl -u glassmkr-crucible --since "5 min ago" --no-pager</code></pre>
      <p>Expected output (the first collection may take a few seconds longer than later ones):</p>
      <pre><code>[collector] Starting. Server: web-01. Interval: 60s
[collector] IPMI: enabled, SMART: enabled
[collector] Dashboard: https://app.glassmkr.com
[collector] Collecting...
[collector] Collected in 1013ms. Alerts: 0 active, 0 new, 0 resolved

=== First collection complete ===
Server: web-01 (Ubuntu 24.04 LTS)
CPU:    5.3% (load: 0.14)
RAM:    12.1% (1940 / 16036 MB)
Disk:   23% (/)
SMART:  2 drive(s) checked
Network: eth0, eth1
IPMI:   available
Active alerts: 0
Dashboard: enabled

[dashboard] Push successful. Active alerts: 0</code></pre>
      <p>Within about five minutes (one collection interval), the server appears on the <a href="https://app.glassmkr.com">Dashboard</a> with live data. The Dashboard evaluates all {rules.length} alert rules on each push.</p>
      <p class="note">Last verified: 2026-05-22. Default snapshot interval is 300 seconds (five minutes); the minimum is 60.</p>
    </section>

    <section id="keys">
      <h2><a href="#keys" class="anchor-link">#</a>Two kinds of keys</h2>
      <p>Glassmkr uses two key types:</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key type</th><th>Prefix</th><th>Created where</th><th>Used by</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Collector key</strong></td>
              <td><code>gmk_cru_live_</code> (legacy: <code>col_</code>)</td>
              <td>Dashboard: + Add Server</td>
              <td>Crucible agent</td>
              <td>Authenticates snapshot pushes from one specific server. Scoped to that server; cannot list other servers or read account settings.</td>
            </tr>
            <tr>
              <td><strong>Account API key</strong></td>
              <td><code>gmk_acct_live_</code></td>
              <td>Settings: API keys (every account)</td>
              <td>Automation: Ansible, Terraform, scripts, MCP clients</td>
              <td>Programmatic access to your account (list servers, query health, mutate state). On every account, with read, write, or admin scope; bounded by the hosted 10-node cap and rate limits.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="next">
      <h2><a href="#next" class="anchor-link">#</a>Next steps</h2>
      <ul>
        <li><a href="/docs/channels">Set up notification channels</a> (email, Telegram, Slack, Discord, PagerDuty, webhooks) with per-channel priority filtering.</li>
        <li><a href="/docs/rules">Review the {rules.length} alert rules</a> grouped across 9 categories.</li>
        <li><a href="/docs/configuration">Explore the full configuration reference</a> for thresholds, intervals, and optional collectors.</li>
        <li><a href="/docs/api">API reference</a> for programmatic access.</li>
      </ul>
    </section>
  </article>

<style>
  section { margin-bottom: 3.5rem; scroll-margin-top: 80px; }
  h3 { font-size: 1.1rem; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.75rem; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 14px 16px; overflow-x: auto; margin: 0.75rem 0 1.25rem; }
  pre code { font-family: var(--font-mono); font-size: 0.84rem; line-height: 1.65; color: var(--text-primary); background: transparent; padding: 0; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); line-height: 1.6; font-style: italic; margin-top: 1rem; }
  .callout { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid var(--accent); border-radius: var(--radius-md); padding: 14px 16px; margin: 16px 0; font-size: 0.9rem; line-height: 1.65; color: var(--text-secondary); }
  .callout strong { color: var(--accent); }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.875rem; }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
