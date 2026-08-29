<svelte:head>
  <title>IPMI diagnostics for bare metal: what to monitor and how to read it - Glassmkr Blog</title>
  <meta name="description" content="A practical guide to monitoring IPMI sensors, SEL logs, and BMC health on Dell, Supermicro, and HPE servers. Covers kipmi0 CPU issues, vendor quirks, and what to alert on for bare metal infrastructure." />

  <!-- OpenGraph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/ipmi-diagnostics-bare-metal" />
  <meta property="og:title" content="IPMI diagnostics for bare metal: what to monitor and how to read it" />
  <meta property="og:description" content="A practical guide to monitoring IPMI sensors, SEL logs, and BMC health on Dell, Supermicro, and HPE servers." />
  <meta property="og:image" content="https://glassmkr.com/og/ipmi-diagnostics-bare-metal.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Terminal output of ipmitool sensor: CPU1 Temp 38 C ok, CPU2 Temp 89 C critical, Inlet 22 C, FAN1 0 RPM critical, PS1 status 0x0b non-critical" />
  <meta property="og:site_name" content="Glassmkr" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="IPMI diagnostics for bare metal: what to monitor and how to read it" />
  <meta name="twitter:description" content="A practical guide to monitoring IPMI sensors, SEL logs, and BMC health on Dell, Supermicro, and HPE servers." />
  <meta name="twitter:image" content="https://glassmkr.com/og/ipmi-diagnostics-bare-metal.png?v=20260826" />
  <meta name="twitter:image:alt" content="ipmitool sensor output showing CPU2 at 89C critical, FAN1 at 0 RPM, mixed PSU status" />
  <link rel="canonical" href="https://glassmkr.com/blog/ipmi-diagnostics-bare-metal" />

  <!-- Structured data: Article + BreadcrumbList. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "IPMI diagnostics for bare metal: what to monitor and how to read it",
    description: "A practical guide to monitoring IPMI sensors, SEL logs, and BMC health on Dell, Supermicro, and HPE servers. Covers kipmi0 CPU issues, vendor quirks, and what to alert on.",
    image: "https://glassmkr.com/og/ipmi-diagnostics-bare-metal.png?v=20260826",
    datePublished: "2026-04-17",
    dateModified: "2026-04-17",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/ipmi-diagnostics-bare-metal.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/ipmi-diagnostics-bare-metal",
    articleSection: "Operations"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "IPMI diagnostics for bare metal", item: "https://glassmkr.com/blog/ipmi-diagnostics-bare-metal" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <p class="post-meta">April 2026 · Operations</p>

    <h1>IPMI diagnostics for bare metal: what to monitor and how to read it</h1>

    <p>If you run dedicated servers at Hetzner, OVH, Leaseweb, or any other bare metal provider, you're probably aware that your hosting provider doesn't tell you much about the hardware underneath your OS. A server can be running 87 degrees C in your rack and your provider will only email you when it catches fire. Or when the landlord below complains about smoke.</p>

    <p>IPMI is how you fix this. It's been around since 1998, it's in almost every enterprise server built in the last two decades, and most operators either don't use it or use it wrong. This post walks through what IPMI actually is, what to monitor, and where most setups go sideways.</p>

    <h2>What IPMI is, briefly</h2>

    <p>IPMI stands for Intelligent Platform Management Interface. It's a specification for a dedicated microcontroller called the BMC (Baseboard Management Controller) that sits on your server's motherboard and runs independently of the CPU, OS, or even whether the server is powered on. The BMC has its own network stack, its own firmware, and its own view of the hardware.</p>

    <p>That independence is the point. When your OS hangs, the BMC still responds. When your CPU throttles from thermal runaway, the BMC knows before the kernel does. When a fan fails, the BMC logs it in a persistent System Event Log (SEL) that survives reboots and kernel panics.</p>

    <p>Vendors implement IPMI with branded stacks on top: Dell calls theirs iDRAC, HPE calls theirs iLO, Supermicro has IPMI 2.0 and more recently Redfish. They all speak the underlying IPMI protocol, but they wrap it in their own web UIs, sometimes diverge on sensor naming, and occasionally break the spec in creative ways.</p>

    <h3>In-band vs out-of-band</h3>

    <p>There are two ways to talk to IPMI:</p>

    <p><strong>In-band</strong> means the OS talks to the BMC over a local interface (usually <code>/dev/ipmi0</code>, exposed by the <code>ipmi_si</code> or <code>ipmi_ssif</code> kernel module). This requires the IPMI kernel modules and a tool like <code>ipmitool</code> or <code>freeipmi</code>. You don't need network access to the BMC, but you do need the OS to be running.</p>

    <p><strong>Out-of-band</strong> means you talk to the BMC over its dedicated network interface (or shared NIC in some configurations) via IPMI over LAN, or through the vendor's web UI. This works when the OS is down, but requires network routing to the BMC's IP.</p>

    <p>For monitoring, in-band is what you usually want. It's always reachable as long as your agent runs, it doesn't require exposing the BMC to the network, and it reads the same sensors as out-of-band. Out-of-band is for emergencies when the OS is unreachable.</p>

    <h3>Types of sensors</h3>

    <p>A typical server exposes between 20 and 100 IPMI sensors. The categories that matter:</p>

    <ul>
      <li><strong>Temperature:</strong> CPU cores, inlet ambient, exhaust, motherboard, DIMMs, disk backplane, GPU</li>
      <li><strong>Fan speed:</strong> System fans, CPU fans, PSU fans. Usually reported in RPM</li>
      <li><strong>Voltage:</strong> 12V, 5V, 3.3V rails, CPU VCORE, battery backup</li>
      <li><strong>Current:</strong> System current draw, per-PSU current</li>
      <li><strong>Power:</strong> Total system wattage, per-PSU wattage</li>
      <li><strong>Chassis:</strong> Intrusion detection, PSU presence, fan presence</li>
      <li><strong>Discrete sensors:</strong> Specific OK/FAIL indicators for components</li>
    </ul>

    <p>There are two flavors in the data you'll read: threshold sensors (have numeric readings and upper/lower critical thresholds set by the vendor) and discrete sensors (just state: OK, failed, absent, etc.).</p>

    <h2>What your hosting provider does and does not monitor</h2>

    <p>Short answer: they monitor whether your server responds to ping. That's it, at most providers.</p>

    <p>Hetzner gives you SysMon, which checks ICMP and TCP ports with a six-minute delay. No hardware health whatsoever. Their AX line (their most common modern option, built on consumer AMD Ryzen hardware) doesn't have IPMI at all. This isn't a limitation of the Ryzen platform itself. Ryzen works fine with IPMI on boards that include a BMC chip, like the ASRock Rack X470D4U/X570D4U/B650D4U series, Supermicro H13SAE-MF, ASUS Pro WS B850M-ACE SE, or Gigabyte MC13. Hetzner simply chose consumer-grade boards without BMCs for their AX servers to hit a price point. Their EX Intel line and their Dell-based servers still include IPMI normally. But if you have an AX server, IPMI is not an option, and you're stuck with OS-level monitoring only.</p>

    <p>OVH monitors ping with three intervention modes: alert only, alert and check, or alert and intervene. Their RTM monitoring agent was archived in September 2022 and hasn't been replaced. They do provide IPMI access through their control panel via a managed KVM/Java applet, which is fine for console access during emergencies but not for automated monitoring.</p>

    <p>Leaseweb is the most complete of the major providers. They recently launched agentless IPMI-based hardware monitoring that reads temperature, power, and fan speed every five minutes, but only in Netherlands data centers. They also expose raw IPMI via OpenVPN for customers who want direct BMC access.</p>

    <p>Vultr bare metal gives you bandwidth graphs and a VNC console. No IPMI exposure, no sensor data.</p>

    <p class="provenance"><em>Hosting-provider policies above last verified: 2026-05-21.</em></p>

    <p>The pattern is clear. Hosting providers compete on hardware and price, not software services. If you want to know your server's internals, you're collecting that data yourself.</p>

    <h2>Reading IPMI sensors with ipmitool</h2>

    <p>Install the tool:</p>

    <pre><code>sudo apt-get install ipmitool        # Debian/Ubuntu
