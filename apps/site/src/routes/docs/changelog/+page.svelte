<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Changelog", item: "https://glassmkr.com/docs/changelog" },
    ],
  });
</script>

<svelte:head>
  <title>Changelog: Glassmkr documentation</title>
  <meta name="description" content="Behavior changes, operational improvements, and notable fixes shipped to Glassmkr and the Crucible agent. Most recent at top." />
  <link rel="canonical" href="https://glassmkr.com/docs/changelog" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/changelog" />
  <meta property="og:title" content="Glassmkr changelog" />
  <meta property="og:description" content="Releases, behavior changes, and operational improvements." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr changelog" />
  <meta name="twitter:description" content="Releases, behavior changes, and operational improvements." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">

  <!--
    Cloudflare Email Address Obfuscation rewrites anything shaped like
    local@domain.tld in the HTML response, and it does NOT exempt <pre>/<code>.
    Every pinned upgrade command here (`@glassmkr/crucible@0.14.11`) matched, so
    Cloudflare replaced the version with a mailto link and a customer copying the
    command got `@glassmkr/[email protected]`, which fails. 16 commands on this page
    were broken; the repo was always correct, which is why grepping for the
    mangled string finds nothing.

    Cloudflare's own documented exemption marker (email_off, written as an
    HTML comment) is used here. It wraps the
    whole article deliberately: this page contains NO real email addresses (all
    16 hits decoded to version pins), so there is nothing here to protect, and
    wrapping once means future changelog entries are covered automatically
    instead of relying on whoever adds the next one to remember.

    It is emitted through an @html expression because Svelte strips authored HTML
    comments unless `preserveComments` is set, which it is not. Do NOT "simplify"
    it into a plain comment; that silently disappears from the SSR output and the
    bug comes straight back. (Note also that Svelte parses brace expressions even
    inside HTML comments, so an @html example cannot be written literally here.)

    DO NOT write the marker literally in this comment. An HTML comment ends at
    the first close sequence the parser meets, and this comment used to quote
    the marker in full a few lines up. The comment therefore ended THERE, and
    the remaining 974 characters of this explanation became live text: a
    non-blank text node, a direct child of .docs-layout, which a flex container
    turns into an anonymous flex item. It took 684 of the 864 available pixels
    and squeezed .docs-content to ZERO width, so every entry on this page
    rendered one character per line down the right edge, with these notes
    printed above them in public. Refer to the marker by name, never by
    example.

    Do not widen this to pages that DO carry real addresses. /docs/faq needs the
    marker around its single code block only, since support@glassmkr.com is on
    that page and must stay obfuscated.
  -->
  {@html '<!--email_off-->'}
  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / CHANGELOG</p>
      <h1>Changelog</h1>
      <p class="docs-subtitle">Behavior changes, operational improvements, and notable fixes for Glassmkr and the Crucible agent. Most recent at top.</p>
    </header>

    <section class="release" id="2026-08-30">
      <h2><a href="#2026-08-30" class="anchor-link">#</a>2026-08-30</h2>

      <h3>Crucible v1.1.1</h3>
      <p><strong>Current.</strong> The agent is at v1.1.1 on npm (<code>@glassmkr/crucible</code>), AGPL-3.0-only. Docs-only patch: the npm README now states the license plainly and describes the Dashboard as what it is, open source at github.com/glassmkr/glassmkr and self-hostable. No code changes; agents on v1.1.0 have nothing to gain from upgrading.</p>
    </section>

    <section class="release" id="2026-08-29">
      <h2><a href="#2026-08-29" class="anchor-link">#</a>2026-08-29</h2>

      <h3>Crucible v1.1.0</h3>
      <p><strong>Superseded by v1.1.1.</strong> The agent is at v1.1.0 on npm (<code>@glassmkr/crucible</code>), AGPL-3.0-only. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>The agent is relicensed from MIT to AGPL-3.0-only.</strong> The agent and the dashboard now carry the same license, so there is one license to review instead of two. Versions 1.0.1 and earlier were published under MIT and remain MIT; nothing you already installed changed license.</p>
      <p><strong>A GPU probe returning output the parser cannot read is reported as a parser/API mismatch, not as absent hardware.</strong> Empty output still means the feature is absent. Nonempty output that cannot be parsed is what a driver output-format change produces, and it now surfaces as something to look at instead of silently reading as unsupported.</p>
      <p><strong>README corrections.</strong> The documented default collection interval is the shipped 300 seconds (the sample config previously said 60, five times the intended load if copied), and the stale rule-catalog claim is corrected to the generated catalog's current count and priority range (P0 through P4).</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@1.1.0
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-08-27-1">
      <h2><a href="#2026-08-27-1" class="anchor-link">#</a>2026-08-27</h2>

      <h3>Crucible v1.0.1</h3>
      <p><strong>Superseded by v1.1.0.</strong> The agent was at v1.0.1 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>A mistyped ingest URL is now an error instead of a confident pass.</strong> A working ingest endpoint accepts POST only, so it answers the setup probe's GET with 405. A 404 means there is no ingest endpoint at that address at all, which is the most common self-hosting mistake. Until now any response below 500 that was not an authentication failure was reported as "api key validated", so a typo produced a successful-looking install, a running service, and telemetry sent nowhere until somebody read the journal. The message now names the address to check.</p>
      <p><strong>Setup no longer claims to have validated your API key.</strong> The probe is an unauthenticated request against an endpoint that does not authenticate that kind of request, so a non-rejection says the endpoint is reachable and nothing about the key. It now says exactly that.</p>
      <p><strong>Release binaries carry a build-provenance attestation.</strong> Each binary's exact bytes are tied to the workflow, repository and commit that produced it, and you can check a download without a GitHub account. The verification steps are on the <a href="/trust">Trust page</a>. There is no GPG key on purpose: attestation binds provenance to the build workflow itself, so there is no private key for one maintainer to hold, rotate, or lose.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@1.0.1
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-08-02-1">
      <h2><a href="#2026-08-02-1" class="anchor-link">#</a>2026-08-02</h2>

      <h3>Crucible v0.15.1</h3>
      <p>The agent was at v0.15.1 as of this entry, superseded by v1.0.1.</p>
      <p><strong>Three fixes from an external review of v0.15.0. No new alert rules, no configuration changes, and no alert behavior changes.</strong> Recommended for every host, and particularly for hosts started with an explicit configuration path.</p>
      <p><strong>A configuration path that does not exist is now an error rather than a silent fall back to defaults.</strong> Naming a configuration file that is missing, most often a typo, was reported as "using defaults" and the agent carried on under settings you never chose. On a host configured to require a minimum <code>ipmitool</code> version, that meant the requirement was quietly not applied. Starting the agent with no configuration path at all is unchanged and still supported: it is only a path you name explicitly that must now exist.</p>
      <p><strong>The <code>ipmitool</code> diagnostic now reports failure in its exit status.</strong> When the configuration you named cannot be read the diagnostic declines to run, which is correct, but it still reported success, so a script wrapping it read the refusal as a clean result.</p>
      <p><strong>Chassis readings the controller did not supply are now recorded as unknown rather than as "no fault".</strong> A controller that answered with an error, a truncated reply, or wording the agent does not recognize produced a confident "no power event, no overload, no power fault" from data that said nothing at all. Each reading is recorded independently now, and an absent one stays unknown. A genuinely empty power event, which is the common and healthy reading, is still distinguished from a missing one.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.15.1
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-08-02">
      <h2><a href="#2026-08-02" class="anchor-link">#</a>2026-08-02</h2>

      <h3>Crucible v0.15.0</h3>
      <p><strong>Superseded by v0.15.1.</strong> The agent was at v0.15.0 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>The agent now records what the baseboard controller says about the machine's last power transition.</strong> This is the first half of answering why a server rebooted. It collects the controller's last power event, the cause it recorded for the most recent restart, what the machine is configured to do when mains power returns, and whether a power fault or overload is present right now.</p>
      <p><strong>This release reports these readings as facts and does not yet draw a conclusion from them.</strong> Nothing new alerts, and no existing alert changes. Vendors word these fields differently and some populate them only partially, so the readings are being gathered across a range of hardware before anything is built on top of them. Where a value is absent, that is recorded as absent rather than guessed at, and wording the agent does not recognize is preserved verbatim instead of being discarded.</p>
      <p><strong>Requires <code>glassmkr-crucible init</code> to take effect.</strong> The readings are taken through the narrow privileged helper, which gains two new permitted actions, both read-only queries of the controller. An upgrade that skips <code>init</code> will run the new version without collecting them.</p>
      <p><strong>Hosts without a baseboard controller are unaffected</strong> and simply report nothing for this section, as do hosts where the controller is unreachable or where the agent is not permitted to query it.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.15.0
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-31">
      <h2><a href="#2026-07-31" class="anchor-link">#</a>2026-07-31</h2>

      <h3>Crucible v0.14.14</h3>
      <p><strong>Superseded by v0.15.0.</strong> The agent was at v0.14.14 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Further hardening of the check that decides whether the agent will run <code>ipmitool</code> with root privileges.</strong> A single-area release with no new alert rules and no configuration changes. Recommended for every host, and particularly for hosts that run the agent as root without the privileged helper.</p>
      <p><strong>The check and the execution now always name the same file.</strong> On a host with no privileged helper, where the agent runs as root directly, the check examined the binary found on a fixed system path while execution looked the command up in root's own environment, so the two could be different files. Execution now uses the exact path that was checked.</p>
      <p><strong>Version strings are read strictly.</strong> A prerelease of the fixed version, which comes before that version and need not contain the fix, and malformed strings such as <code>2vendor</code> were both treated as new enough and skipped the origin check. Both are now treated as unverifiable, which means the binary has to come from a distribution package before the agent will run it as root. Ordinary distribution versions are unaffected.</p>
      <p><strong>Package-ownership checks now run with a fixed language setting.</strong> The package manager translates its output, including the notices that reveal one binary has been substituted for another, and the agent previously inherited whatever language the service was started with. Under a translated setting those notices were missed.</p>
      <p><strong>Also.</strong> <code>glassmkr-crucible doctor ipmi --config &lt;path&gt;</code> now stops and reports when the configuration you named cannot be read, instead of quietly reporting on default settings that may enforce differently.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.14
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-30">
      <h2><a href="#2026-07-30" class="anchor-link">#</a>2026-07-30</h2>

      <h3>Crucible v0.14.13</h3>
      <p><strong>Superseded by v0.14.14.</strong> The agent was at v0.14.13 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Hardens the check that decides whether the agent will run <code>ipmitool</code> with root privileges, and restores monitoring of filesystems mounted under <code>/home</code>.</strong> No new alert rules and no configuration changes. Recommended for every host.</p>
      <p><strong>Three ways the root-execution check could be bypassed are closed.</strong> The agent runs <code>ipmitool</code> as root through a narrow privileged helper, and since 0.14.10 it only does so when the binary comes from a distribution package. Review found three gaps in that check. An <code>ipmitool</code> whose version string could not be parsed, such as a vendor build reporting a name rather than a number, was treated as if it were new enough and skipped the check entirely. The version was read by searching the service's own command path, while the privileged helper resolves the command through a different, fixed path, so on a host where those disagree the check could approve one file while a different, older one ran as root. And a <code>dpkg</code> diversion, which is the mechanism that places one binary at another's location, was misread as proof of package ownership.</p>
      <p><strong>A filesystem mounted under <code>/home</code> is monitored again.</strong> The agent's own sandbox hid <code>/home</code> from it, and the tool it uses to measure disks skips anything it cannot reach, so a real filesystem mounted there was missing from reports entirely: no capacity warning, no inode warning, no read-only alert, and nothing to indicate it had been skipped. The sandbox now allows reading in those locations while still preventing the agent from writing to them. This takes effect when <code>glassmkr-crucible init</code> runs during the upgrade below.</p>
      <p><strong>Smaller fixes.</strong> Prerelease Node version strings such as <code>22.19.0-rc.1</code> were accepted as meeting the minimum supported version and are now rejected, since a prerelease comes before its final release. <code>glassmkr-crucible doctor ipmi</code> now accepts <code>--config</code>, so on a host started with a custom configuration path the diagnostic reflects the settings the running agent actually applies.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.13
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>

      <h3>Crucible v0.14.12</h3>
      <p><strong>Superseded by v0.14.13.</strong> The agent was at v0.14.12 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Node.js 22 LTS works again, and a throttled push no longer looks like a failure.</strong> No new alert rules, no configuration changes.</p>
      <p><strong>The minimum Node version is now 22.19.0, lowered from 24.</strong> Versions 0.14.6 through 0.14.11 refused to start on anything older than Node 24, which excluded the whole current LTS line. The requirement only ever came from one library the agent depends on, and that library's own stated minimum is 22.19.0; the check had been set from a crash seen on Node 20 and rounded up. Node 22 was verified end to end before this change. If you upgraded Node purely to satisfy the old requirement, nothing is wrong with staying on the newer version, but it is no longer necessary. Node 22.4 and older, including Node 20, are still refused, because the agent genuinely cannot load on them.</p>
      <p><strong>A rate-limited push is now reported as such.</strong> The dashboard accepts one snapshot per server per 55 seconds, and the agent sends one as soon as it starts, so the first push after a restart often lands inside the previous window and is rejected. That was logged as "Push failed", which reads like a real problem; it now says the push was throttled and that the next cycle will land. No data is lost either way, since the next snapshot carries current state.</p>
      <p>Also fixes an em-dash in one status string reported for Adaptec RAID controllers, which is a house-style matter rather than a functional one.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.12
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>

      <h3>Crucible v0.14.11</h3>
      <p><strong>Superseded by v0.14.12.</strong> The agent was at v0.14.11 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Fixes a false "filesystem remounted read-only" CRITICAL that could appear on any host running a recent agent.</strong> Single fix, no new collectors, no configuration changes. If you saw that alert on a host whose disks were fine, this is why, and upgrading clears it on the next collection cycle with no manual action.</p>
      <p><strong>What went wrong.</strong> The agent runs under a hardened systemd unit that includes <code>ProtectSystem=strict</code>, which makes <code>/</code> read-only <em>inside the agent's own sandbox</em> as a security measure. The disk collector read the mount table from its own point of view, so it saw its sandbox rather than the machine, and reported <code>/</code> as read-only on hosts whose root filesystem was perfectly writable. The dashboard then raised a critical alert saying the filesystem had been remounted read-only, likely from I/O errors or corruption. No data was ever at risk on those hosts; the reading was wrong, not the disk.</p>
      <p><strong>The fix.</strong> The collector now reads the machine's mount table, which sits outside every sandbox. Where the host's own security settings prevent that (for example a <code>hidepid</code> mount option, or <code>ProtectProc</code> / <code>ProcSubset</code> restrictions), the agent marks the mount options as unreliable and the dashboard reports nothing rather than guessing, because a filesystem state it cannot actually observe should not be asserted. A genuinely read-only filesystem still raises the alert exactly as before.</p>
      <p>Because the hardened unit is installed by <code>glassmkr-crucible init</code>, it arrived on hosts through ordinary upgrades, so this affected most hosts on a recent agent rather than any particular configuration.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.11
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>

      <h3>Crucible v0.14.10</h3>
      <p><strong>Superseded by v0.14.11.</strong> The agent was at v0.14.10 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Tightens which <code>ipmitool</code> builds the agent will run as root, and reports a BMC that was already dead when the agent started.</strong> No new alert rules and no breaking changes. On a host using its distribution's <code>ipmitool</code> package, which is the normal case, nothing changes.</p>
      <p><strong>The CVE-2020-5208 check now looks at where the binary came from, not just its version.</strong> v0.14.9 stopped blocking any <code>ipmitool</code> older than 1.8.19, because Debian, Ubuntu, and Red Hat all ship the security fix inside a 1.8.18 package without changing the version number, so the old check was disabling hardware monitoring on hosts that were never exposed. That reasoning holds for a distribution's package, but not for a binary compiled from source or installed by hand: nothing backported a fix into those. Since Crucible runs <code>ipmitool</code> as root through its privileged wrapper, it now collects from a package-owned build below 1.8.19 as before, and declines to run one that no package owns, naming the exact file. Snapshots from those hosts also record the package version, such as <code>ipmitool 1.8.18-11ubuntu2.2</code>, which is where the backported fix actually lives and the part <code>ipmitool -V</code> never shows you.</p>
      <p><strong>Worth knowing if you build <code>ipmitool</code> yourself:</strong> <code>/usr/local/bin</code> comes before <code>/usr/bin</code> in sudo's default <code>secure_path</code>, so a locally built copy takes precedence over the packaged one even when both are installed. <code>command -v ipmitool</code> shows which file actually runs. To refuse every build below 1.8.19 regardless of origin, set <code>collection.enforce_ipmitool_min_version: true</code>.</p>
      <p><strong>A BMC that was already unreachable at agent start is now reported.</strong> IPMI capability is checked once when the agent starts and refreshed hourly. If the BMC was already silent at that moment, later snapshots recorded the check as skipped and never retried, so the "BMC present but unreadable" alert could not fire for the exact situation it exists for, and a BMC that failed mid-run had its alert clear at the next refresh while still failing. The agent now retries when the cached result says there is no BMC but the kernel is still showing an IPMI device, since those two cannot both be true. Hosts genuinely without a BMC still skip the check entirely.</p>
      <p><strong>Mistyped settings under <code>collection:</code> are now reported at startup.</strong> They were silently discarded, so a typo left the setting at its default while appearing to take effect. They are still ignored rather than rejected, so a stray key can never stop the agent from starting. <code>glassmkr-crucible doctor ipmi</code> also now reflects your configuration rather than probing with defaults, and explains what to do when a build is refused.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.10
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>

      <h3>Crucible v0.14.9</h3>
      <p><strong>Superseded by v0.14.10.</strong> The agent was at v0.14.9 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Restores BMC monitoring on hosts where it had been switched off, and makes an unreachable BMC visible for the first time.</strong> No new alert rules and no breaking changes; one new optional configuration key.</p>
      <p><strong>IPMI monitoring is no longer disabled because of the <code>ipmitool</code> version.</strong> If the installed <code>ipmitool</code> reported a version below 1.8.19, the agent previously refused to use it at all because of CVE-2020-5208, which meant no fan, power-supply, System Event Log, or IPMI-derived memory-error monitoring on that host. That check could not tell a genuinely unpatched build from a patched one: <code>ipmitool -V</code> reports only the upstream version number, while Debian, Ubuntu, and Red Hat all ship the security fix inside a 1.8.18 package without changing it. Stock Ubuntu 20.04 and 22.04 and RHEL-family 9 are all in that position, so hardware monitoring was being switched off on hosts that were never exposed, with no upgrade available to satisfy the check. The agent now collects normally and reports the situation instead, so you can judge it. If you would rather keep the previous behavior, set <code>collection.enforce_ipmitool_min_version: true</code> in <code>/etc/glassmkr/crucible.yaml</code>.</p>
      <p><strong>An unreachable BMC can now be detected.</strong> Each snapshot reports which <code>/dev/ipmi*</code> device the kernel created, if any, together with the outcome of that snapshot's own collection. That distinguishes a host with no BMC, where silence is correct, from a host whose BMC has stopped answering, which previously looked identical. The earlier check ran once at agent start, so a BMC that failed later could not be reported at all.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.9
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-29">
      <h2><a href="#2026-07-29" class="anchor-link">#</a>2026-07-29</h2>

      <h3>Crucible v0.14.8</h3>
      <p><strong>Superseded by v0.14.9.</strong> The agent was at v0.14.8 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>A single-fix release for kernel update detection on RPM-based hosts.</strong> No new collectors or alert rules, and no configuration changes.</p>
      <p><strong>Pending kernel updates are no longer missed on hosts with two kernel families.</strong> "Reboot required for kernel update" could stay silent while a genuine kernel update was pending. Oracle Linux booted on UEK is the case that matters in practice: a retained RHEL-compatible <code>kernel-core</code> package could be read as the installed kernel and compared against the running UEK release, so the pending UEK update went unreported. The check now recognizes Oracle's <code>kernel-uek</code> and compares only within the kernel family the host is actually booted into. Hosts running a stock RHEL, Rocky, Alma, or Fedora kernel are unaffected, as are Debian and Ubuntu hosts.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.8
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-28">
      <h2><a href="#2026-07-28" class="anchor-link">#</a>2026-07-28</h2>

      <h3>Crucible v0.14.7</h3>
      <p><strong>Superseded by v0.14.8.</strong> The agent was at v0.14.7 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>A follow-up to the 0.14.6 hardening batch.</strong> No new collectors or alert rules: a clearer failure on unsupported Node, a startup configuration safety check, and two false-positive fixes.</p>
      <p><strong>Fails clearly on an unsupported runtime.</strong> On Node.js older than 24 the agent now exits immediately at startup with a message naming the required version, instead of failing deep inside a dependency and restart-looping. Node 24 or newer has been required since 0.14.6.</p>
      <p><strong>Kernel-reboot alert no longer misfires on mainline kernels.</strong> "Reboot required for kernel update" stayed quiet on a host running a mainline or custom kernel newer than the distribution's packaged one: the check now compares kernel versions numerically and recognizes <code>linux-image-unsigned-*</code> packages, while a genuine pending reboot is still reported.</p>
      <p><strong>Config is re-checked at every startup.</strong> The config file's ownership, permissions, and access-control list are re-verified on each start, not only during <code>init</code>: if they are widened after setup to expose the file, the agent refuses to read it. Update-version responses are also size-bounded, matching the other outbound calls hardened in 0.14.6.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.7
