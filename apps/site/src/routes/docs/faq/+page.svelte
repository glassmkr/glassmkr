<script lang="ts">
  import rules from "$lib/data/rules.json";
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "FAQ", item: "https://glassmkr.com/docs/faq" },
    ],
  });

  // FAQPage JSON-LD: a structured Q+A list helps search engines and AI agents
  // pull individual question answers. The shape mirrors the visible details.
  const faqLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How much does Glassmkr cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nothing, in both deployment forms. Self-hosted is free forever with no node limits; the open-source license (AGPL-3.0-only end to end) makes that permanent. The hosted service at app.glassmkr.com is free with a 10-node per-account cap, a capacity protection rather than a tier, and is intended to stay free.",
        },
      },
      {
        "@type": "Question",
        name: "Is Glassmkr open source?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes, entirely. The dashboard monorepo is AGPL-3.0-only at github.com/glassmkr/glassmkr; the Crucible agent is AGPL-3.0-only at github.com/glassmkr/crucible. One Docker Compose file runs the whole stack on your own hardware; see glassmkr.com/docs/self-hosting.",
        },
      },
      {
        "@type": "Question",
        name: "Which operating systems does Crucible support?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Crucible runs on Linux: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12, RHEL 8 / 9, Rocky 8 / 9, AlmaLinux 8 / 9, Arch (rolling), Amazon Linux 2 and 2023. systemd plus kernel 4.18+, x86_64 and aarch64.",
        },
      },
      {
        "@type": "Question",
        name: "How much CPU and memory does Crucible use?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Measured on Crucible 0.13.6 across all 10 validation hosts at steady state: median 108 MB RSS (range 81 to 116 MB, varies with the bundled Node version), under 1 percent of host RAM on every host, near-zero CPU, and an fio delta under 1.5 percent. Each snapshot push is 2 to 5 KB of compressed JSON over the five-minute interval.",
        },
      },
      {
        "@type": "Question",
        name: "Is my data stored in the EU?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The servers are. The dashboard, its databases and the AI GPU all run on dedicated hardware in Amsterdam, Netherlands, which you can confirm from the RIPE record for their addresses. Two things that phrasing usually hides, so they are stated here: the data controller is a Czech sole trader, and the network operator's legal entity is registered in the United Kingdom. GDPR applies through the controller. Self-hosting removes the question entirely.",
        },
      },
    ],
  });
</script>

<svelte:head>
  <title>FAQ: Glassmkr documentation</title>
  <meta name="description" content="Common questions about Glassmkr pricing, OS support, agent footprint, data residency, retention, AI analysis, self-hosting, and uninstall." />
  <link rel="canonical" href="https://glassmkr.com/docs/faq" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/faq" />
  <meta property="og:title" content="Glassmkr FAQ" />
  <meta property="og:description" content="Pricing, OS support, agent footprint, data residency, AI analysis." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr FAQ" />
  <meta name="twitter:description" content="Pricing, OS support, agent footprint, data residency, AI analysis." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
  {@html `<script type="application/ld+json">${faqLd}</` + `script>`}
</svelte:head>