sudo dnf install ipmitool            # RHEL/Rocky/Alma
sudo zypper install ipmitool         # openSUSE</code></pre>

    <p>Then load the kernel module:</p>

    <pre><code>sudo modprobe ipmi_devintf
sudo modprobe ipmi_si</code></pre>

    <p>Now dump sensors. This is the command you'll run most often:</p>

    <pre><code>sudo ipmitool sensor</code></pre>

    <p>This returns a dense table: sensor name, current reading, units, status, and thresholds. Temperature sensors look like this:</p>

    <pre><code>CPU1 Temp        | 38.000     | degrees C  | ok    | 0.000     | 0.000     | 0.000     | 85.000    | 87.000    | 88.000
CPU2 Temp        | 40.000     | degrees C  | ok    | 0.000     | 0.000     | 0.000     | 85.000    | 87.000    | 88.000
System Temp      | 27.000     | degrees C  | ok    | -9.000    | -7.000    | -5.000    | 80.000    | 85.000    | 90.000</code></pre>

    <p>The status column shows <code>ok</code>, <code>nc</code> (non-critical), <code>cr</code> (critical), or <code>nr</code> (non-recoverable). The rightmost three numeric columns are upper thresholds: non-critical, critical, non-recoverable. The three numeric columns before the status are lower thresholds.</p>

    <p>For fans and voltages, use the same command and filter:</p>

    <pre><code>sudo ipmitool sensor | grep -iE "fan|rpm"