sudo glassmkr-crucible init
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-24">
      <h2><a href="#2026-07-24" class="anchor-link">#</a>2026-07-24</h2>

      <h3>Crucible v0.14.6</h3>
      <p><strong>Superseded by v0.14.7.</strong> The agent was at v0.14.6 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Security hardening release.</strong> No new collectors or alert rules; this batch tightens the agent's filesystem, privilege, network, and output handling. Please read the upgrade notes below.</p>
      <p><strong>Runs unprivileged, provably.</strong> If privileged-wrapper setup fails during <code>init</code>, the agent now runs unprivileged and reports the affected privileged collectors as unavailable, instead of falling back to root. Root is used only with an explicit operator opt-in.</p>
      <p><strong>Filesystem and secret handling.</strong> Privileged setup uses descriptor-based, no-follow, exclusive operations with ownership and ACL checks across the whole directory ancestry; secrets are kept out of subprocess environments and argv where possible; external responses are size-bounded; and notifier output escapes control characters and cannot inject headers or markup.</p>
      <p><strong>Network egress is validated and pinned.</strong> Enrollment, dashboard push, version checks, and notifiers require HTTPS by default, reject loopback, private, and link-local destinations unless explicitly allowed, and pin the connection to the resolved public address, mitigating SSRF and DNS-rebinding.</p>
      <p><strong>Failures are visible.</strong> A collector that cannot run now reports as unavailable rather than as a safe or zero value, so a failing probe no longer reads as healthy.</p>
      <p><strong>Upgrade notes:</strong></p>
      <ul>
        <li>Requires Node.js 24 or newer.</li>
        <li>The config file becomes <code>root:glassmkr</code> mode <code>0640</code>. Run <code>sudo glassmkr-crucible init</code> once after upgrading to complete the migration; it preserves your file's contents. Until you do, the agent still starts but logs a warning.</li>
        <li>The Prometheus metrics server now binds <code>127.0.0.1</code> by default. Remote scraping needs an explicit bind address behind an authenticated proxy or ACL.</li>
        <li>A self-hosted dashboard on http or a private address must opt in with <code>--allow-insecure-endpoint</code>.</li>
      </ul>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.6
