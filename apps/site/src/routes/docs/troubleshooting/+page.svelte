<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Troubleshooting", item: "https://glassmkr.com/docs/troubleshooting" },
    ],
  });
</script>

<svelte:head>
  <title>Troubleshooting: Glassmkr documentation</title>
  <meta name="description" content="Fix install, ingest, IPMI, ZFS, GPU, and notification problems with the Crucible agent and Glassmkr Dashboard." />
  <link rel="canonical" href="https://glassmkr.com/docs/troubleshooting" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/troubleshooting" />
  <meta property="og:title" content="Troubleshooting Glassmkr" />
  <meta property="og:description" content="Diagnose install, agent, IPMI, ZFS, GPU, and notification problems." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Troubleshooting Glassmkr" />
  <meta name="twitter:description" content="Diagnose install, agent, IPMI, ZFS, GPU, and notification problems." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs" class="sidebar-section">&larr; Back to docs</a>
      <a href="#topics" class="sidebar-link">Topic pages</a>
      <a href="#service-fails" class="sidebar-link">Service fails to start</a>
      <a href="#offline" class="sidebar-link">Server shows offline</a>
      <a href="#delayed" class="sidebar-link">Metrics delayed</a>
      <a href="#smart" class="sidebar-link">SMART missing</a>
      <a href="#ipmi-missing" class="sidebar-link">IPMI / thermal missing</a>
      <a href="#zfs" class="sidebar-link">ZFS module not loaded</a>
      <a href="#gpu" class="sidebar-link">GPU tier-1 unavailable</a>
      <a href="#psi" class="sidebar-link">PSI alerts never fire</a>
      <a href="#telegram" class="sidebar-link">Telegram not arriving</a>
      <a href="#spam" class="sidebar-link">Email goes to spam</a>
      <a href="#cpu" class="sidebar-link">High Crucible CPU</a>
      <a href="#limit" class="sidebar-link">Server limit reached</a>
      <a href="#disabled" class="sidebar-link">Servers disabled</a>
      <a href="#config" class="sidebar-link">Config not taking effect</a>
      <a href="#per-core" class="sidebar-link">Per-core CPU</a>
      <a href="#muted" class="sidebar-link">Muted rules firing</a>
      <a href="#help" class="sidebar-link">Getting help</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / TROUBLESHOOTING</p>
      <h1>Troubleshooting</h1>
      <p class="docs-subtitle">Common issues with the Crucible agent and the Glassmkr Dashboard, with step-by-step solutions.</p>
    </header>

    <section id="topics">
      <h2><a href="#topics" class="anchor-link">#</a>Topic pages</h2>
      <ul>
        <li><a href="/docs/troubleshooting/ipmi">IPMI</a>: how Crucible detects IPMI, why "Not detected" can be correct behavior, using <code>glassmkr-crucible doctor ipmi</code>, per-vendor notes.</li>
      </ul>
    </section>

    <section id="service-fails">
      <h2><a href="#service-fails" class="anchor-link">#</a>Crucible service fails to start</h2>
      <p><strong>Symptom:</strong> <code>systemctl status glassmkr-crucible</code> shows <code>failed</code> or <code>inactive (dead)</code>.</p>
      <ol>
        <li>Check the service logs: <pre><code>journalctl -u glassmkr-crucible --no-pager -n 50</code></pre></li>
        <li>If you see a YAML parse error, re-run the init wizard with the same key to rewrite the config from scratch: <pre><code>sudo glassmkr-crucible init --api-key &lt;your_collector_key&gt;</code></pre>
          The wizard validates the key against the Dashboard before writing the config, so a typo surfaces immediately. Common YAML mistakes include tabs instead of spaces, missing quotes around strings with special characters, and incorrect indentation.</li>
        <li>If you see <code>permission denied</code>, ensure the configuration file is readable: <pre><code>ls -la /etc/glassmkr/crucible.yaml /etc/glassmkr/collector.yaml 2&gt;/dev/null</code></pre>
          The file should be owned by root with mode 0600. Pre-0.13.5 installs have the file at the legacy <code>/etc/glassmkr/collector.yaml</code> path; the agent reads either.</li>
        <li>If you see <code>bind: address already in use</code>, another instance may be running: <pre><code>pgrep -a glassmkr-crucible</code></pre>
          Kill the stale process and try again.</li>
      </ol>
    </section>

    <section id="offline">
      <h2><a href="#offline" class="anchor-link">#</a>Server shows "offline" in the dashboard</h2>
      <p><strong>Symptom:</strong> The server card shows a gray status indicator and "last seen" is more than 2 minutes ago (the agent pushes roughly every five minutes by default; the <code>server_unreachable</code> rule fires after 2 missed check-ins).</p>
      <ol>
        <li>Check that Crucible is running: <pre><code>systemctl status glassmkr-crucible</code></pre></li>
        <li>Check network connectivity to the API: <pre><code>curl -s -o /dev/null -w "%&#123;http_code&#125;" https://app.glassmkr.com/api/v1/health</code></pre>
          You should get <code>200</code>. If not, check DNS resolution, firewall rules, and proxy settings.</li>
        <li>Check whether the collector key is valid: <pre><code>sudo journalctl -u glassmkr-crucible --since "5 min ago" --no-pager</code></pre>
          If you see <code>auth error: 401</code>, rotate the key in the Dashboard and update <code>/etc/glassmkr/crucible.yaml</code> (legacy installs: <code>/etc/glassmkr/collector.yaml</code>; the agent reads either).</li>
        <li>Check for network-level blocks: <pre><code>nc -zv app.glassmkr.com 443</code></pre></li>
        <li>If you are behind a proxy, configure it in <code>crucible.yaml</code>: <pre><code>proxy:
  https: http://proxy.internal:3128</code></pre></li>
      </ol>
    </section>

    <section id="delayed">
      <h2><a href="#delayed" class="anchor-link">#</a>Metrics are delayed or missing</h2>
      <p><strong>Symptom:</strong> The dashboard shows gaps in charts or data arrives minutes late.</p>
      <ol>
        <li>Check the agent's push timing: <pre><code>sudo journalctl -u glassmkr-crucible --since "5 min ago" --no-pager</code></pre>
          The "Last push" value should be close to the configured interval (default 300 seconds).</li>
        <li>If pushes are slow, check the agent log for timeout errors: <pre><code>grep -i "timeout\|retry" /var/log/glassmkr/crucible.log | tail -20</code></pre></li>
        <li>If the server's clock is significantly off, snapshots may be dropped. Verify NTP is working: <pre><code>timedatectl status</code></pre>
          If not synchronized: <pre><code>sudo timedatectl set-ntp true</code></pre></li>
        <li>If specific collectors are slow (e.g., SMART queries on many disks), they can delay the entire push. Inspect collector timing: <pre><code>sudo journalctl -u glassmkr-crucible -f</code></pre>
          Consider increasing the interval or disabling slow collectors.</li>
      </ol>
    </section>

    <section id="smart">
      <h2><a href="#smart" class="anchor-link">#</a>SMART data is not appearing</h2>
      <p><strong>Symptom:</strong> The Disk tab in the dashboard shows no SMART information.</p>
      <ol>
        <li>Ensure <code>smartmontools</code> is installed: <pre><code># Debian / Ubuntu
