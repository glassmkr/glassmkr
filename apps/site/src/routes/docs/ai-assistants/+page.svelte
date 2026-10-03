<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Use Glassmkr in ChatGPT and Claude", item: "https://glassmkr.com/docs/ai-assistants" },
    ],
  });
</script>

<svelte:head>
  <title>Use Glassmkr in ChatGPT and Claude: Glassmkr documentation</title>
  <meta name="description" content="Paste smartctl, zpool status, mdadm, dmesg, ipmitool or nvidia-smi output into ChatGPT or Claude and get a verdict from Glassmkr's own alert rules. Connector URL, setup steps, limits, and what happens to the text you paste." />
  <link rel="canonical" href="https://glassmkr.com/docs/ai-assistants" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/ai-assistants" />
  <meta property="og:title" content="Use Glassmkr in ChatGPT and Claude" />
  <meta property="og:description" content="Glassmkr's alert rules, on command output you paste into an AI assistant. No account, no sign-in." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Use Glassmkr in ChatGPT and Claude" />
  <meta name="twitter:description" content="Glassmkr's alert rules, on command output you paste into an AI assistant. No account, no sign-in." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<!-- The connector is served by the dashboard route
     apps/dashboard/src/routes/api/triage/mcp. Keep the URL, tool names and the
     privacy section on this page in step with that route and with the privacy
     policy's AI assistants section. -->