<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / FAQ</p>
      <h1>Frequently asked questions</h1>
      <p class="docs-subtitle">Short answers to the questions we get most often. For deeper material follow the links into the rest of the docs.</p>
    </header>

    <section id="pricing-billing">
      <h2><a href="#pricing-billing" class="anchor-link">#</a>Pricing</h2>

      <details>
        <summary>How much does Glassmkr cost?</summary>
        <p>Nothing, in both deployment forms.</p>
        <p><strong>Self-hosted</strong>: free forever, with no node limits. That is not a promise you have to take on trust; the license makes it true. The dashboard monorepo and the Crucible agent are AGPL-3.0-only, so the whole stack is yours to run.</p>
        <p><strong>Hosted</strong> (<a href="https://app.glassmkr.com">app.glassmkr.com</a>): free, with a 10-node per-account cap. The cap is capacity protection for a service we operate, not a tiering lever. Hosted is intended to stay free.</p>
      </details>

      <details>
        <summary>Is Glassmkr open source?</summary>
        <p>Yes, entirely. The dashboard monorepo is AGPL-3.0-only at <a href="https://github.com/glassmkr/glassmkr">github.com/glassmkr/glassmkr</a>; the Crucible agent is AGPL-3.0-only at <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a>. One Docker Compose file runs the whole stack on your own hardware: see <a href="/docs/self-hosting">/docs/self-hosting</a>.</p>
      </details>

      <details>
        <summary>What happened to the paid Pro tier?</summary>
        <p>Retired in August 2026, when the entire stack went open source. Everything Pro used to gate is now included for every account: 90-day retention, AI analysis, and up to 10 hosted nodes (self-hosted has no node limits). Nothing is billed; any historical charges were settled through Stripe. See the <a href="/billing-policy">billing policy</a>.</p>
      </details>
    </section>

    <section id="agent">
      <h2><a href="#agent" class="anchor-link">#</a>The agent</h2>

      <details>
        <summary>Which operating systems does Crucible support?</summary>
        <p>Crucible runs on Linux. Tested distributions: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12, RHEL 8 / 9, Rocky Linux 8 / 9, AlmaLinux 8 / 9, Arch (rolling), Amazon Linux 2 and 2023. systemd plus kernel 4.18 or newer. x86_64 and aarch64.</p>
        <p>Windows and macOS are not supported. For non-Linux hosts, push to the API directly with a custom collector.</p>
      </details>

      <details>
        <summary>How much CPU and memory does Crucible use?</summary>
        <p>Lightweight by design: under 1% of host RAM on every host we tested. Measured on Crucible 0.13.6 across all 10 validation hosts at steady state: median 108 MB RSS (range 81 to 116 MB, varies with the bundled Node version), near-zero CPU, and an fio delta under 1.5 percent. The binary is about 12 MB; logs rotate at 50 MB by default. Each push is 2 to 5 KB of compressed JSON; at the default five-minute interval, that is about 5 MB/day.</p>
      </details>

      <details>
        <summary>Does Crucible need root access?</summary>
        <p>Crucible runs as the non-root <code>glassmkr</code> user. The install script provisions udev rules and group memberships that grant the user the necessary read access to <code>/dev/ipmi0</code>, raw block devices for SMART, and <code>/proc</code> / <code>/sys</code>. If you disable IPMI, SMART, and ECC monitoring, the agent works without those rules.</p>
      </details>

      <details>
        <summary>Do I need to open any inbound ports?</summary>
        <p>No. The agent initiates all connections outbound over HTTPS (port 443). Your firewall does not need to change.</p>
      </details>

      <details>
        <summary>Does the agent work without IPMI?</summary>
        <p>Yes. If <code>ipmitool</code> is not installed, or the host simply has no BMC, the IPMI module is silently skipped and the snapshot emits null for the IPMI fields. The dashboard renders that as "no signal (BMC not probed)". All other monitoring continues normally. See <a href="/docs/troubleshooting/ipmi">/docs/troubleshooting/ipmi</a>.</p>
        <p>The case that is not silent is a BMC that is present but stops answering. When the kernel exposes an IPMI device and the agent still gets nothing back from it, the dashboard raises <a href="/docs/rules/ipmi_monitoring_unavailable">ipmi_monitoring_unavailable</a>, because fan, PSU, and SEL alerts would otherwise read healthy on a machine whose hardware is no longer being watched at all. This one requires agent 0.14.9 or newer, which is the version that began reporting the two facts the check needs; on an older agent the condition is still silently skipped. Remote power control and console access are usually gone at the same time, so it is worth knowing promptly.</p>
        <p>A low <code>ipmitool</code> version from your <strong>distribution's package</strong> does not stop monitoring. Agent versions 0.14.6 through 0.14.8 refused to run <code>ipmitool</code> below 1.8.19 because of CVE-2020-5208, which switched off BMC monitoring on stock Ubuntu 20.04 and 22.04 and RHEL-family 9. Those distributions ship the security fix inside a 1.8.18 package without changing the version number, so the check could not tell a patched build from an unpatched one and was disabling monitoring on hosts that were never exposed. From 0.14.9 the agent collects normally and records the version instead, and from 0.14.10 it also records the package version so you can see the release suffix that carries the fix. A build below 1.8.19 that <strong>no distribution package owns</strong>, such as one compiled from source, is still refused: nothing backported a fix into it, and Crucible runs <code>ipmitool</code> as root. Note that <code>/usr/local/bin</code> precedes <code>/usr/bin</code> in sudo's <code>secure_path</code>, so a local build shadows the packaged one; <code>command -v ipmitool</code> shows which one wins. To refuse every below-floor build regardless of origin, set <code>collection.enforce_ipmitool_min_version: true</code> in <code>/etc/glassmkr/crucible.yaml</code>.</p>
      </details>

      <details>
        <summary>How do I update Crucible?</summary>
        <pre><code>sudo npm install -g @glassmkr/crucible@latest