sudo apt install smartmontools

# RHEL / Rocky / Alma
sudo dnf install smartmontools</code></pre></li>
        <li>Verify that <code>smartctl</code> can read your drives: <pre><code>sudo smartctl -a /dev/sda</code></pre>
          If this fails with a permission error, Crucible's <code>glassmkr</code> service user needs read access (the default install handles this via udev rules).</li>
        <li>For hardware RAID controllers, drives behind the controller are not visible to <code>smartctl</code> without the <code>-d</code> flag: <pre><code>sudo smartctl -a /dev/sda -d megaraid,0</code></pre></li>
        <li>Verify the SMART collector is enabled: <pre><code>collectors:
  smart:
    enabled: true</code></pre></li>
      </ol>
    </section>

    <section id="ipmi-missing">
      <h2><a href="#ipmi-missing" class="anchor-link">#</a>IPMI, thermal, or fan data is missing</h2>
      <p><strong>Symptom:</strong> The Hardware tab shows no temperature, fan, or PSU data.</p>
      <ol>
        <li>Install <code>lm-sensors</code> for hwmon data: <pre><code># Debian / Ubuntu
sudo apt install lm-sensors
sudo sensors-detect --auto</code></pre></li>
        <li>For IPMI data, install <code>ipmitool</code> and verify it works: <pre><code>sudo apt install ipmitool