sudo ipmitool sensor | grep -iE "volt|vcore"</code></pre>

    <p>To read the System Event Log (SEL), which is where hardware failures get recorded:</p>

    <pre><code>sudo ipmitool sel list
sudo ipmitool sel elist            # extended, includes timestamps and sensor numbers
sudo ipmitool sel info             # how many entries, how much space left</code></pre>

    <p>A SEL entry looks like:</p>

    <pre><code>   1 | 04/12/2026 | 14:23:07 | Fan #0x46 | Lower Critical going low | Asserted
   2 | 04/12/2026 | 14:23:15 | Power Supply #0xa8 | Failure detected | Asserted</code></pre>

    <p>The SEL is persistent. It survives reboots and BIOS updates. When it fills up, new events stop being recorded until you clear it:</p>

    <pre><code>sudo ipmitool sel clear</code></pre>

    <h2>Common pitfalls</h2>

    <h3>kipmi0 eating 100% CPU</h3>

    <p>The most common IPMI problem you'll encounter. The <code>kipmi0</code> kernel thread polls the BMC for responses, and on some hardware, it polls too aggressively. You'll see one CPU core pegged at 100% in top, attributed to <code>kipmi0</code>, and the system will run warmer and consume more power than it should.</p>

    <p>The fix is a kernel module parameter: <code>kipmid_max_busy_us</code>. It tells the kernel how many microseconds to busy-poll before yielding. The default behavior is to poll aggressively until an operation completes. Setting this to a lower value limits polling.</p>

    <p>Temporary fix (resets on reboot):</p>

    <pre><code>echo 100 | sudo tee /sys/module/ipmi_si/parameters/kipmid_max_busy_us</code></pre>

    <p>Permanent fix:</p>

    <pre><code>echo "options ipmi_si kipmid_max_busy_us=100" | sudo tee /etc/modprobe.d/ipmi.conf
sudo rmmod ipmi_si
sudo modprobe ipmi_si</code></pre>

    <p>Useful values are 100 to 500. Lower values mean less CPU used by kipmi0, but IPMI queries take longer to respond (potentially seconds instead of milliseconds). For monitoring at 60-second intervals, 100 is fine.</p>

    <h3>SEL log overflow</h3>

    <p>The SEL has a fixed size, typically 512 or 1024 entries depending on the vendor. If you don't clear it, old hardware errors pile up and eventually block new ones from being recorded. Worse, if you monitor SEL and get alerted on new entries, a full SEL means you stop getting alerted on new hardware problems.</p>

    <p>Check periodically:</p>

    <pre><code>sudo ipmitool sel info | grep "Percent Used"</code></pre>

    <p>When it hits 75%, clear it (after archiving the entries if you care about the history):</p>

    <pre><code>sudo ipmitool sel list > /var/log/ipmi-sel-$(date +%Y%m%d).log
