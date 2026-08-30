<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Troubleshooting", item: "https://glassmkr.com/docs/troubleshooting" },
      { "@type": "ListItem", position: 3, name: "IPMI", item: "https://glassmkr.com/docs/troubleshooting/ipmi" },
    ],
  });
</script>

<svelte:head>
  <title>IPMI troubleshooting: Glassmkr documentation</title>
  <meta name="description" content="How Crucible detects IPMI, why 'Not detected' can be correct, the doctor subcommand, and per-vendor notes for Supermicro / Gigabyte / ASUS / ASRockRack / Dell iDRAC / HPE iLO." />
  <link rel="canonical" href="https://glassmkr.com/docs/troubleshooting/ipmi" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/troubleshooting/ipmi" />
  <meta property="og:title" content="IPMI troubleshooting" />
  <meta property="og:description" content="IPMI detection, doctor subcommand, per-vendor notes." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="IPMI troubleshooting" />
  <meta name="twitter:description" content="IPMI detection, doctor subcommand, per-vendor notes." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs/troubleshooting" class="sidebar-section">&larr; Troubleshooting</a>
      <a href="#how-detection-works" class="sidebar-link">How detection works</a>
      <a href="#detection-vs-collection" class="sidebar-link">Detection vs collection</a>
      <a href="#doctor" class="sidebar-link">doctor subcommand</a>
      <a href="#reason-no_ipmitool_binary" class="sidebar-link">no_ipmitool_binary</a>
      <a href="#reason-permission_denied" class="sidebar-link">permission_denied</a>
      <a href="#reason-no_bmc_device" class="sidebar-link">no_bmc_device</a>
      <a href="#reason-execution_failed" class="sidebar-link">execution_failed</a>
      <a href="#reason-ipmitool_cve_2020_5208" class="sidebar-link">ipmitool_cve_2020_5208</a>
      <a href="#per-vendor" class="sidebar-link">Per-vendor notes</a>
      <a href="#psu-notes" class="sidebar-link">PSU monitoring</a>
      <a href="#support" class="sidebar-link">Support requests</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / TROUBLESHOOTING / IPMI</p>
      <h1>IPMI troubleshooting</h1>
      <p class="docs-subtitle">How Crucible detects IPMI, why "Not detected" does not always mean broken, how to self-diagnose with <code>glassmkr-crucible doctor ipmi</code>, and what to expect across BMC vendors.</p>
    </header>

    <section id="how-detection-works">
      <h2><a href="#how-detection-works" class="anchor-link">#</a>How Crucible detects IPMI</h2>
      <p>Detection is capability-based, not vendor-allowlist. Crucible does not look at your BMC vendor string and decide whether to support you; it asks "can I actually talk to the BMC?" and uses the answer.</p>
      <p>The probe chain at agent start, and on every re-check:</p>
      <ol>
        <li><strong>ipmitool binary check.</strong> <code>ipmitool -V</code>, which needs no BMC access and so works as the unprivileged service user. A missing binary surfaces as <code>no_ipmitool_binary</code>.</li>
        <li><strong>Version note.</strong> A version below 1.8.19 is recorded as an advisory (CVE-2020-5208) and does not stop collection when the binary comes from a distro package. An unowned build below that version is refused. See <a href="#reason-ipmitool_cve_2020_5208">below</a>.</li>
        <li><strong>Reachability probe.</strong> The privileged sensor read. Non-empty output means the BMC answered. An empty result surfaces as <code>no_bmc_device</code>; a thrown error surfaces as <code>execution_failed</code>.</li>
      </ol>
      <p>The result is a structured <code>detection.reason</code> field, with one of five values: <code>no_ipmitool_binary</code>, <code>permission_denied</code>, <code>no_bmc_device</code>, <code>execution_failed</code>, or <code>ipmitool_cve_2020_5208</code>. The Dashboard surfaces the reason under "IPMI: Not detected" so you know which fix to apply.</p>
      <p><strong>Note what that chain cannot tell you, and what 0.14.9 adds.</strong> Because the binary is checked before any BMC contact, <code>no_ipmitool_binary</code> says nothing about whether a BMC exists; and because <code>no_bmc_device</code> is produced whenever the reachability probe comes back empty, it covers a genuinely absent BMC and a BMC that has stopped answering alike. Agent 0.14.9 therefore reports two additional facts on every snapshot: which <code>/dev/ipmi*</code> node the kernel created, if any, and whether that snapshot's own collection succeeded. A device node present with a failed collection is a BMC that exists and is not responding, which is the condition <a href="/docs/rules/ipmi_monitoring_unavailable">ipmi_monitoring_unavailable</a> alerts on.</p>
      <p>The startup capability is re-checked periodically, so installing <code>ipmitool</code> or loading the kernel modules after the agent started is picked up without a restart. The device-node and collection-status facts above are re-evaluated on every snapshot rather than periodically, which is what lets a BMC failing mid-life be noticed.</p>
    </section>

    <section id="detection-vs-collection">
      <h2><a href="#detection-vs-collection" class="anchor-link">#</a>Detection vs collection: they can disagree, by design</h2>
      <p>It is normal for the Dashboard to report "IPMI: Not detected" on a host where some hardware metrics still appear. This is not a bug: detection and collection use different data sources.</p>
      <p>The header IPMI verdict reflects Crucible's BMC probe. The dashboard's CPU temperature, fan, and ECC blocks can also be populated from non-BMC sources:</p>
      <ul>
        <li><strong>CPU temperature</strong> often comes from <code>hwmon</code> (kernel-side, no BMC needed) or <code>lm-sensors</code>.</li>
        <li><strong>ECC counters</strong> can come from kernel EDAC (<code>/sys/devices/system/edac/mc/mc*/&#123;ce,ue&#125;_count</code>) on systems where the BIOS exposes them, completely separate from the BMC.</li>
        <li><strong>SMART, RAID, network, disk usage</strong> are kernel-side and do not depend on IPMI at all.</li>
      </ul>
      <p>When the agent cannot probe IPMI at all, the snapshot emits <code>null</code> for ECC and SEL counters; the Dashboard renders that as "no signal (BMC not probed)" instead of the misleading "0 / 0" reading.</p>
    </section>

    <section id="doctor">
      <h2><a href="#doctor" class="anchor-link">#</a>Self-diagnose with <code>glassmkr-crucible doctor ipmi</code></h2>
      <p>The <code>doctor</code> subcommand runs the same probes the agent uses and prints actionable guidance for each failure mode. It is read-only and does not modify system state.</p>
      <pre><code>sudo glassmkr-crucible doctor ipmi</code></pre>
      <p>The available case looks like:</p>
      <pre><code>IPMI capability check:
  Result:        [OK] IPMI detected via ipmitool_in_band
  ipmitool:      1.8.19

Crucible will collect:
  - Sensor readings (temperature, fan, voltage, power)
  - SEL events (recent + cumulative ECC counters)
  - PSU redundancy state (per-PSU + aggregate)</code></pre>
      <p>Failure cases print the matching <code>detection.reason</code> plus a fix recipe.</p>
    </section>

    <section id="reason-no_ipmitool_binary">
      <h2><a href="#reason-no_ipmitool_binary" class="anchor-link">#</a><code>no_ipmitool_binary</code></h2>
      <p><strong>Meaning:</strong> the <code>/dev/ipmi0</code> device exists, but <code>ipmitool</code> is not installed.</p>
      <p><strong>Fix:</strong> install the package:</p>
      <ul>
        <li>Debian / Ubuntu: <code>sudo apt install ipmitool</code></li>
        <li>RHEL / Rocky / Alma: <code>sudo dnf install ipmitool</code></li>
        <li>Arch: <code>sudo pacman -S ipmitool</code></li>
        <li>Alpine: <code>sudo apk add ipmitool</code></li>
      </ul>
      <p>No restart needed. The next collection cycle (within ~5 minutes at the default interval) sees the binary, and the next hourly re-check flips <code>detection.available</code> to <code>true</code>. The Dashboard updates on the following ingest.</p>
    </section>

    <section id="reason-permission_denied">
      <h2><a href="#reason-permission_denied" class="anchor-link">#</a><code>permission_denied</code></h2>
      <p><strong>Meaning:</strong> Crucible cannot open <code>/dev/ipmi0</code>. The device node is mode <code>0600</code> owned by root.</p>
      <p><strong>Fix:</strong> Crucible runs as the non-root <code>glassmkr</code> user; the install script provisions a udev rule granting that user read access. If you customized the service unit, confirm:</p>
      <pre><code>systemctl cat glassmkr-crucible | grep '^User='
ls -l /dev/ipmi0</code></pre>
      <p>The default install ships a udev rule at <code>/etc/udev/rules.d/99-glassmkr-ipmi.rules</code> that grants the <code>glassmkr</code> group access. If you removed it, restore via the install script or run the agent as root (less preferred).</p>
    </section>

    <section id="reason-no_bmc_device">
      <h2><a href="#reason-no_bmc_device" class="anchor-link">#</a><code>no_bmc_device</code></h2>
      <p><strong>Meaning:</strong> ipmitool is installed and runs, but the kernel has no IPMI device node and the in-band ipmitool probe could not open one. Usually the kernel modules are not loaded.</p>
      <pre><code>sudo modprobe ipmi_si ipmi_devintf ipmi_msghandler
ls -l /dev/ipmi0    # should appear after the modules load</code></pre>
      <p>If <code>/dev/ipmi0</code> still does not appear, the host may genuinely have no BMC. This is common on consumer hardware, Raspberry Pi, laptops, and virtual machines without IPMI passthrough. In that case set <code>collection.ipmi: false</code> in <code>/etc/glassmkr/crucible.yaml</code> (legacy installs: <code>/etc/glassmkr/collector.yaml</code>; the agent reads either) to silence the snapshot field; the dashboard stops trying to render IPMI for this host.</p>
    </section>

    <section id="reason-execution_failed">
      <h2><a href="#reason-execution_failed" class="anchor-link">#</a><code>execution_failed</code></h2>
      <p><strong>Meaning:</strong> ipmitool ran, but the call returned an error other than "could not open device". The BMC is reachable in some sense but not responding the way Crucible expected.</p>
      <p><strong>Fix:</strong> reproduce by hand and read the error:</p>
      <pre><code>sudo ipmitool mc info</code></pre>
      <p>Common causes:</p>
      <ul>
        <li>The BMC is in a degraded state and dropped the request. Retry; if it persists, escalate via the support path below.</li>
        <li>The in-band interface (KCS or SSIF) is busy. Sustained busy state usually means firmware is mid-task; wait a few minutes and retry.</li>
        <li>The installed ipmitool is too old for the BMC's IPMI 2.0 dialect. Upgrade <code>ipmitool</code> via the distribution package manager.</li>
      </ul>
      <p><strong>Do not run <code>sudo ipmitool mc reset cold</code> without first confirming with your hardware vendor.</strong> Some BMCs do not recover cleanly from a cold reset and hang past the operation, which on a remote machine is much worse than the original failure.</p>
    </section>

    <section id="reason-ipmitool_cve_2020_5208">
      <h2><a href="#reason-ipmitool_cve_2020_5208" class="anchor-link">#</a><code>ipmitool_cve_2020_5208</code></h2>
      <p><strong>Meaning:</strong> ipmitool is installed and working, but its version reads older than 1.8.19. CVE-2020-5208 is a set of buffer overflows in ipmitool's parsers that a malicious or compromised BMC could reach.</p>
      <p><strong>From agent 0.14.9 a distro-packaged build no longer stops monitoring.</strong> Versions 0.14.6 through 0.14.8 refused to run any ipmitool below 1.8.19, which switched off fan, PSU, SEL, and IPMI-derived memory-error monitoring entirely. That check could not distinguish a patched build from an unpatched one, because <code>ipmitool -V</code> reports only the upstream version number while Debian, Ubuntu, and Red Hat all ship the security fix inside a 1.8.18 package without changing it. Stock Ubuntu 20.04 and 22.04 and RHEL-family 9 are all in that position, so monitoring was being disabled on hosts that were never exposed, with no upgrade available to satisfy the check.</p>
      <p><strong>Agent 0.14.10 and newer decide on where the binary came from</strong>, because "the distro patched it" is a claim only a distro package can make:</p>
      <ul>
        <li><strong>Owned by a dpkg or rpm package.</strong> Crucible collects normally and records the package version alongside the reading, so you see <code>ipmitool 1.8.18-11ubuntu2.2</code> rather than the bare <code>1.8.18</code>. That release suffix is where the backported fix lives, and it is the part <code>ipmitool -V</code> does not show you. This is the ordinary case on a supported distribution.</li>
        <li><strong>Owned by nothing.</strong> A build from source, a vendor tarball, or a hand-installed binary carries no backport guarantee, so it really may be unpatched. Crucible runs ipmitool as root through its privileged wrapper, so it declines to run that one and reports this reason code. The <code>detection.detail</code> field names the exact path.</li>
      </ul>
      <p><strong>Watch out for shadowing.</strong> <code>/usr/local/bin</code> comes before <code>/usr/bin</code> in sudo's default <code>secure_path</code>, so a locally built ipmitool wins over the packaged one even when both are installed. Run <code>command -v ipmitool</code> to see which file actually runs. Removing the unowned copy is usually the fix.</p>
      <p>To refuse every below-floor build regardless of origin, set <code>collection.enforce_ipmitool_min_version: true</code> in <code>/etc/glassmkr/crucible.yaml</code>. Note that unknown keys under <code>collection</code> are ignored rather than rejected, so a typo leaves the setting off; from 0.14.10 the agent logs a warning naming any key it dropped.</p>
      <p><strong>If you want to confirm your build carries the fix</strong>, and it very likely does on a supported distribution:</p>
      <pre><code># Debian / Ubuntu: is there a newer candidate, and is the installed one patched?
apt-cache policy ipmitool
zcat /usr/share/doc/ipmitool/changelog.Debian.gz | grep -i 5208

# RHEL family: same two questions
dnf -q list --available ipmitool
rpm -q --changelog ipmitool | grep -i 5208
dnf updateinfo list --cve CVE-2020-5208</code></pre>
      <p><strong>A non-zero count means your build already carries the fix</strong>, even though its version string still reads 1.8.18, so the host is not exposed. Stock Ubuntu 20.04 and 22.04 and RHEL-family 9 are all in this position. On RHEL-family hosts the changelog cites internal bug ids rather than CVE numbers, so also try <code>dnf updateinfo list --cve CVE-2020-5208</code>, which returns nothing when no security update is outstanding.</p>
      <p><strong>If a newer package genuinely exists</strong>, installing it is still worthwhile for its own sake: confirm <code>ipmitool -V</code> reports 1.8.19 or later and restart the agent. Do not build an unpatched ipmitool from source merely to satisfy a version string.</p>
      <p>Nothing about this state requires touching the BMC. If a remediation suggests resetting it, that guidance is wrong for this reason code.</p>
    </section>

    <section id="per-vendor">
      <h2><a href="#per-vendor" class="anchor-link">#</a>Per-vendor notes</h2>
      <p>Crucible's detection is capability-based, so any BMC that responds to standard IPMI 2.0 commands works. These notes are vendor-specific quirks observed on real hardware, not detection-gating rules.</p>

      <h3 id="vendor-supermicro">Supermicro</h3>
      <p>Usually clean. The BMC reports vendor strings cleanly via <code>ipmitool mc info</code> (<code>Manufacturer Name: Supermicro</code> or <code>Super Micro Computer Inc.</code>). PSU sensors typically appear as <code>PS1 Status</code> / <code>PS2 Status</code> with the discrete-state bitmask in the Reading column.</p>

      <h3 id="vendor-gigabyte">Gigabyte</h3>
      <p>The BMC sometimes reports <code>Manufacturer Name: Unknown (0x3C0A)</code> in <code>ipmitool mc info</code> output, even though the IANA manufacturer ID (15370) resolves to Gigabyte. This is a Gigabyte BMC firmware quirk; Crucible does not gate detection on the manufacturer string, so no customer action is needed. PSU sensors typically appear as <code>PS1_Status</code> with an underscore separator.</p>

      <h3 id="vendor-asus">ASUS</h3>
      <p>Validated on RS700-E10-RS4U. Detection works correctly when <code>ipmitool</code> is installed; the most common issue is that distributions sometimes ship without <code>ipmitool</code> by default, which surfaces as <code>no_ipmitool_binary</code> in the doctor output. Install via the per-distro command above.</p>

      <h3 id="vendor-asrockrack">ASRockRack</h3>
      <p>DMI <code>sys_vendor</code> may read <code>"To Be Filled By O.E.M."</code> on some boards (a known firmware default), but the BMC itself reports vendor cleanly via <code>ipmitool mc info</code> (<code>Manufacturer Name: ASRock Rack Incorporation</code>). PSU sensors appear as <code>PSU1 Status</code> / <code>PSU2 Status</code>.</p>

      <h3 id="vendor-dell">Dell PowerEdge (iDRAC)</h3>
      <p>In-band IPMI through iDRAC works without an iDRAC Enterprise license. The license gates out-of-band IPMI over LAN, not the in-band KCS path Crucible uses. PSU sensors appear as <code>PS1 Status</code> / <code>PS2 Status</code>, and iDRAC also exposes an aggregate <code>PS Redundancy</code> sensor that Crucible reads for whole-pair redundancy state.</p>
      <p>Dell iDRAC compatibility has not been validated on real hardware in our validation fleet. If you hit a detection or collection issue specific to iDRAC, file a support request with the output of <code>sudo ipmitool mc info</code> and <code>sudo glassmkr-crucible doctor ipmi</code>.</p>

      <h3 id="vendor-hp">HP ProLiant (iLO)</h3>
      <p>In-band IPMI via KCS usually works without an iLO Advanced license. The license gates out-of-band iLO features, not in-band IPMI. Some older iLO firmware revisions require <code>ipmitool</code> 1.8.18 or later for IPMI 2.0 compatibility.</p>
      <p>HP iLO compatibility has not been validated on real hardware in our validation fleet. Same support-request convention as Dell above.</p>
    </section>

    <section id="psu-notes">
      <h2><a href="#psu-notes" class="anchor-link">#</a>A note on PSU monitoring</h2>
      <p>The <code>isPsuSensor</code> classifier covers Supermicro, Gigabyte, ASRockRack, and ASUS naming conventions, and interprets discrete states as IPMI 2.0 spec table 42-3 hex bitmasks (Failure detected, AC lost, predictive, inactive) in addition to text-status strings.</p>
      <p>If a multi-PSU box previously showed two healthy PSUs in the dashboard but one was actually failed or unplugged, that is the bug shape that current Crucible releases catch.</p>
    </section>

    <section id="support">
      <h2><a href="#support" class="anchor-link">#</a>When to file a support request</h2>
      <p>Email <a href="mailto:support@glassmkr.com">support@glassmkr.com</a> when:</p>
      <ul>
        <li>Your BMC vendor is not in the validated list above, and detection works (the <code>doctor</code> output shows <code>[OK]</code>) but a specific collection path (sensors, SEL, PSU) returns unexpected values.</li>
        <li>Detection fails (<code>doctor</code> output shows <code>[FAIL]</code>) but <code>sudo ipmitool mc info</code> works fine when you run it interactively.</li>
        <li>The <code>doctor</code> subcommand returns <code>execution_failed</code> with an error message not covered above.</li>
      </ul>
      <p>Attach:</p>
      <ul>
        <li>The doctor output: <code>sudo glassmkr-crucible doctor ipmi 2&gt;&amp;1</code></li>
        <li>A successful raw probe: <code>sudo ipmitool mc info 2&gt;&amp;1</code></li>
        <li>One hour of agent logs: <code>sudo journalctl -u glassmkr-crucible --since "1 hour ago" --no-pager &gt; crucible.log</code></li>
        <li>Your server ID from the Dashboard.</li>
      </ul>
      <p class="note">Last verified: 2026-05-22 against Crucible v0.13.3.</p>
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
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.6rem; }
  ol { padding-left: 1.4rem; }
  ol li { margin-bottom: 0.6rem; }
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
