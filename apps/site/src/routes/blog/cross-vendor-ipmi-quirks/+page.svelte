<svelte:head>
  <title>Cross-vendor IPMI quirks we learned the hard way - Glassmkr Blog</title>
  <meta name="description" content="Six specific cross-vendor IPMI footguns from running monitoring on seven boxes spanning four vendors, six motherboard generations, and three OS families. SEL timestamp formats, vendor-vs-DMI divergence, distro-specific package gaps, and the Gigabyte DTS firmware offset." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/cross-vendor-ipmi-quirks" />
  <meta property="og:title" content="Cross-vendor IPMI quirks we learned the hard way" />
  <meta property="og:description" content="Six specific cross-vendor footguns from running IPMI monitoring across Supermicro, Gigabyte, ASUS and ASRockRack on Debian, Ubuntu, Rocky, Alma and Proxmox. The protocol is consistent. Nothing above it is." />
  <meta property="og:image" content="https://glassmkr.com/og/cross-vendor-ipmi-quirks.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Cross-vendor IPMI quirks we learned the hard way" />
  <meta name="twitter:description" content="Six specific cross-vendor footguns from running IPMI monitoring across 4 vendors, 6 board generations, 5 OS families. Every vendor lies about something different." />
  <meta name="twitter:image" content="https://glassmkr.com/og/cross-vendor-ipmi-quirks.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/cross-vendor-ipmi-quirks" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Cross-vendor IPMI quirks we learned the hard way",
    description: "Six specific cross-vendor IPMI footguns from running monitoring on seven boxes spanning four vendors, six motherboard generations, and three OS families.",
    image: "https://glassmkr.com/og/cross-vendor-ipmi-quirks.png?v=20260826",
    datePublished: "2026-05-25",
    dateModified: "2026-05-25",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/cross-vendor-ipmi-quirks.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/cross-vendor-ipmi-quirks",
    articleSection: "Operations"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Cross-vendor IPMI quirks", item: "https://glassmkr.com/blog/cross-vendor-ipmi-quirks" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">May 2026 · Operations · 7 min read</p>
      <h1>Cross-vendor IPMI quirks we learned the hard way.</h1>
      <p class="lede">
        Operating IPMI across a fleet of mixed-vendor hardware is a compatibility minefield. Here are the specific footguns we have hit running monitoring on seven boxes spanning four vendors, six motherboard generations, and three operating system families.
      </p>
    </header>

    <p>
      The Intelligent Platform Management Interface (IPMI) has been the dominant out-of-band management standard on commodity server hardware for over two decades. In theory, it gives a single interface to sensor data, system event logs, and remote control across every vendor. In practice, "single interface" describes a target the vendors collectively achieve about 80% of the time, and the remaining 20% is where you spend your hours.
    </p>

    <p>
      We have spent some hours. Our validation fleet at Glassmkr runs seven boxes across four vendors: Supermicro, Gigabyte, ASUS, and ASRockRack. The motherboard generations span 2017 to 2024. We operate them on a mix of Debian, Ubuntu, Rocky Linux, Alma Linux, and Proxmox. Every interaction with IPMI on this fleet has eventually surfaced a vendor-specific or distro-specific quirk that needed handling.
    </p>

    <p>Here are six of them, in roughly the order they bit us.</p>

    <h2>1. The two-confounding-issues case: missing tool AND disabled config</h2>

    <p>
      One of our boxes, our own production services-1, was reporting IPMI data as empty for weeks. Sensors empty. SEL count zero. The <code>ipmi.available</code> field set to false.
    </p>

    <p>
      The natural diagnostic sequence on Linux for IPMI is: check kernel modules, check the device node, check the userspace tool, check the agent. We did all four:
    </p>

    <pre><code>ipmi_si, ipmi_devintf, ipmi_msghandler, ipmi_ssif: loaded