sudo ipmitool sdr list</code></pre></li>
        <li>Run the IPMI self-diagnostic: <pre><code>sudo glassmkr-crucible doctor ipmi</code></pre>
          See <a href="/docs/troubleshooting/ipmi">the IPMI troubleshooting page</a> for the full per-reason fix guide.</li>
        <li>If IPMI is not available (common on consumer hardware, cloud VMs without passthrough, laptops, Raspberry Pi), Crucible reads thermal data from hwmon directly.</li>
        <li>Confirm the thermal collector is not disabled: <pre><code>collectors:
  thermal:
    enabled: true
    source: auto</code></pre></li>
      </ol>
    </section>

    <section id="zfs">
      <h2><a href="#zfs" class="anchor-link">#</a>ZFS module not loaded</h2>
      <p><strong>Symptom:</strong> the Storage tab shows no ZFS pools even though <code>zpool list</code> works on the host, or the <code>zfs_*</code> rules never fire.</p>
      <ol>
        <li>Check that the ZFS kernel module is loaded: <pre><code>lsmod | grep zfs</code></pre>
          On many distributions the module is loaded on-demand by the first <code>zpool</code> or <code>zfs</code> call. If Crucible starts before that happens, it sees no ZFS surface.</li>
        <li>Force-load the module at boot: <pre><code>echo zfs | sudo tee /etc/modules-load.d/zfs.conf
sudo systemctl restart glassmkr-crucible</code></pre></li>
        <li>If <code>lsmod | grep zfs</code> shows nothing and you expected ZFS, install the package set for your distribution (<code>zfsutils-linux</code> on Debian/Ubuntu, <code>zfs</code> on Rocky/Alma with EPEL).</li>
        <li>If you have a kernel update pending, ZFS DKMS sometimes lags behind the running kernel; reboot or rebuild the module against the new kernel before assuming Crucible is at fault.</li>
      </ol>
    </section>

    <section id="gpu">
      <h2><a href="#gpu" class="anchor-link">#</a>GPU tier-1 (nvidia-smi) unavailable</h2>
      <p><strong>Symptom:</strong> a server with NVIDIA GPUs reports no GPU data even though <code>nvidia-smi</code> works interactively.</p>
      <p>Crucible's GPU collector probes three tiers in order: <code>nvidia-smi</code> (most common), DCGM exporter (preferred when present), and Redfish OEM stub (BMC-side, vendor-dependent). Validated on L4, A4000, and A16 in the validation fleet.</p>
      <ol>
        <li>Confirm <code>nvidia-smi</code> is on the PATH that systemd sees: <pre><code>sudo systemd-run --pty --uid=glassmkr nvidia-smi</code></pre>
          Some distributions install nvidia-smi to <code>/usr/lib/nvidia/current/</code> rather than <code>/usr/bin/</code>; the systemd unit's <code>PATH</code> may differ from your interactive shell.</li>
        <li>If the binary is found but exits non-zero, check the driver state: <pre><code>nvidia-smi --query-gpu=name,driver_version,pstate --format=csv</code></pre>
          A driver loaded against a different kernel than the running one will fail here.</li>
        <li>If DCGM is installed and you want the richer dataset, ensure the exporter is running: <pre><code>systemctl status nvidia-dcgm</code></pre></li>
        <li>For BMC-side Redfish GPU telemetry (rare; vendor-specific OEM extension), confirm the BMC has the GPU sensor model populated: <pre><code>curl -k -u user:pass https://&lt;bmc&gt;/redfish/v1/Systems/1/Oem/</code></pre></li>
      </ol>
    </section>

    <section id="psi">
      <h2><a href="#psi" class="anchor-link">#</a>Pressure (PSI) alerts never fire</h2>
      <p><strong>Symptom:</strong> <code>cpu_pressure_high</code>, <code>mem_pressure_high</code>, and <code>io_pressure_high</code> never fire on a CentOS, Alma, Rocky, or RHEL host, even under heavy load.</p>
      <p>These three rules read the kernel's Pressure Stall Information. RHEL-family kernels compile PSI in but ship it disabled (<code>CONFIG_PSI_DEFAULT_DISABLED=y</code>), so <code>/proc/pressure</code> does not exist until you opt in at boot. Debian and Ubuntu enable PSI by default.</p>
      <ol>
        <li>Confirm PSI is the gap: <pre><code>ls /proc/pressure</code></pre>
          "No such file or directory" means the kernel is not exporting PSI; the agent omits the data and the three pressure rules stay inactive on this host.</li>
        <li>Enable it with the <code>psi=1</code> boot parameter: <pre><code>sudo grubby --update-kernel=ALL --args="psi=1"