sudo glassmkr-crucible init   # re-secure the config and refresh the privileged wrapper
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-18">
      <h2><a href="#2026-07-18" class="anchor-link">#</a>2026-07-18</h2>

      <h3>Crucible v0.14.5</h3>
      <p><strong>Superseded by v0.14.6.</strong> The agent was at v0.14.5 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed.</p>
      <p><strong>Install-time privilege separation is more robust.</strong> A failed privilege-separation setup now removes the sudo grant reliably and says so loudly if it cannot, so a residual escalation path is never hidden; and an upgrade restarts the running service so a change to how the agent runs takes effect immediately rather than at the next manual restart.</p>
      <p><strong>Hardware-RAID drive visibility.</strong> A drive behind a RAID/HBA controller that the agent enumerates but cannot read is now reported as a monitoring blind spot rather than skipped, and a genuinely unreadable direct disk is no longer hidden by a healthy controller array on the same host.</p>
      <p><strong>Steadier CPU-temperature alerts.</strong> Alerts from duplicate IPMI sensor names keep a stable identity as sibling sensors cross the threshold, so a hot sensor no longer resolves and re-fires when another sensor changes state.</p>

      <h3>Crucible v0.14.4</h3>
      <p><strong>Superseded by v0.14.5.</strong> The agent was at v0.14.4 as of this entry, on npm (<code>@glassmkr/crucible</code>), MIT-licensed. Install natively: <code>sudo npm install -g @glassmkr/crucible</code> then <code>sudo glassmkr-crucible init</code>.</p>
      <p><strong>Tamper-safe install.</strong> The privilege-separation setup that runs during <code>init</code> was redesigned so the narrow root-owned sudo wrapper cannot be pre-planted or hijacked: group memberships are applied before the install decides the wrapper location is trustworthy, the wrapper directory and its parent are verified against the service account's final groups, the wrapper is written as root with an exclusive-create temp file then atomically put in place and re-verified, and the sudoers grant is revoked if any check fails. Default installs are unaffected; an upgrade now closes a previously-open path rather than leaving it.</p>
      <p><strong>Disks with unreadable SMART are no longer a silent blind spot.</strong> When a fixed disk is present but its SMART health cannot be read (smartmontools not installed, or a controller that needs a device type the agent does not probe), the agent now reports it instead of omitting it, and the dashboard raises an ack-able advisory. Previously such a host looked identical to one with no disks, so a real drive failure could go unmonitored. Removable media and the 0-byte BMC virtual-media device are excluded, and the signal is suppressed on a healthy hardware-RAID host (whose virtual disk legitimately reports no SMART while its physical drives are read through passthrough).</p>
      <p><strong>Drive and sensor identity fixes.</strong> Drive alerts use the drive serial only when it is present and unique in the snapshot, otherwise the device path, so two drives sharing a placeholder serial are no longer merged into one; and duplicate IPMI temperature-sensor names (for example on dual-socket boards) are disambiguated so each is tracked on its own.</p>

      <h3>Crucible v0.14.3</h3>
      <p><strong>Superseded by v0.14.4.</strong> The agent was at v0.14.3 as of this entry.</p>
      <p><strong>Second-round code-review remediation.</strong> Follow-up corrections to v0.14.2: per-sensor CPU-temperature alerts now notify for each socket on dual-socket machines (identical sensor labels were collapsing into one); drive alerts key on the drive serial rather than the <code>/dev/sdX</code> letter, so a drive that re-enumerates after a reboot no longer emits a false "resolved" plus a fresh alert; the collection loop holds a steady cadence on slow hosts (a long cycle can no longer trip a false "unreachable"); and <code>init</code> now checks the sudo wrapper's parent directory, not just the file, before handing collection to the unprivileged user. The v0.14.2 change that reported disk operations as a per-second rate was reverted to per-interval counts.</p>
    </section>

    <section class="release" id="2026-07-17">
      <h2><a href="#2026-07-17" class="anchor-link">#</a>2026-07-17</h2>

      <h3>Crucible v0.14.2</h3>
      <p>The agent was at v0.14.2 as of this entry (superseded by v0.14.3 above), on npm (<code>@glassmkr/crucible</code>). MIT-licensed.</p>
      <p><strong>Code-review remediation.</strong> Notifications now track each failing resource on its own (a second failing disk, drive, interface, or sensor is no longer masked by the first); the softnet drop counter reads the correct kernel column; collection cycles no longer overlap; and the installer enforces root ownership of the privileged wrapper. The Docker Compose deployment was removed: it required a privileged root container contrary to the unprivileged native model, so a native install is now the only supported path.</p>

      <h3>Crucible v0.14.1</h3>
      <p>The agent was at v0.14.1 as of this entry (superseded by v0.14.2 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Hardening of the hardware-RAID passthrough.</strong> Follow-up to v0.14.0: the controller device-type check is now enforced identically by the agent and its privileged wrapper (closing a gap where the wrapper allowed more shapes than intended and rejected some valid ones), and drive de-duplication is scoped so two distinct drives that report the same blank/placeholder serial both stay visible. Reading MegaRAID drives is unchanged. As with v0.14.0, a host on the unprivileged service user needs a one-time <code>glassmkr-crucible init</code> re-run after upgrading.</p>

      <h3>Crucible v0.14.0</h3>
      <p>The agent was at v0.14.0 as of this entry (superseded by v0.14.1 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Drive health behind hardware RAID.</strong> Physical drives behind a hardware RAID or HBA controller (MegaRAID, PERC, Smart Array, 3ware, Adaptec, Areca) were previously invisible: only the controller's virtual disk is a normal block device, and it exposes no SMART, so those hosts showed no drives at all. The agent now discovers the physical drives the way smartctl does and reads each one through the controller, so their SMART health, early-warning attributes, and self-test results are collected like any direct-attached drive. Each drive is reported with its own serial and a label naming the controller family. No third-party controller tools are required. SATA drives behind the controller in this release.</p>
      <p><strong>Upgrade note:</strong> this release adds privileged read actions, so a host running the unprivileged service user needs a one-time <code>glassmkr-crucible init</code> re-run (or wrapper refresh) after upgrading, or the new hardware-RAID reads are skipped.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.14.2
sudo glassmkr-crucible init   # re-run to refresh and harden the privileged wrapper
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-16">
      <h2><a href="#2026-07-16" class="anchor-link">#</a>2026-07-16</h2>

      <h3>Crucible v0.13.26</h3>
      <p>The agent was at v0.13.26 as of this entry (superseded by v0.14.0 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Drive-health collection hardening.</strong> Three fixes to the SMART parsing added in v0.13.25, ahead of wider rollout: a self-test that reports a fatal result is now always recorded as a failure (previously it could be dropped when the drive omitted the pass/fail flag); attribute 189 is read as high fly writes only on drives that name it that way, so a SATA SSD's health-flags field is never misread; and the Seagate-specific command-timeout unpacking is scoped to Seagate drives, so a legitimately large count on any other vendor is never truncated.</p>

      <h3>Crucible v0.13.25</h3>
      <p>The agent was at v0.13.25 as of this entry (superseded by v0.13.26 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Expanded SMART early-warning attributes.</strong> Every drive now reports the remaining Backblaze-five failure markers and their companions: reported uncorrectable errors (187), command timeouts (188), high fly writes (189), spin retries (10), reallocation events (196), offline uncorrectable sectors (198), and UDMA CRC errors (199, an interface/cabling signal rather than a media one). Values come from the same smartctl read the agent already performs, so no new privileged access and no wrapper refresh is needed.</p>
      <p><strong>SMART self-test results.</strong> Each drive carries a summary of its self-test log: the newest test's outcome, plus the newest failed test with its failing LBA kept separately, so a later passing test cannot mask a read failure. Aborted or interrupted tests are never reported as failures.</p>
      <p><strong>NVMe error counters.</strong> Media errors and error-log entry counts from the NVMe health log, enabling growth-over-time early warnings.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.26
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-15">
      <h2><a href="#2026-07-15" class="anchor-link">#</a>2026-07-15</h2>

      <h3>Crucible v0.13.24</h3>
      <p>The agent was at v0.13.24 as of this entry (superseded by v0.13.25 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>OS support-status awareness.</strong> The agent now reports whether the host is enrolled in extended security support past its standard end-of-life (Ubuntu Pro/ESM, or a RHEL Extended Update Support repository), read strictly unprivileged (it never runs as root). The dashboard pairs this with the release lifecycle date so a past-end-of-life host that is still receiving security fixes is not reported as unsupported.</p>

      <h3>Crucible v0.13.23</h3>
      <p>The agent was at v0.13.23 as of this entry (superseded by v0.13.24 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>GPU PCIe slot width.</strong> The GPU collector now records the electrical width of the PCIe slot each card sits in (the upstream port's max link width), alongside the card's own maximum. This lets the dashboard tell an x16 card seated in a physically x8 slot (which correctly negotiates x8, and is not a fault) from a link that trained below the slot's capability, so <code>gpu_pcie_link_degraded</code> no longer warns on the former.</p>
    </section>

    <section class="release" id="2026-07-14">
      <h2><a href="#2026-07-14" class="anchor-link">#</a>2026-07-14</h2>

      <h3>Crucible v0.13.22</h3>
      <p>The agent was at v0.13.22 as of this entry (superseded by v0.13.23 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>SSH drop-in edits are no longer invisible on RHEL-family hosts.</strong> The agent runs unprivileged, and <code>/etc/ssh/sshd_config.d</code> is <code>0700 root</code> by default on RHEL, so a hardening change applied only via a drop-in file looked unapplied forever. When the direct read is denied, the newest drop-in timestamp is now read through a strictly read-only, fixed-path privileged helper, restoring visibility for <code>ssh_config_unapplied</code>. Hosts running the unprivileged service user need a one-time <code>glassmkr-crucible init</code> re-run (or wrapper refresh) to grant the new read.</p>
      <p><strong>Dual-socket DIMM channel counts are no longer halved.</strong> A board that labels its channels A-H on both sockets was collapsing 16 channels to 8; channel totals are now qualified by socket, so the memory-channel advisory reports correct populated and available counts on dual-socket systems.</p>
      <p><strong>SATA wear no longer misreads a temperature attribute.</strong> SMART attribute 231 is drive-wear on some SATA SSDs but temperature on others; it has been dropped from the id-only fallback, so a temperature reading is never reported as remaining drive life (a genuine wear drive still carries a wear-named attribute the parser matches).</p>
      <p><strong>Privileged helper hardening.</strong> The collection wrapper's device-path check now rejects path traversal (any <code>..</code> or embedded slash) to mirror the TypeScript allowlist, and its <code>secure_path</code> includes <code>/usr/local/bin</code> so hand-built tools placed there resolve for the unprivileged agent.</p>

      <h3>Crucible v0.13.21</h3>
      <p>The agent was at v0.13.21 as of this entry (superseded by v0.13.22 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Hands-off fleet onboarding with <code>enroll</code>.</strong> A new <code>glassmkr-crucible enroll --account-key &lt;KEY&gt;</code> subcommand lets you bake one account key into an Ansible, cloud-init, or post-install script and share it across the whole fleet, instead of minting and copying a separate collector key into every host. Each server derives a stable machine identity, self-registers with the dashboard, and receives its own collector key; a re-run maps back to the same server rather than creating a duplicate. The account key is used only for that one registration call and is never written to disk.</p>
      <p><strong>RHEL security-update count is now accurate.</strong> On RHEL-family hosts the pending-security-update count was derived from a query that also counted kernels already installed but not yet booted, inflating it and pointing at a no-op fix. It now counts only genuinely installable security packages; an installed-but-unbooted kernel shows up (correctly) as "reboot required", not "updates pending".</p>
      <p><strong>Correct vendor on placeholder-firmware boards.</strong> Boards whose firmware leaves the system-manufacturer as a placeholder (e.g. "To Be Filled By O.E.M.") are now identified by their baseboard manufacturer, so vendor-specific BMC parsing and guidance work on them.</p>

      <h3>Dashboard</h3>
      <p><strong>Idempotent server onboarding.</strong> Paired with <code>enroll</code> above, the dashboard now recognizes a re-provisioned host by its machine identity and re-attaches it to the existing server instead of creating a duplicate that counts against your node quota.</p>
      <p><strong>New advisory: a drive has disappeared.</strong> A standalone (non-RAID) disk that drops off the bus or de-enumerates used to leave no signal, since the RAID and SMART checks only see drives that are present. A new trend warning flags a disk that was consistently present and has since vanished from telemetry while the host keeps reporting, identified by serial. It is advisory (a planned hot-swap looks the same from the outside), so it never pages.</p>
      <p><strong>Drive-wear guidance now covers SATA SSDs.</strong> The wear alert fires on SATA SSDs as well as NVMe; its remediation is now drive-type-aware (smartctl for SATA, nvme-cli for NVMe) instead of NVMe-only. The memory-channel advisory is now informational rather than a warning, matching its "not a fault" intent.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.22
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-05">
      <h2><a href="#2026-07-05" class="anchor-link">#</a>2026-07-05</h2>

      <h3>Crucible v0.13.20</h3>
      <p>The agent was at v0.13.20 as of this entry (superseded by v0.13.21 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Per-process file-descriptor monitoring now covers root-owned processes.</strong> The per-process file-descriptor scan runs through the same privileged helper as the rest of hardware collection, so a host running the unprivileged service user now sees descriptor counts for root-owned daemons, not just its own. Before this, a root service slowly leaking file descriptors toward its limit was invisible to the agent when it ran as <code>glassmkr</code>. Hosts on the unprivileged service user need a one-time <code>glassmkr-crucible init</code> re-run (or wrapper refresh) to grant the new read.</p>
      <p><strong>Fan speeds now include discrete-reading sensors.</strong> Boards that expose fan tachometers as discrete sensors rather than analog readings (some Supermicro and ASRock Rack firmware) had those fans omitted from the sensor list. They are now mirrored in alongside the analog readings, so fan coverage matches what the BMC reports.</p>

      <h3>Crucible v0.13.19</h3>
      <p>The agent was at v0.13.19 as of this entry (superseded by v0.13.20 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Memory-channel population is now monitored.</strong> The agent reports every DIMM slot (populated or empty) with its channel, socket, size, and rated versus configured speed, straight from the board's firmware. The dashboard raises a new advisory when memory channels sit empty or DIMMs run below rated speed: the silent bandwidth killers on multi-channel CPUs, where an 8-channel EPYC with 4 DIMMs delivers roughly half its peak memory bandwidth. Validated on Supermicro, ASRock, Gigabyte, and ASUS boards, including dual-socket EPYC. Hosts running the unprivileged service user need a one-time <code>glassmkr-crucible init</code> re-run (or wrapper refresh) to grant the new read.</p>
      <p><strong>Fixed a phantom SMART failure on virtual devices.</strong> A device smartctl could not read (a BMC's virtual-media USB device such as "AMI Virtual HDisk0", or a USB bridge needing a device type) was reported as a failing drive. Unreadable now means no SMART data, never a failure verdict.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.19
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-04">
      <h2><a href="#2026-07-04" class="anchor-link">#</a>2026-07-04</h2>

      <h3>Crucible v0.13.18</h3>
      <p>The agent was at v0.13.18 as of this entry (superseded by v0.13.19 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Fixed a false "reboot required" alert on RHEL-family hosts.</strong> On Rocky, AlmaLinux, RHEL, CentOS Stream, and Fedora, the kernel ships as the <code>kernel-core</code> package rather than <code>kernel</code>. The reboot check queried <code>kernel</code>, got "not installed", and raised <code>kernel_needs_reboot</code> on healthy hosts (showing "Installed kernel: package kernel is not installed"). It now reads <code>kernel-core</code> (and <code>kernel-default</code> on SUSE), so the running-versus-installed comparison is correct on the RHEL family. Debian and Ubuntu are unaffected.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.18
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-03">
      <h2><a href="#2026-07-03" class="anchor-link">#</a>2026-07-03</h2>

      <h3>Crucible v0.13.17</h3>
      <p>The agent was at v0.13.17 as of this entry (superseded by v0.13.18 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed.</p>
      <p><strong>Hardware and security collection restored on root hosts.</strong> A v0.13.16 change routed privileged checks (IPMI sensors, SMART, RAID, firewall, kernel logs) through a sudo helper that is only set up by the installer's init step. A host running the agent as root that had skipped that step collected none of them. The agent now falls back to reading those directly when it runs as root, so collection is never silently lost.</p>

      <h3>Crucible v0.13.16</h3>
      <p>The agent was at v0.13.16 as of this entry (superseded by v0.13.17 above), on npm and Docker Hub. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>SSH config changes are now checked against the running daemon.</strong> Crucible reads SSH settings from <code>sshd -T</code>, which reflects the config file on disk rather than the daemon that is actually running. So editing <code>sshd_config</code> to lock down root login but forgetting to reload sshd would clear the alert while the box stayed exposed. Crucible now compares the config's last-modified time against the daemon's last start-or-reload and raises a new <code>ssh_config_unapplied</code> alert while a change is saved but not yet live, so a host is never reported all-clear on an unapplied SSH change. It recognizes a <code>systemctl reload</code>, not just a full restart.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.17
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-07-01">
      <h2><a href="#2026-07-01" class="anchor-link">#</a>2026-07-01</h2>

      <h3>Crucible v0.13.15</h3>
      <p>The agent was at v0.13.15 as of this entry (superseded by v0.13.16 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>SATA SSD endurance is now monitored.</strong> Crucible previously read write-endurance only from NVMe drives, so a worn SATA SSD reported no wear at all. It now reads a SATA SSD's wear indicator (the vendor-specific SMART life-remaining attribute) and reports percent-used the same way it does for NVMe, so an aging SATA SSD is no longer invisible. Paired with a dashboard drive-wear alert that adds a lower "plan replacement" watch level below the existing warning.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.15
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-06-27">
      <h2><a href="#2026-06-27" class="anchor-link">#</a>2026-06-27</h2>

      <h3>Crucible v0.13.14</h3>
      <p>The agent was at v0.13.14 as of this entry (superseded by v0.13.15 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Clean reboots are no longer misreported as unclean shutdowns.</strong> The reboot-evidence collector detected a clean shutdown with <code>last shutdown -F</code>, which returns nothing on modern systemd and util-linux even after a clean <code>sudo reboot</code>, so a deliberate planned reboot was escalated to a critical "unclean shutdown" alert. The collector now reads <code>last -x -F</code> (which surfaces the shutdown record) and treats a boot as clean when a shutdown record sits immediately before it. Together with the dashboard severity change above, a clean intentional reboot is now informational, not a page.</p>

      <h3>Crucible v0.13.13</h3>
      <p>The agent was at v0.13.13 as of this entry (superseded by v0.13.14 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>GPU driver-resilience facts.</strong> On a host with an NVIDIA GPU, Crucible now reports whether the nvidia kernel module is loaded, whether nouveau is loaded, and whether nouveau is blacklisted, read from sysfs and <code>/proc/modules</code> even when <code>nvidia-smi</code> is dead. That is the dangerous case: if nouveau is not blacklisted it binds the GPU first on the next reboot, the NVIDIA driver cannot load, and a marketplace host silently de-lists itself. The new <code>gpu_driver_unsafe_reboot</code> alert warns before the reboot happens, while the fix is still non-disruptive.</p>
      <p><strong>kernel_needs_reboot false positive fixed.</strong> The Debian and Ubuntu reboot check trusted <code>/var/run/reboot-required</code> unconditionally, but that flag is set by any package that wants a reboot (libc, systemd), not just the kernel. A host whose running kernel was already the newest installed could raise a spurious reboot alert. The check now compares the running kernel to the newest installed kernel.</p>

      <h3>Dashboard: alert quality</h3>
      <p><strong>Host-type profiles, now with auto-detect.</strong> Tag a server's role (for example a marketplace GPU box) and the alerts that are expected by design for that role are suppressed, with the reason recorded, while real faults still fire. A host that looks like a marketplace GPU box is now offered a one-click prompt to apply the profile, so the suppression does not depend on remembering to set it per box. Settable in the UI or via the API (the <code>profile</code> field on <code>POST</code> and <code>PATCH /api/v1/servers</code>).</p>
      <p><strong>Flapping detection.</strong> A rule that keeps firing and auto-resolving (an intermittent or expected-at-idle condition) is now rolled up into a single recurrence warning instead of a wall of identical alerts. The event log records state changes, not one row per snapshot, so a chronically-true alert no longer buries the real transitions.</p>
      <p><strong>False positives fixed.</strong> Several alerts were taught to tell a real fault from a benign one: <code>gpu_pcie_link_degraded</code> ignores an idle, power-capped GPU (the PCIe link downshifts to save power and retrains under load); <code>disk_latency_high</code> distinguishes I/O saturation under load from a failing drive; <code>gpu_uncorrected_ecc</code> treats a one-off lifetime SRAM bit flip as informational rather than an immediate replacement; and a clean, intentional reboot is no longer reported as a critical unexpected reboot.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.14
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-06-26">
      <h2><a href="#2026-06-26" class="anchor-link">#</a>2026-06-26</h2>

      <h3>Crucible v0.13.12</h3>
      <p>The agent was at v0.13.12 as of this entry (superseded by v0.13.13 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Free memory (MemFree).</strong> Crucible now collects MemFree from <code>/proc/meminfo</code> alongside MemAvailable, so the dashboard can split a host's memory headroom into reclaimable page cache versus genuinely unused RAM. Additive and backward compatible.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.12
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-06-21">
      <h2><a href="#2026-06-21" class="anchor-link">#</a>2026-06-21</h2>

      <h3>The programmatic API and all notification channels are now free</h3>
      <p><strong>Re-gating.</strong> We moved the Pro line. The only things Pro now unlocks are the ones whose cost scales with use: more than 3 nodes, data retention beyond 7 days, and unlimited AI analysis. Everything else is free on every plan, including the full read and write programmatic API (account keys can be read, write, or admin scope), all notification channels with no cap, and predictive trend warnings. This reverses the earlier policy (see the 2026-05-12 tier-gating entry below) that kept the write API and premium channels behind Pro; we decided the API should not be the paywall.</p>

      <h3>Three new notification channels: Discord, PagerDuty, and webhooks</h3>
      <p><strong>New.</strong> Alongside Email, Telegram, and Slack, you can now route alerts to Discord (incoming webhook), to PagerDuty (Events API v2, with automatic incident resolution when an alert clears), or to any HTTP endpoint as a structured JSON webhook. All six channel types are free, on every plan, with no cap. Add them under Channels in the dashboard.</p>
    </section>

    <section class="release" id="2026-06-16">
      <h2><a href="#2026-06-16" class="anchor-link">#</a>2026-06-16</h2>

      <h3>Crucible v0.13.11</h3>
      <p>The agent was at v0.13.11 as of this entry (superseded by v0.13.13 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Drive serial number and firmware.</strong> Crucible now collects each disk's serial number and firmware revision, parsed from the SMART report it already reads (SATA and NVMe). These surface in the dashboard's hardware view and in drive alerts, where the serial is the identifier a hardware replacement or provider ticket needs. No configuration change; a drive whose firmware does not report them is handled gracefully.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.11
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-06-11">
      <h2><a href="#2026-06-11" class="anchor-link">#</a>2026-06-11</h2>

      <h3>Crucible v0.13.10</h3>
      <p>The agent was at v0.13.10 as of this entry (superseded by v0.13.11 above), on npm (<code>@glassmkr/crucible</code>) and on Docker Hub (<code>docker.io/glassmkr/crucible</code>, anonymous pulls). MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>PSI availability notice (RHEL family).</strong> Stock CentOS, Alma, Rocky, and RHEL kernels ship Pressure Stall Information disabled, so the cpu/memory/io pressure rules cannot fire there. The agent now says so once at startup, with the remedy (the <code>psi=1</code> boot parameter). Previously the gap was silent. Details in the <a href="/docs/troubleshooting#psi">troubleshooting entry</a>.</p>
      <p><strong>Correct primary IP.</strong> On boards where the BMC's virtual USB interface enumerates first (common on Supermicro), the dashboard and notifications showed a link-local 169.254.x address as the server IP. The agent now prefers the first global-scope address.</p>
      <p><strong>Docker quickstart fixed.</strong> The compose file now pulls from Docker Hub, which allows anonymous pulls; the previous ghcr.io default requires authentication, so the documented <code>docker compose up</code> failed. Unused container plumbing the agent never read was removed, and the install docs now create the config file the agent actually reads.</p>

      <h3>Dashboard: notification dedup for event alerts</h3>
      <p>Event-type alerts (IPMI SEL, GPU XID) stack repeat occurrences into one card. Stacking previously treated every re-evaluation of a still-recent event as a new occurrence and re-sent the notification, which could repeat once per collection interval for as long as the event stayed in the rule's window. Stacking and re-notification now happen only when a genuinely new event arrives, and acknowledgements stick. Server-side fix, already live; no agent upgrade required for it.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@0.13.10
sudo systemctl restart glassmkr-crucible</code></pre>
    </section>

    <section class="release" id="2026-06-07">
      <h2><a href="#2026-06-07" class="anchor-link">#</a>2026-06-07</h2>

      <h3>Crucible v0.13.9</h3>
      <p>The agent was at v0.13.9 as of this entry (superseded by v0.13.10 above), on npm (<code>@glassmkr/crucible</code>) and at the registries <code>ghcr.io/glassmkr/crucible</code> and <code>docker.io/glassmkr/crucible</code>. MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Detection fixes (RHEL/Fedora family only).</strong> 0.13.9 broadens the <code>dnf-automatic</code> auto-updates check to recognize the full set of affirmative <code>apply_updates</code> values (<code>yes</code>, <code>true</code>, <code>on</code>, <code>1</code>, case-insensitive) and anchors the match, and it makes <code>/etc/os-release</code> parsing tolerant of non-standard whitespace and quoting so the distro family always resolves correctly. Debian/Ubuntu hosts are unaffected. No change to the data collected, the CLI, the config schema, or the snapshot payload.</p>
    </section>

    <section class="release" id="2026-06-03">
      <h2><a href="#2026-06-03" class="anchor-link">#</a>2026-06-03</h2>

      <h3>Crucible v0.13.8</h3>
      <p>The agent was at v0.13.8 as of this entry (superseded by v0.13.9 above), on npm (<code>@glassmkr/crucible</code>) and at the registries <code>ghcr.io/glassmkr/crucible</code> and <code>docker.io/glassmkr/crucible</code>. MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Internal refactor, no behavior change.</strong> 0.13.8 extracts two more shared helpers from per-collector code: a rate-tracker for cumulative <code>/proc</code> counters (used by the conntrack and softnet collectors) and <code>key=value</code> plus columnar <code>/proc</code> parsers (used by the systemd-unit and TCP-stats collectors). The rate and parse behavior is unchanged, and the data collected, the CLI, the config schema, and the snapshot payload are all unchanged; another maintainability pass, verified by the full test suite. No action required beyond a routine upgrade when convenient.</p>

      <h3>Crucible v0.13.7</h3>
      <p>The agent was at v0.13.7 as of this entry (superseded by v0.13.8 above), on npm (<code>@glassmkr/crucible</code>) and at the registries <code>ghcr.io/glassmkr/crucible</code> and <code>docker.io/glassmkr/crucible</code>. MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Internal refactor, no behavior change.</strong> 0.13.7 deduplicates repeated collector code into shared helpers (file reads, CLI and systemd-unit presence checks, kernel-log reading and timestamp parsing, and <code>/etc/os-release</code> parsing) and removes dead code. The data collected, the CLI, the config schema, and the snapshot payload are all unchanged; this is a maintainability and footprint pass, verified by the full test suite. No action required beyond a routine upgrade when convenient.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@latest
sudo systemctl restart glassmkr-crucible</code></pre>
      <p>Or via Docker: <code>docker pull ghcr.io/glassmkr/crucible:latest</code>.</p>
    </section>

    <section class="release" id="2026-05-29">
      <h2><a href="#2026-05-29" class="anchor-link">#</a>2026-05-29</h2>

      <h3>Crucible v0.13.6</h3>
      <p>The agent was at v0.13.6 as of this entry (superseded by v0.13.7, see 2026-06-03). On npm (<code>@glassmkr/crucible</code>) and at the registries <code>ghcr.io/glassmkr/crucible</code> and <code>docker.io/glassmkr/crucible</code>. MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Security fix.</strong> 0.13.6 fixes a security false-negative on RHEL-family hosts: download-only <code>dnf-automatic</code> timers were treated as "auto-updates configured," which suppressed the <code>pending_security_updates</code> alert. Affected hosts: any RHEL-family host with <code>dnf-automatic.timer</code> enabled but <code>apply_updates = no</code> in <code>/etc/dnf/automatic.conf</code>. Upgrade to 0.13.6 to receive the corrected classification; the alert then fires correctly when security patches are pending and no working auto-apply mechanism is configured. Debian/Ubuntu hosts were never affected (that path already inspected the config contents).</p>
      <p><strong>Interim versions.</strong> 0.13.4 was a documentation sweep and 0.13.5 renamed the on-disk config file from <code>collector.yaml</code> to <code>crucible.yaml</code> (with a backwards-compatible read of the old name); neither changed alerting behavior.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@latest
sudo systemctl restart glassmkr-crucible</code></pre>
      <p>Or via Docker: <code>docker pull ghcr.io/glassmkr/crucible:latest</code>.</p>
    </section>

    <section class="release" id="2026-05-22">
      <h2><a href="#2026-05-22" class="anchor-link">#</a>2026-05-22</h2>

      <h3>Crucible v0.13.3</h3>
      <p>The agent was at v0.13.3 as of this entry (superseded by v0.13.6, see 2026-05-29). On npm (<code>@glassmkr/crucible</code>) and at the registries <code>ghcr.io/glassmkr/crucible</code> and <code>docker.io/glassmkr/crucible</code>. MIT-licensed. Runs as the non-root <code>glassmkr</code> user.</p>
      <p><strong>Resource footprint.</strong> Validation-fleet measurement on 2026-05-21 across 7 hosts shows a median 91 MB RSS idle, near-zero CPU, and an fio delta under 1.5%. RSS ranged 65 MB to 103 MB. <em>Updated:</em> a later measurement against the 0.13.6 fleet shows a median around 108 MB; see the <a href="/docs">docs spec table</a> for current numbers.</p>
      <p><strong>Default interval.</strong> 60 seconds (set in v0.10.0; the previous 300-second default is gone).</p>

      <h3>Rule library at 68 rules across 9 categories</h3>
      <p>Categories: storage, ZFS, filesystem, memory and CPU, network, hardware (BMC / IPMI), time and services, security and patching, GPU. 20 rules ship with deep FIX content (safe-mode, validation, rollback, impact counters); the rest are verified. GPU coverage is 9 rules across three tiers (nvidia-smi / DCGM exporter / Redfish OEM stub), validated on NVIDIA L4, A4000, and A16.</p>
      <p>Browse all rules at <a href="/docs/rules">/docs/rules</a>; the machine-readable corpus is at <a href="/llms-full.txt">/llms-full.txt</a>.</p>

      <h3>Upgrade</h3>
      <pre><code>sudo npm install -g @glassmkr/crucible@latest
sudo systemctl restart glassmkr-crucible</code></pre>
      <p>Or via Docker: <code>docker pull ghcr.io/glassmkr/crucible:latest</code>.</p>
    </section>

    <section class="release" id="2026-05-13">
      <h2><a href="#2026-05-13" class="anchor-link">#</a>2026-05-13</h2>

      <h3>Crucible 0.9.4</h3>
      <p><strong>Fixed.</strong> PSU sensor classification now works across every observed BMC vendor (Supermicro, Gigabyte, ASRockRack, ASUS). Previously the <code>PS&lt;N&gt;</code> name shape was Dell-gated and four of five PSU-having boxes were silently filtered out, so per-PSU alerts never fired regardless of state. The bitmask interpretation now follows IPMI 2.0 spec table 42-3 (Failure detected, AC lost, predictive, inactive).</p>
      <p><strong>Changed.</strong> When the agent cannot probe IPMI at all (no <code>ipmitool</code>, no <code>/dev/ipmi0</code>, etc.), the snapshot now emits <code>null</code> for <code>ipmi.ecc_errors</code> and <code>sel_entries_count</code> rather than stub zeros. The dashboard renders this as "no signal (BMC not probed)" instead of the misleading "0 / 0".</p>
      <p><strong>Changed.</strong> IPMI capability detection re-runs every hour. Installing <code>ipmitool</code> after the agent started is picked up automatically; no service restart needed.</p>
      <p><strong>Added.</strong> <code>glassmkr-crucible doctor ipmi</code> subcommand for customer self-diagnosis. See <a href="/docs/troubleshooting/ipmi">/docs/troubleshooting/ipmi</a>.</p>

      <h3>Tier-gating policy for the programmatic API</h3>
      <p>The programmatic API surface (account keys) is now uniformly gated by Pro plan. Free customers retain full web-dashboard access and full <em>read</em> API access for their own data; programmatic <em>writes</em> (channel CRUD, alert acknowledge / resolve, server CRUD, mutes, restore endpoints, key management) and Pro features (AI analysis, trend warnings) return <code>402 pro_required</code> when called via an API key on a Free plan. Web-dashboard sessions are unaffected at any tier. Full breakdown was at /docs/api/tier-gating (page retired with the tier model).</p>

      <h3>Unexpected-reboot alerts now auto-resolve</h3>
      <p>An <code>unexpected_reboot</code> alert that has been firing for at least 24 hours of continuous stable uptime now auto-resolves with <code>resolution_reason: auto_decay_stable_24h</code>. The original incident remains in the resolved-alerts history. Tunable per-server via <code>config_overrides.unexpected_reboot_decay_hours</code>.</p>
    </section>

    <section class="release" id="2026-05-12-ecc-rate-based">
      <h2><a href="#2026-05-12-ecc-rate-based" class="anchor-link">#</a>2026-05-12 (later still)</h2>

      <h3>Rate-based ECC error detection</h3>
      <p>The <code>ecc_errors</code> alert rule now uses a rolling 24-hour rate window instead of a cumulative threshold. Default: a warning fires when more than 10 correctable errors are observed in 24 hours. Uncorrectable ECC errors continue to fire critical immediately on any non-zero count.</p>
      <p>This eliminates false-positive alerts on long-running hosts where BMC error counters accumulate over months without indicating an active hardware issue.</p>
      <p>When the BMC counter is cleared (SEL reset, BMC reboot), the rule skips one evaluation cycle and resumes on the next snapshot; no false alerts from the reset itself.</p>
    </section>

    <section class="release" id="2026-05-12-keys-ui">
      <h2><a href="#2026-05-12-keys-ui" class="anchor-link">#</a>2026-05-12 (later)</h2>

      <h3>API key management UI + scopes</h3>
      <p>Pro customers can now manage API keys via the dashboard at <a href="https://app.glassmkr.com/settings/keys">/settings/keys</a>. New keys can be created with one of three scopes (Read, Write, or Admin), an optional expiry date (up to 5 years), and graceful 48-hour rotation. The old key keeps working through the grace window so automation can be updated without downtime, then auto-revokes. Emergency revoke is one click away.</p>
      <p>Reminder emails fire 7 and 1 days before key expiry, plus a notification when a key is auto-revoked on expiry. Audit log view is at <a href="https://app.glassmkr.com/settings/audit">/settings/audit</a> with date-range and action filters (Pro plan; 365-day retention).</p>
    </section>

    <section class="release" id="2026-05-12">
      <h2><a href="#2026-05-12" class="anchor-link">#</a>2026-05-12</h2>

      <h3>Pro-tier API gating</h3>
      <p>Programmatic API access (creating account API keys, rotating account keys, reading the audit log, plus programmatic server management via account keys: create, rename, delete, rotate collector keys) is now restricted to Pro-plan customers. Free-plan accounts can continue to ingest snapshots from their 3 free servers and use the dashboard to manage them; programmatic management requires Pro.</p>
      <p>If you encounter a 402 response on an endpoint that previously worked, your account may have been downgraded or never had Pro access. Existing API keys created before this change keep working for ingest; manage them via the dashboard if you need to rotate or delete.</p>
    </section>

    <section class="release" id="2026-05-09">
      <h2><a href="#2026-05-09" class="anchor-link">#</a>2026-05-09</h2>

      <h3>Hardware visibility on the dashboard</h3>
      <p>Server tiles and detail pages now show the hardware vendor and product detected by the monitoring agent (e.g., "GIGABYTE / R292-4S1-00"), plus an IPMI badge when sensor data is available. This helps identify what is actually on each box, especially when server names do not match the underlying hardware.</p>
    </section>

    <section class="release" id="2026-05-08">
      <h2><a href="#2026-05-08" class="anchor-link">#</a>2026-05-08</h2>

      <h3>Stripe billing enforcement</h3>
      <p>Pro customers without a payment method on file now have servers beyond the 3-server free quota disabled at the end of their billing period. The oldest 3 servers stay active. Snapshot ingest continues for disabled servers, so historical data is preserved and restoration is instant once a card is added.</p>
      <p>Affected customers receive a sequence of warning emails: when a payment method is removed, 3 days before disable, 1 day before disable, and at the moment of disable. Restoration is a single-click operation: <strong>Settings &rarr; Disabled servers &rarr; Restore all</strong>.</p>
    </section>

    <section class="release" id="2026-05-07">
      <h2><a href="#2026-05-07" class="anchor-link">#</a>2026-05-07</h2>

      <h3><code>cpu_temperature_high</code> reads hwmon directly, with IPMI fallback</h3>
      <p>Most customers see no change. The evaluator now reads CPU thermals from the kernel's hwmon interface (more accurate, vendor-agnostic), falling back to IPMI sensor data when hwmon is not available.</p>
      <p>Customers running on Gigabyte AMD platforms (B650, B660, X670, EPYC) see fewer false-positive alerts. Their BMC firmware (12.61, the shipping default on these boards) reports a <code>CPU&lt;N&gt;_DTS</code> IPMI sensor that runs about 30 C hotter than the actual CPU die temperature exposed via the kernel. The agent (Crucible 0.9.1+) drops the inflated <code>CPU&lt;N&gt;_DTS</code> sensor whenever a <code>CPU&lt;N&gt;_TEMP</code> sibling exists on the same socket.</p>

      <h3>ECC alerts now fire on Dell and HPE iDRAC platforms too</h3>
      <p>Previously, ECC alerts only fired when the BMC exposed a named "correctable / uncorrectable" sensor. Dell iDRAC and some HPE iLO firmwares report ECC events only via the System Event Log (SEL), not as named sensors, so customers on those platforms were missing alerts silently. This release adds a SEL-derived counter as a second source.</p>

      <h3><code>install.sh</code> simplified</h3>
      <p>The bootstrap installer at <a href="https://glassmkr.com/install.sh">glassmkr.com/install.sh</a> now delegates configuration and systemd setup to the <code>glassmkr-crucible init</code> subcommand. The <code>--dashboard-key</code> argument is preserved as an alias for <code>--api-key</code> so existing automation keeps working.</p>
    </section>
  </article>
  {@html '<!--/email_off-->'}
</div>

<style>
  .release { margin-bottom: 4rem; scroll-margin-top: 80px; }
  .release h2 { font-size: 1.4rem; color: var(--text-primary); margin-bottom: 0.5rem; position: relative; }
  .release h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.25rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.6rem; }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