/dev/ipmi0: present, root:root, 240,0
ipmitool: bash: ipmitool: command not found</code></pre>

    <p>
      Found it. The ipmitool binary was missing from the box. Standard fix: <code>apt install ipmitool</code>.
    </p>

    <p>
      After installation we restarted the agent. The data was still empty. We had not, in fact, found it.
    </p>

    <p>
      The second issue surfaced when we read the agent's config file. Buried in the collection section was a single line: <code>ipmi: false</code>. Someone (probably one of us, months earlier, during initial provisioning) had explicitly disabled IPMI collection. The tool's absence had masked the config flag; the config flag had masked the tool's absence. Each was independently sufficient to break IPMI collection. Together they made the diagnostic less obvious than either would have been alone.
    </p>

    <p>
      Two fixes (install tool, flip flag). Both small. The lesson is structural: when a system reports nothing, the cause might be plural. Check every layer independently before declaring the first layer the culprit.
    </p>

    <h2>2. The alias-vs-DMI divergence</h2>

    <p>
      Each of our validation boxes has a human-readable alias. The aliases were assigned during provisioning based on a quick scan of the hardware. One of them was labelled "supermicro-x12qch" because the BMC interface said Supermicro. We trusted the BMC and moved on.
    </p>

    <p>
      Months later, monitoring started enriching server metadata with DMI data from <code>/sys/class/dmi/id/</code>. The DMI report for "supermicro-x12qch" came back: vendor GIGABYTE, product R292-4S1-00.
    </p>

    <p>
      The box is a Gigabyte. Not a Supermicro. The BMC firmware was lying because it had been re-flashed by the previous owner, or because the BMC vendor SKU does not match the motherboard vendor, or for some other reason we have not chased to ground. From the customer's perspective, the alias was wrong by 100%, but every monitoring action we had taken against the box had still worked, because the underlying IPMI surface is vendor-neutral enough at the protocol level.
    </p>

    <p>
      The fix on our side was to surface the DMI-reported vendor and product in the dashboard alongside the alias, so the discrepancy becomes visible. Customers naming a box wrong (or being lied to by a re-flashed BMC) is now flagged with a one-glance read.
    </p>

    <h2>3. The malformed SEL timestamp</h2>

    <p>
      System Event Log timestamps should be ISO-8601. Real-world ipmitool output is not always ISO-8601. We have observed shapes like:
    </p>

    <pre><code>24-11-14T16:16:02 UTCZ</code></pre>

    <p>
      Two-digit year, day order varies, the trailing "Z" with a leading "UTC" string, and the time field can be 12-hour or 24-hour depending on BMC firmware version. Our agent was emitting these strings unparsed because the BMC was emitting them unparsed.
    </p>

    <p>
      The downstream consequence was a rule that used SEL event ages to filter old events. The rule could not parse the timestamps, so it could not filter by age, so old events kept firing forever. The fix was on the agent side: parse the timestamps into proper ISO-8601 (or sentinel) before emitting. The parsing layer had to handle several shapes we did not initially document because we did not know they existed.
    </p>

    <p>
      Cross-vendor: if you are parsing SEL output, do not trust the timestamp format. Build a layer specifically for normalizing it.
    </p>

    <h2>4. The amd64-microcode non-free-firmware footgun</h2>

    <p>
      Multiple AMD-based boxes in our fleet had a <code>kernel_vulnerabilities</code> alert pointing at a missing microcode update. Our documented guidance said: install the appropriate microcode package, reboot.
    </p>

    <p>
      On Debian-based boxes, this is <code>apt install amd64-microcode</code>. We ran it. The output was:
    </p>

    <pre><code>E: Package 'amd64-microcode' has no installation candidate</code></pre>

    <p>
      The package exists in the Debian archive. It just lives in the <code>non-free-firmware</code> component, which is not enabled in a stock Debian 12 or 13 sources file. A customer following our guidance hits the error and has no obvious next step.
    </p>

    <p>
      The fix on our side was a documentation update: when our guidance recommends <code>amd64-microcode</code>, include a note that <code>non-free-firmware</code> may need to be enabled in <code>/etc/apt/sources.list</code>. The fix on the customer side is a one-line addition to sources.list followed by <code>apt update</code>. Small. But invisible if our docs do not mention it.
    </p>

    <p>
      This is the kind of distro-specific knowledge that does not surface unless someone actually runs the fix path on the affected distro. Vendor documentation, in our experience, never mentions it.
    </p>

    <h2>5. The firewalld vs ufw asymmetry</h2>

    <p>
      Our <code>no_firewall</code> rule shipped with documented commands using ufw, which is the default firewall management tool on Debian, Ubuntu, and derivatives. Customers running Rocky Linux, Alma Linux, or Fedora got the same alert with the same ufw-centric instructions. ufw is not the firewall on those distros. firewalld is.
    </p>

    <p>
      We had not added a RHEL-family branch to our documentation. The fix was straightforward (firewall-cmd commands for enabling firewalld and the SSH service zone), but the documentation gap had been live for months. The customers most affected by it were exactly the customers least likely to know they were affected: operators who know firewalld would naturally adapt our ufw commands, but operators who are newer might just stop.
    </p>

    <p>
      The cross-vendor monitoring lesson here: any documentation that recommends a tool needs to handle the multi-distro case. We had handled it for <code>kernel_needs_reboot</code> (separate apt and dnf commands) but missed it for the firewall rule. The audit pass after this discovery surfaced two other rules with similar gaps.
    </p>

    <h2>6. The Gigabyte DTS firmware offset</h2>

    <p>
      Some Gigabyte AMD motherboards report CPU package temperature via a sensor named <code>CPU&lt;N&gt;_DTS</code>. The reported value is consistently about 30 °C above the actual die temperature, because the sensor is using an internal reference offset that has not been zeroed. This is firmware behavior, not something the operating system can fix.
    </p>

    <p>
      A naive temperature alert built on this sensor would fire at "85 °C package temperature critical" while the actual die was at 55 °C, well within normal range. Our default behavior now is to deprioritise the DTS sensors specifically on these boards, falling back to the per-core sensors which report accurate values. The list of board families needing this treatment grows as we discover more of them.
    </p>

    <p>
      If you are building temperature monitoring across mixed hardware, never trust a sensor named "DTS" without cross-checking it against another sensor on the same chip. The IPMI protocol provides the data faithfully; the firmware producing the data may not.
    </p>

    <h2>The pattern</h2>

    <p>
      These six are not the only cases, just the ones we have hit recently enough to remember in detail. Each one was small in isolation. Collectively they are the reason why cross-vendor monitoring is harder than monitoring a homogeneous fleet, and why "support every vendor" is a multi-quarter commitment rather than a feature flag.
    </p>

    <p>
      The pattern across all six is that the underlying protocol is consistent, but each layer above the protocol introduces vendor or distro variability. The kernel module loads consistently. The /dev/ipmi0 device is consistent. The ipmitool binary's flags are consistent. But the BMC firmware emits whatever it wants. The vendor's documentation may or may not exist. The distro's package manager may or may not have your package. The board's sensor naming may or may not be accurate.
    </p>

    <p>
      If you operate a single-vendor fleet, this is not your problem. If you operate two or three vendors, you can adapt manually. If you operate four or more, you need automation that handles each vendor's quirks as data, not as exceptions in code.
    </p>

    <p>
      Our agent does this with vendor profiles that select sensor mapping rules, BMC quirk overrides, and per-vendor sensor downranking. The list of overrides grows monthly. We do not expect this work to ever finish, because each new motherboard generation introduces its own quirks. The honest framing of our cross-vendor support is: we have caught most of the common ones, we will catch more over time, and we will surface failures via validation tests rather than waiting for customers to hit them.
    </p>

    <p>
      If you are building cross-vendor IPMI tooling, expect the same trajectory. Plan for the audit, not just the build.
    </p>

    <p>
      Read more about how Glassmkr handles bare-metal monitoring: <a href="/docs">the documentation</a>, or <a href="/blog/why-bare-metal-monitoring-is-different">why bare metal monitoring is different</a>.
    </p>

    <footer class="post-footer">
      <p>Published May 25, 2026. By Simon Rybisar.</p>
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
  .post pre {
    margin: 18px 0;
    padding: 16px 20px;
    background: var(--surface-subtle);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }

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