<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / AI ASSISTANTS</p>
      <h1>Use Glassmkr in ChatGPT and Claude</h1>
      <p class="docs-subtitle">Paste the output of <code>smartctl</code>, <code>zpool status</code>, <code>mdadm</code>, <code>dmesg</code>, <code>ipmitool</code> or <code>nvidia-smi</code> into ChatGPT or Claude, and Glassmkr's own alert rules read it. The connector needs no account, no sign-in, and nothing installed on your servers.</p>
    </header>

    <section id="what">
      <h2><a href="#what" class="anchor-link">#</a>What it does</h2>
      <p>The paste-triage connector is a Model Context Protocol (MCP) server. When you paste command output into a conversation, the assistant hands it to Glassmkr, which runs the same alert rules and fix workflows the dashboard runs on live data from the <a href="/docs/getting-started">Crucible agent</a>. The verdict comes from that rule code, not from the assistant's own judgment; the assistant explains it to you.</p>
      <p>It reads these outputs:</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Area</th><th>Paste the output of</th><th>What the rules look at</th></tr></thead>
          <tbody>
            <tr><td>Drives (SATA, SAS, NVMe)</td><td><code>smartctl -a</code>, <code>smartctl -x</code>, or <code>smartctl -j -a</code> (JSON)</td><td>SMART health and failure attributes, the NVMe critical warning, SSD wear, and disks whose SMART data cannot be read.</td></tr>
            <tr><td>ZFS</td><td><code>zpool status</code> or <code>zpool status -v</code></td><td>Pool and vdev state, scrub errors, and a faulted log (SLOG) device.</td></tr>
            <tr><td>Linux software RAID</td><td><code>cat /proc/mdstat</code> and <code>mdadm --detail /dev/md0</code></td><td>Degraded arrays and which member failed.</td></tr>
            <tr><td>Kernel log</td><td><code>dmesg -T</code> or <code>journalctl -k</code></td><td>Disk errors, NVMe controller resets, ext4 filesystems remounted read-only, NVIDIA Xid events, and uncorrected memory errors reported by EDAC.</td></tr>
            <tr><td>BMC (IPMI)</td><td><code>ipmitool sel elist</code> and <code>ipmitool sel info</code>; for fans, <code>ipmitool sdr type Fan</code>; for power supplies, <code>ipmitool sdr elist</code> (<code>ipmitool sensor</code> prints a power supply's state as a hex code that is not decoded)</td><td>Critical hardware events, uncorrectable memory errors, an event log that is full or nearly full, and failed fans or power supplies.</td></tr>
            <tr><td>NVIDIA GPUs</td><td><code>nvidia-smi -q</code> and <code>nvidia-smi nvlink --status</code></td><td>Uncorrected ECC errors and retired or pending pages, a high corrected-ECC count, thermal slowdown, power-cap throttling, a PCIe link below the GPU's maximum, VBIOS versions that differ between GPUs of the same model, and NVLink links that are down.</td></tr>
          </tbody>
        </table>
      </div>
      <p>One paste can hold several of these at once; each one recognized is read. What comes back to the assistant:</p>
      <ul>
        <li><strong>Findings</strong>: the rule that fired, its severity, the drive, array, pool or GPU it concerns, the values it observed, and the fix workflow for it (a quick check to run and the steps that follow).</li>
        <li><strong>Rules that ran without a match</strong>: the checks that applied to this output and found no matching signal in it. That is not a clean bill of health; it means this output did not show the problem those rules look for.</li>
        <li><strong>What it could not determine</strong>, and why (see <a href="#limits">Limits</a>).</li>
        <li><strong>What to capture next</strong>: the exact command to run when more output would settle the question.</li>
      </ul>
      <p>Fix workflows are instructions for you to read and run yourself. Nothing is executed on your servers; the connector never connects to them.</p>
    </section>

    <section id="connect">
      <h2><a href="#connect" class="anchor-link">#</a>Connect it</h2>
      <p>The connector URL is:</p>
      <pre><code>https://app.glassmkr.com/api/triage/mcp</code></pre>
      <p>It takes no authentication: no account, no sign-in, no API key. You add it by URL, as below; that works today and does not depend on any directory listing.</p>

      <h3>ChatGPT</h3>
      <p>ChatGPT adds MCP servers by URL in developer mode. Whether you can turn developer mode on depends on your ChatGPT plan and, in a workspace, on its admin's policy.</p>
      <ol>
        <li>In ChatGPT, open <strong>Settings</strong>, select <strong>Security and login</strong>, and turn on <strong>Developer mode</strong>.</li>
        <li>Go to <a href="https://chatgpt.com/plugins">chatgpt.com/plugins</a> and select the plus button.</li>
        <li>Enter a name, for example <code>Glassmkr triage</code>, and a short description if asked.</li>
        <li>Under <strong>Connection</strong>, enter <code>https://app.glassmkr.com/api/triage/mcp</code> as the MCP server URL. If the form asks for an authentication method, choose no authentication.</li>
        <li>Create the connection. ChatGPT lists the three tools it found: <strong>Analyze server output</strong>, <strong>Get capture command</strong> and <strong>Get monitoring setup</strong>.</li>
        <li>If it is not already enabled, open your personal plugins at <a href="https://chatgpt.com/plugins?view=personal">chatgpt.com/plugins?view=personal</a> and install it.</li>
        <li>Start a new chat, type <code>@</code> and choose the connector (or enable it from the tools menu), then paste your output.</li>
      </ol>

      <h3>Claude</h3>
      <p>On claude.ai and in the Claude desktop app, add it as a custom connector. Custom connectors depend on your Claude plan; in a Team or Enterprise organization, an owner may need to add it first.</p>
      <ol>
        <li>Open <strong>Settings</strong>, then <strong>Connectors</strong>.</li>
        <li>Select <strong>Add custom connector</strong>.</li>
        <li>Enter a name, for example <code>Glassmkr triage</code>, and the URL <code>https://app.glassmkr.com/api/triage/mcp</code>. Leave any OAuth client fields empty: the connector has no sign-in.</li>
        <li>Select <strong>Add</strong>, then enable the connector for a chat from the tools menu and paste your output.</li>
      </ol>

      <h3>Claude Code</h3>
      <p>Add it from your terminal:</p>
      <pre><code>claude mcp add --transport http glassmkr-triage https://app.glassmkr.com/api/triage/mcp</code></pre>
      <p>Add <code>--scope user</code> to make it available in every project rather than only the current one. Run <code>/mcp</code> inside Claude Code to confirm it is connected; there is no authentication step.</p>

      <h3>Other MCP clients</h3>
      <p>Any client that supports remote MCP servers over streamable HTTP can use the same URL with no authentication.</p>
    </section>

    <section id="examples">
      <h2><a href="#examples" class="anchor-link">#</a>Example prompts</h2>
      <p>Paste the full output rather than a summary of it, and say what you want to know:</p>
      <ul>
        <li>"Is this drive failing?" followed by the output of <code>sudo smartctl -a /dev/sda</code>.</li>
        <li>"One of my arrays looks degraded. Which disk do I replace?" with <code>cat /proc/mdstat</code> and <code>sudo mdadm --detail /dev/md0</code>.</li>
        <li>"Is this pool OK to keep running?" with <code>zpool status -v</code>.</li>
        <li>"Anything in here I should worry about?" with <code>sudo dmesg -T</code> or <code>sudo journalctl -k -b -o short-iso</code>.</li>
        <li>"What do these BMC events mean?" with <code>sudo ipmitool sel elist</code>.</li>
        <li>"Is one of these GPUs unhealthy?" with <code>nvidia-smi -q</code> and <code>nvidia-smi nvlink --status</code>.</li>
        <li>"What should I run to check my NVMe drives?" The assistant asks Glassmkr for the exact capture command, which you run and paste back.</li>
        <li>"How do I keep an eye on this continuously?" The assistant returns the steps to install and enroll Crucible.</li>
      </ul>
      <p>If the output is very long, paste the part for the device or time window you are asking about. To hide hostnames or serial numbers, replace each one with a different placeholder (for example <code>DISK1</code>, <code>DISK2</code>): when the output does not name each device, the serial number is what tells two drives apart, so giving every drive the same placeholder merges them. Leave GPU UUIDs as they are.</p>
    </section>

    <section id="limits">
      <h2><a href="#limits" class="anchor-link">#</a>Limits: what one paste cannot tell you</h2>
      <p>A paste is a single moment, and only what is in it gets judged. Several things need history that one paste does not have:</p>
      <ul>
        <li><strong>Trends and rates.</strong> Whether a SMART counter such as reallocated or pending sectors is still climbing, or how fast an SSD is wearing, needs earlier readings to compare against.</li>
        <li><strong>Recurrence.</strong> Whether an error came back after it was cleared, or keeps arriving, needs a record over time.</li>
        <li><strong>Absence.</strong> A server that stopped reporting leaves nothing to paste, and telling a planned reboot from an unplanned one needs a record of uptime.</li>
        <li><strong>Unseen devices.</strong> A drive, array or GPU that is not in the output is not checked.</li>
        <li><strong>Undated events.</strong> Plain <code>dmesg</code> stamps lines with seconds since boot, and plain <code>journalctl -k</code> prints no year, so the result reports the time of those events as unknown rather than guessing one. <code>dmesg -T</code> and <code>journalctl -k -o short-iso</code> carry full dates.</li>
      </ul>
      <p>Each result lists what it could not determine, so the assistant can say so instead of filling the gap.</p>
      <p><strong>Continuous monitoring answers these.</strong> <a href="https://github.com/glassmkr/crucible">Crucible</a>, the open-source agent, collects these signals on a schedule and the dashboard keeps the history the trend, recurrence and absence rules need, then notifies you when one fires. Install it on the hosted dashboard with <a href="/docs/getting-started">Getting started</a>, or run the whole stack yourself with <a href="/docs/self-hosting">Self-hosting</a>. Already running Crucible? The <a href="/docs/mcp">authenticated MCP server</a> gives an assistant your fleet's live health and alerts, with your consent.</p>
    </section>

    <section id="privacy">
      <h2><a href="#privacy" class="anchor-link">#</a>Privacy</h2>
      <ul>
        <li><strong>The text you paste is not kept.</strong> Glassmkr processes it in memory to produce the result and returns that result to your assistant. Glassmkr does not store it or write it to any log.</li>
        <li><strong>What is logged.</strong> One line per call: which tool was called, the output formats detected, the input size, the rule ids of any findings, how long the call took, whether the call succeeded or was rate limited, and, when the assistant sends an anonymous requester identifier, a hash of it used for rate limiting.</li>
        <li><strong>No account involved.</strong> Calls are anonymous and nothing ties them to a Glassmkr account.</li>
        <li><strong>The conversation is the provider's.</strong> What you type and paste into ChatGPT or Claude, and what the assistant replies, is handled by OpenAI or Anthropic under their own policies, not Glassmkr's.</li>
      </ul>
      <p>The full details, including request metadata and retention, are in the <a href="/privacy">privacy policy</a>.</p>
    </section>

    <section id="support">
      <h2><a href="#support" class="anchor-link">#</a>Support</h2>
      <p>For help with the connector, email <a href="mailto:support@glassmkr.com">support@glassmkr.com</a> or open an issue at <a href="https://github.com/glassmkr/glassmkr/issues">github.com/glassmkr/glassmkr/issues</a>. Leave hostnames, serial numbers and keys out of a public issue.</p>
    </section>

    <section id="tools">
      <h2><a href="#tools" class="anchor-link">#</a>Tools</h2>
      <p>All three are read-only: they take text in and return text out, and change nothing anywhere.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Tool</th><th>Name</th><th>Does</th></tr></thead>
          <tbody>
            <tr><td>Analyze server output</td><td><code>analyze_server_output</code></td><td>Runs Glassmkr's alert rules on pasted command output and returns findings, fix workflows, what it could not determine, and what to capture next.</td></tr>
            <tr><td>Get capture command</td><td><code>get_capture_command</code></td><td>Returns the exact commands that produce output it can read, for a goal such as all disks, one disk, NVMe drives, an md array, a ZFS pool, kernel errors, GPUs, NVLink, or BMC events.</td></tr>
            <tr><td>Get monitoring setup</td><td><code>get_monitoring_setup</code></td><td>Returns the steps to install, enroll and verify Crucible for continuous monitoring.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </article>

<style>
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.25rem; margin-bottom: 0.5rem; }
  ol { color: var(--text-secondary); line-height: 1.7; padding-left: 1.25rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; font-size: 0.875rem; }

  /* Mobile technical-text floor: 12px minimum on a phone. */
  @media (max-width: 768px) {
    code { font-size: 12px; }
  }</style>