sudo ipmitool sel clear</code></pre>

    <h3>Vendor quirks</h3>

    <p>This is where IPMI gets genuinely annoying. The spec allows vendors a lot of interpretation, and they've each taken it in different directions.</p>

    <p><strong>Supermicro</strong> exposes the most sensors of any major vendor but is inconsistent about naming. A CPU temperature sensor might be <code>CPU Temp</code>, <code>CPU1 Temp</code>, <code>Proc 1 Temp</code>, or <code>DIMM CPU 1 Temp</code> depending on the board generation. Alerting by exact sensor name breaks when you swap hardware generations.</p>

    <p><strong>Dell iDRAC</strong> has a much cleaner sensor model but occasionally exposes discrete sensors in ways that confuse generic parsers. A PSU redundancy sensor, for example, might report state as a hex bitmask rather than a clean enum. Reading <code>ipmitool sdr elist</code> and parsing the discrete state text is more reliable than reading raw sensor data.</p>

    <p><strong>HPE iLO</strong> is the strictest about the spec and the most limited. Sensor readings are clean, but HPE locks down a lot of IPMI functionality behind iLO licenses and the ILO firmware. Some enterprise features (like SEL export) require a paid advanced license.</p>

    <p><strong>Ambient temperature sensor naming</strong> varies wildly: <code>Inlet Temp</code>, <code>Ambient</code>, <code>System Ambient</code>, <code>Front Panel Temp</code>. If you're trying to alert on ambient temperature (important for detecting HVAC issues), match on multiple name patterns.</p>

    <p><strong>Power supply sensors</strong> on servers with redundant PSUs report status differently across vendors. Some report per-PSU watts plus a "PSU Status" discrete sensor. Others only report status. Alerting on "any PSU not present" requires parsing the discrete status, not just the numeric reading.</p>

    <h3>IPMI over shared NICs</h3>

    <p>Many servers support a "shared NIC" mode where the BMC uses the same physical network port as the OS. This saves a switch port but creates a subtle problem: if your host firewall blocks the BMC's IPMI port (623/udp), you can't reach the BMC over the network. Worse, some providers configure this by default and don't tell you.</p>

    <p>Check which NIC mode your BMC is using:</p>

    <pre><code>sudo ipmitool lan print 1 | grep -iE "IP Address|MAC|Channel"</code></pre>

    <p>If the IP address is in your server's main subnet and the MAC address is the same as a system NIC, you're in shared mode. If the BMC has a separate IP in a management network, you're in dedicated mode.</p>

    <h2>What to alert on</h2>

    <p>Thirty-plus sensors per server means thirty-plus potential alerts. Most of them will never fire. Here are the handful that matter:</p>

    <p><strong>CPU temperature above 80 degrees C (warning) or 90 degrees C (critical).</strong> Modern CPUs will throttle themselves above about 95 degrees, and by then you're losing performance. 80 degrees is your "something is wrong with cooling" threshold. Don't alert on ambient temperature crossing CPU thresholds: exclude ambient/inlet/chipset sensors from CPU alerts. Bonus points for also alerting against the BMC's reported upper_critical threshold if it's lower than your absolute threshold (some servers are configured conservatively).</p>

    <p><strong>Fan RPM at 0 or below the vendor's lower_critical threshold.</strong> A dead fan doesn't always kill a server immediately, but it's a ticking clock. Critical alert, page someone.</p>

    <p><strong>PSU failure on servers with redundant PSUs.</strong> If you have N+1 power supplies and one fails, you're still running but a second failure brings down the server. Critical alert, but watch out for the Dell discrete-sensor parsing issue mentioned above.</p>

    <p><strong>Fan presence / PSU presence.</strong> Some servers let you detect when a module is physically removed. Useful for detecting maintenance mishaps.</p>

    <p><strong>ECC memory errors (correctable and uncorrectable).</strong> Correctable errors are a warning: the memory is degrading and should be replaced at the next maintenance window. Uncorrectable errors are critical and usually precede a kernel panic. Both are reported via IPMI on servers with ECC RAM, typically in a BIOS event or as discrete sensors like "Memory ECC" or specific "Correctable ECC Logging Limit Reached" entries.</p>

    <p><strong>SEL critical entries in the last 24 hours.</strong> Filter out informational entries and alert on anything marked critical or non-recoverable. The rule of thumb: a "Lower Critical going low" event on a fan or voltage is an alert.</p>

    <p><strong>BMC itself reachable.</strong> Sometimes the BMC firmware hangs or the <code>ipmi_si</code> module disconnects. Alert if <code>ipmitool mc info</code> fails to return for over 10 minutes.</p>

    <p>What not to alert on: every non-critical sensor that the BMC flags. Modern servers set conservative thresholds and flag <code>nc</code> (non-critical) warnings for transient temperature spikes that happen during normal load. If you alert on every <code>nc</code> sensor, you'll silence the channel after the first night.</p>

    <h2>A minimal monitoring pattern</h2>

    <p>On your server:</p>

    <ul>
      <li>Install <code>ipmitool</code> and load the <code>ipmi_devintf</code> and <code>ipmi_si</code> kernel modules at boot</li>
      <li>Set <code>kipmid_max_busy_us=100</code> in <code>/etc/modprobe.d/ipmi.conf</code></li>
      <li>Run a periodic collector that:
        <ul>
          <li>Executes <code>ipmitool sensor</code> and parses the output</li>
          <li>Filters sensor names for CPU temperature (not ambient, not chipset)</li>
          <li>Checks fan RPM against lower_critical thresholds from the BMC</li>
          <li>Checks PSU discrete sensors for redundancy loss</li>
          <li>Reads SEL entries newer than the last check timestamp</li>
          <li>Filters SEL for critical and non-recoverable severity</li>
          <li>Clears the SEL when it exceeds 75% used (after archiving)</li>
        </ul>
      </li>
      <li>Send alerts to Slack, Telegram, email, or whatever channel you actually read</li>
    </ul>

    <p>If you're doing this from scratch and running more than three or four servers, the collector quickly becomes the most interesting part of your infrastructure, and you're writing parsers for vendor quirks at midnight when you should be working on your actual product. This is why monitoring tools exist.</p>

    <!-- Canonical rule count: see RULES_COUNT.md at the monorepo root. -->
    <p>The 68 alert rules in Glassmkr (Crucible v0.13.6 at time of writing) include six rules in our hardware/BMC category that specifically target IPMI and BMC signals: CPU temperature with ambient exclusion, IPMI fan failure with BMC threshold awareness, PSU redundancy loss with Dell discrete-sensor parsing, ECC error tracking, MCE uncorrected events, and SEL critical severity with 24-hour windowing. Where a parser hasn't been validated against a vendor in production (some HPE iLO, OpenBMC, and Cisco UCS paths are <code>parser_quality: "stub"</code> today), Dashboard surfaces that as a soft "not yet observed on this hardware" rather than dressing it up as production-ready. You can try it free for three servers at <a href="https://glassmkr.com/docs">glassmkr.com/docs</a>. Or read the <a href="https://github.com/glassmkr/crucible">open-source agent source</a> and roll your own. For the wider hardware-monitoring context, see our <a href="/blog/ipmi-smart-raid-hardware-monitoring">positioning post on the IPMI / SMART / RAID gap</a>.</p>

    <p>Either way: monitor your IPMI. Your hosting provider isn't going to do it for you.</p>

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
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.75;
    margin-bottom: 16px;
    padding-left: 24px;
  }

  li {
    margin-bottom: 6px;
  }

  code {
    font-size: 13px;
    background: var(--surface-raised);
    padding: 2px 6px;
    border-radius: var(--radius-md);
  }

  pre {
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
    overflow-x: auto;
    margin-bottom: 16px;
  }

  pre code {
    background: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
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