sudo systemctl restart glassmkr-crucible</code></pre>
        <!-- Narrowly scoped on purpose: Cloudflare Email Obfuscation mangles the
             version pin below into a mailto link (see /docs/changelog for the full
             explanation), but this page ALSO carries support@glassmkr.com, which we
             want obfuscated. So the exemption covers this one paragraph and nothing
             else. Emitted through an @html expression because Svelte strips authored
             comments from its output. -->
        <p>{@html '<!--email_off-->'}Pin a specific version with <code>@glassmkr/crucible@0.13.5</code>.{@html '<!--/email_off-->'} Configuration in <code>/etc/glassmkr/crucible.yaml</code> is preserved across upgrades. (Pre-0.13.5 installs have the file at the legacy <code>/etc/glassmkr/collector.yaml</code> path; the agent reads either, and <code>glassmkr-crucible init</code> migrates the file in place on next run.)</p>
      </details>

      <details>
        <summary>How do I uninstall Crucible?</summary>
        <pre><code># Stop and disable
sudo systemctl stop glassmkr-crucible
sudo systemctl disable glassmkr-crucible

# Remove the unit
sudo rm /etc/systemd/system/glassmkr-crucible.service
sudo systemctl daemon-reload

# Remove the package
sudo npm uninstall -g @glassmkr/crucible