sudo reboot</code></pre></li>
        <li>Verify after the reboot: <pre><code>cat /proc/pressure/cpu</code></pre>
          The next Crucible snapshot picks PSI up automatically; no agent restart or config change is needed.</li>
      </ol>
    </section>

    <section id="telegram">
      <h2><a href="#telegram" class="anchor-link">#</a>Telegram notifications are not arriving</h2>
      <p><strong>Symptom:</strong> Alerts fire in the dashboard but no Telegram messages are received.</p>
      <ol>
        <li>Test the channel from the dashboard or API: <pre><code>curl -X POST https://app.glassmkr.com/api/v1/channels/CHANNEL_ID/test \
  -H "Authorization: Bearer $ACCT_KEY"</code></pre></li>
        <li>If the test fails with <code>401 Unauthorized</code>, the bot token is invalid. Re-create the bot via BotFather or regenerate the token.</li>
        <li>If the test fails with <code>400 Bad Request: chat not found</code>, the chat ID is wrong. Common mistakes: missing the <code>-100</code> prefix for supergroups, the bot was removed from the group, the bot never received any message in the chat (send a message to the bot first).</li>
        <li>If the test succeeds but real alerts do not arrive, check the channel routing. Go to <strong>Settings &rarr; Alert Defaults</strong> and confirm your Telegram channel is listed.</li>
        <li>Check the alert cooldown. By default, Glassmkr sends one notification per active alert per hour. Acknowledged or recently-notified alerts are suppressed.</li>
      </ol>
    </section>

    <section id="spam">
      <h2><a href="#spam" class="anchor-link">#</a>Email notifications go to spam</h2>
      <p><strong>Symptom:</strong> Test emails arrive in the spam folder.</p>
      <ol>
        <li>Check the spam folder and mark messages as "not spam" to train your provider.</li>
        <li>Add <code>alerts@glassmkr.com</code> to your contacts or safe senders list.</li>
        <li>If you control the recipient domain, allow Glassmkr's SPF record. Contact support for the current IP ranges.</li>
        <li>For better deliverability, route through a custom SMTP server in your own domain. See the <a href="/docs/channels">Channels</a> page for setup.</li>
      </ol>
    </section>

    <section id="cpu">
      <h2><a href="#cpu" class="anchor-link">#</a>High CPU usage by Crucible</h2>
      <p><strong>Symptom:</strong> the Crucible process uses more than 1-2% CPU consistently.</p>
      <p>For reference, the Crucible 0.13.6 measurement across all 10 validation hosts shows a median RSS of 108 MB at steady state (range 81 to 116 MB, varies with the bundled Node version), under 1% of host RAM on every host, ~0% CPU, and fio delta under 1.5%. Sustained higher usage is unusual.</p>
      <ol>
        <li>Check which collectors are running: <pre><code>sudo journalctl -u glassmkr-crucible -f</code></pre></li>
        <li>SMART queries on many disks can be expensive. If you have more than 20 disks, narrow the device list or increase the interval: <pre><code>collectors:
  smart:
    devices:
      - /dev/sda
      - /dev/sdb</code></pre></li>
        <li>Per-core CPU metrics on machines with 64+ cores generate a lot of data. Disable per-core reporting if you do not need it: <pre><code>collectors:
  cpu:
    per_core: false</code></pre></li>
        <li>If the collection interval is set very low (e.g., 10 seconds), increase it: <pre><code>collectors:
  interval_seconds: 300</code></pre></li>
      </ol>
    </section>

    <section id="limit">
      <h2><a href="#limit" class="anchor-link">#</a>Registration fails with "server limit reached"</h2>
      <p><strong>Symptom:</strong> + Add Server returns an error about the server limit.</p>
      <ol>
        <li>Hosted accounts have a 10-node per-account cap (a capacity protection, not a tier).</li>
        <li>If you have decommissioned servers still registered, delete them from the dashboard to free up slots.</li>
        <li>Need more than 10 nodes? Self-host the stack; self-hosted instances have no node limits. See <a href="/docs/self-hosting">/docs/self-hosting</a>.</li>
      </ol>
    </section>

    <section id="disabled">
      <h2><a href="#disabled" class="anchor-link">#</a>My servers are disabled (lock icon, "no payment method on file")</h2>
      <p><strong>Symptom:</strong> some server tiles show a lock-icon overlay and "Manage in Settings". Notifications stopped firing for those servers.</p>
      <p><strong>Why:</strong> this state is historical. Before August 2026, servers beyond a paid quota could be disabled when no payment method was on file. Glassmkr no longer charges for anything, and no server is disabled for payment reasons anymore. Disabled servers continued to ingest snapshots, so historical data is preserved.</p>
      <ol>
        <li>Restore in bulk: <strong>Settings &rarr; Disabled servers &rarr; Restore all</strong>. Restoration is instant; no payment method is required.</li>
        <li>Servers you no longer want count against the hosted 10-node cap; delete them from the same screen.</li>
      </ol>
    </section>

    <section id="config">
      <h2><a href="#config" class="anchor-link">#</a>Configuration changes are not taking effect</h2>
      <p><strong>Symptom:</strong> you edited <code>crucible.yaml</code> (or legacy <code>collector.yaml</code>) but Crucible still uses the old settings.</p>
      <ol>
        <li>Restart the service after any configuration change: <pre><code>sudo systemctl restart glassmkr-crucible</code></pre></li>
        <li>Verify the running config by inspecting the agent's startup banner: <pre><code>sudo journalctl -u glassmkr-crucible --since "1 min ago" --no-pager</code></pre>
          The first lines after restart print the resolved interval, enabled collectors, and Dashboard URL.</li>
        <li>Check that you edited the correct file. The systemd unit may pin a non-default config path: <pre><code>systemctl show glassmkr-crucible -p Environment</code></pre></li>
        <li>Environment variables override the config file. Check for any <code>GLASSMKR_*</code> or <code>CRUCIBLE_*</code> variables in the systemd unit or shell environment.</li>
      </ol>
    </section>

    <section id="per-core">
      <h2><a href="#per-core" class="anchor-link">#</a>Per-core CPU data is not showing</h2>
      <p><strong>Symptom:</strong> the per-core CPU chart does not appear, or per-core data is missing from AI analysis.</p>
      <ol>
        <li>Per-core monitoring requires Crucible 0.3.0 or later. Check: <pre><code>glassmkr-crucible --version</code></pre></li>
        <li>Enable per-core in the config: <pre><code>collectors:
  cpu:
    per_core: true</code></pre></li>
        <li>Restart Crucible: <pre><code>sudo systemctl restart glassmkr-crucible</code></pre></li>
        <li>Wait for the next collection interval (default 300 seconds) for data to appear.</li>
      </ol>
    </section>

    <section id="muted">
      <h2><a href="#muted" class="anchor-link">#</a>Muted rules are still firing</h2>
      <p><strong>Symptom:</strong> you muted a rule but it continues to fire alerts or send notifications.</p>
      <ol>
        <li>Muting takes effect on the next ingest cycle. Wait at least one collection interval after muting.</li>
        <li>If you muted via the configuration file, restart Crucible: <pre><code>sudo systemctl restart glassmkr-crucible</code></pre></li>
        <li>If you muted via the dashboard, no restart is needed; the change applies on the next push from that server.</li>
        <li>Verify the rule is muted in the dashboard under the server's Alerts tab. Muted rules show a mute icon.</li>
      </ol>
    </section>

    <section id="help">
      <h2><a href="#help" class="anchor-link">#</a>Getting help</h2>
      <p>If your issue is not covered here:</p>
      <ul>
        <li>Capture an hour of agent logs: <code>sudo journalctl -u glassmkr-crucible --since "1 hour ago" --no-pager &gt; crucible.log</code>. Attach it when contacting support.</li>
        <li>Email <a href="mailto:support@glassmkr.com">support@glassmkr.com</a> with your server ID and a description of the issue.</li>
      </ul>
      <p class="note">Last verified: 2026-05-31 against Crucible v0.13.6. Resource footprint figures are from a 10-host validation-fleet measurement on 2026-05-31.</p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 960px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 200px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: color 0.15s, border-color 0.15s; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.6; }
  section { margin-bottom: 3rem; scroll-margin-top: 80px; }
  h2 { font-size: 1.4rem; color: var(--text-primary); margin-bottom: 0.75rem; position: relative; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.6rem; }
  ol { padding-left: 1.4rem; }
  ol li { margin-bottom: 1rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; margin: 0.5rem 0 0.75rem; }
  pre code { font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.6; color: var(--text-primary); background: transparent; padding: 0; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    code, pre code { font-size: 12px; }
  }
</style>