# Remove configuration (contains the collector key)
sudo rm -rf /etc/glassmkr</code></pre>
        <p>Optionally delete the server from the dashboard to remove its stored metrics and, on hosted accounts, free up a slot under the 10-node cap.</p>
      </details>
    </section>

    <section id="data">
      <h2><a href="#data" class="anchor-link">#</a>Data &amp; retention</h2>

      <details>
        <summary>Where is my data stored?</summary>
        <p>Metric data is stored on Glassmkr infrastructure in the EU. The operating company is a Czech sole-trader; all dedicated servers (including the database and the AI GPU) sit in EU data centers, so the deployment inherits GDPR posture from the underlying provider. Data is encrypted at rest using AES-256 and in transit using TLS 1.3.</p>
        <p>Glassmkr does not store raw system logs, process lists, or file contents. The collected data is numerical metrics (CPU, memory, disk, network counters) and hardware status identifiers (SMART, RAID, sensor readings).</p>
      </details>

      <details>
        <summary>How long is metric data retained?</summary>
        <p><strong>Hosted:</strong> 90 days for every account. Data older than 7 days is downsampled to 5-minute resolution; data older than 30 days is downsampled to 1-hour resolution.</p>
        <p><strong>Self-hosted:</strong> the same 90-day default, because the same migrations run. It is a ClickHouse table TTL, so you can change the window on your own instance.</p>
      </details>

      <details>
        <summary>What happens if connectivity is lost?</summary>
        <p>The <code>server_unreachable</code> rule fires after the server misses 2 consecutive check-ins (about 10 minutes at the default five-minute interval). Crucible buffers up to 60 snapshots in memory (about 5 hours at the default interval) and pushes the queue in order when connectivity is restored. If the buffer fills, the oldest snapshots are dropped first.</p>
      </details>

      <details>
        <summary>Can I export my data?</summary>
        <p>Yes. Pull metric data via the <a href="/docs/api#health">health history API</a>. The response is JSON and can be piped into any analytics tool. For bulk exports, contact support for a CSV or Parquet dump of your account's data.</p>
      </details>

      <details>
        <summary>Can I self-host the dashboard?</summary>
        <p>Yes. The entire stack is open source: the dashboard monorepo (including the alert evaluation engine) is AGPL-3.0-only at <a href="https://github.com/glassmkr/glassmkr">github.com/glassmkr/glassmkr</a>, and the Crucible agent is AGPL-3.0-only at <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a>. One Docker Compose file brings it up: see <a href="/docs/self-hosting">/docs/self-hosting</a>. On your own instance, your data never leaves your hardware.</p>
      </details>
    </section>

    <section id="alerts">
      <h2><a href="#alerts" class="anchor-link">#</a>Alerts &amp; AI</h2>

      <details>
        <summary>How many alert rules ship out of the box?</summary>
        <p>{rules.length} rules across 9 categories: storage, ZFS, filesystem, memory and CPU, network, hardware (BMC / IPMI), GPU, time and services, security and patching. Every rule ships with deep FIX content (safe-mode, validation, rollback, impact); 30+ are verified end-to-end on real hardware. Browse at <a href="/docs/rules">/docs/rules</a>.</p>
      </details>

      <details>
        <summary>What do the P0-P4 priority levels mean?</summary>
        <p>Every alert has a priority from P0 (most serious) to P4 (informational). Priority drives the badge color on alert cards and the emoji prefix in Telegram / Slack notifications. P0 covers uncorrected memory and GPU errors, where data is already at risk; P1 indicates data loss or service outage; P2 indicates significant degradation; P3 is an early warning; P4 is a proactive recommendation or an alert whose instance severity is informational.</p>
        <p>A channel with P1 enabled also receives P0, so channels configured before P0 existed keep paging on it without being edited.</p>
      </details>

      <details>
        <summary>How does alert muting work?</summary>
        <p>Mute specific alert rules on a per-server basis from the server detail page or via the configuration file. Muted rules are not evaluated and do not fire notifications. Useful during maintenance windows, RAID rebuilds, or known-condition periods. Unmuting takes effect on the next ingest cycle. Alerts do not fire retroactively for conditions that occurred while muted.</p>
      </details>

      <details>
        <summary>How does AI analysis work?</summary>
        <p>Glassmkr uses a self-hosted Gemma 4 model (running on a dedicated GPU server in the EU; no commercial LLM APIs) to analyze server health when alerts fire. AI analysis is enabled on hosted accounts; a self-hosted instance enables it by pointing <code>LLM_API_URL</code> at any OpenAI-compatible endpoint. The model reviews current metrics (including per-core CPU when available), recent trends, and the alert context to produce a one-sentence summary of the likely cause. The model is tuned to be conservative, to hedge, and to say "I don't know" when the signal is ambiguous. AI analysis is shown on the alert card and included in Telegram / Slack notifications.</p>
      </details>

      <details>
        <summary>What is per-core CPU monitoring?</summary>
        <p>When <code>collectors.cpu.per_core: true</code> (Crucible 0.3.0+), Crucible reports individual CPU core utilization in addition to aggregate metrics. Enables the per-core CPU chart in the expanded view and gives the AI analyzer per-core awareness. Useful for spotting single-threaded bottlenecks, core pinning issues, and uneven load. Increases data volume proportionally to core count.</p>
      </details>
    </section>

    <section id="operations">
      <h2><a href="#operations" class="anchor-link">#</a>Operations</h2>

      <details>
        <summary>Can I monitor Docker containers or Kubernetes pods?</summary>
        <p>Crucible monitors the host system, not individual containers. Container CPU and memory are visible in the host metrics as part of the total. Dedicated container and Kubernetes monitoring is on the roadmap.</p>
        <p>Crucible itself installs natively on the host (systemd or npm); there is no containerized deployment of the agent, since a bare-metal hardware agent needs direct host access (IPMI, SMART, <code>/proc</code>, <code>/sys</code>) that a container cannot provide without running fully privileged.</p>
      </details>

      <details>
        <summary>What sign-in methods does Glassmkr support?</summary>
        <p>Email + password, Google OAuth, and GitHub OAuth. Connect or disconnect OAuth providers under <strong>Settings &rarr; Account</strong>. There is no built-in TOTP today; rely on your OAuth provider's two-factor configuration if you sign in via Google or GitHub.</p>
      </details>

      <details>
        <summary>Is there an API rate limit?</summary>
        <p>Yes. Token-bucket limiter with per-IP / per-key / per-account tiers plus per-endpoint sub-limits for write actions. Per-IP is 100 burst at 10/sec; per-key is 1000 burst at 100/sec; per-account is 5000 burst at 500/sec. Server registration, deletion, and key rotation each have their own hourly sub-limits. Ingest is rate-limited to one push per server per 55 seconds. See the <a href="/docs/api#rate-limits">API reference</a> for the full table.</p>
      </details>
    </section>

    <section id="support">
      <h2><a href="#support" class="anchor-link">#</a>Support</h2>

      <details>
        <summary>How do I contact support?</summary>
        <p>Email <a href="mailto:support@glassmkr.com">support@glassmkr.com</a> with your account email and server ID. Include the output of <code>sudo journalctl -u glassmkr-crucible --since "1 hour ago" --no-pager</code> if the issue is agent-side.</p>
      </details>

      <p class="note">Last verified: 2026-05-22 against Crucible v0.13.3.</p>
    </section>
  </article>

<style>
  details { border-bottom: 1px solid var(--surface-border); padding: 14px 0; }
  details:first-of-type { border-top: 1px solid var(--surface-border); }
  summary { cursor: pointer; font-weight: 500; color: var(--text-primary); font-size: 0.95rem; padding: 4px 0; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "+"; display: inline-block; width: 20px; color: var(--text-tertiary); font-weight: 400; font-family: var(--font-mono); font-size: 0.9rem; }
  details[open] summary::before { content: "\2212"; }
  details p { padding-left: 20px; font-size: 0.9rem; margin-top: 6px; margin-bottom: 6px; }
  details pre { margin-left: 20px; }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
