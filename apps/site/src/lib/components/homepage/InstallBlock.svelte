<script lang="ts">
  // Two tabs: Linux (systemd) and Raspberry Pi, both the single
  // `curl | sudo bash` installer. (A `curl | sh` tab was dropped because
  // install.sh is `#!/bin/bash` and needs `sudo bash`; the Docker Compose
  // tab was dropped in 0.14.2 when the container deployment was removed.)
  import rules from "$lib/data/rules.json";

  type Tab = {
    id: string;
    label: string;
    cmd: string;
    output: string[];
  };

  // Rule count from the generated catalog, never a literal.
  let tabs = $derived<Tab[]>([
    {
      id: "systemd",
      label: "Linux (systemd)",
      cmd: "$ curl -sf https://glassmkr.com/install.sh | sudo bash",
      output: [
        "✓ Connected to app.glassmkr.com (eu-ams-1)",
        "✓ Detected: 2 disks (Samsung MZ7L3480), IPMI v2.0, ECC RAM",
        `✓ ${rules.length} alert rules active`,
        "✓ Streaming telemetry. View at app.glassmkr.com/h/abc123",
      ],
    },
  ]);

  let active = $state("systemd");
  let activeTab = $derived(tabs.find((t) => t.id === active) ?? tabs[0]);
  let copied = $state(false);

  async function copy() {
    const text = activeTab.cmd.replace(/^\$\s+/gm, "");
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch { /* clipboard not available */ }
  }
</script>

<section class="install-block">
  <div class="inner">
    <h2>Connect a server in sixty seconds.</h2>
    <p class="lede">One command. The agent auto-detects your hardware.</p>

    <div class="terminal" role="region" aria-label="Install command">
      <div class="tabs" role="tablist">
        {#each tabs as t}
          <button
            class="tab"
            class:active={t.id === active}
            onclick={() => (active = t.id)}
            role="tab"
            aria-selected={t.id === active}
          >
            {t.label}
          </button>
        {/each}
        <!-- Copy lives in the tab bar's empty right side: a toolbar position
             anchored to the visible chrome, rather than floating over the
             (now borderless) code area. -->
        <button class="copy-btn" class:ok={copied} onclick={copy} aria-label="Copy install command">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div class="terminal-body" role="tabpanel">
        <div class="code-wrap">
          <pre><code class="cmd">{activeTab.cmd}</code><br /><br /><code class="output">{activeTab.output.join("\n")}</code></pre>
        </div>
      </div>
    </div>

    <p class="install-footnote">
      What this does: installs Node if the host lacks it, installs the Crucible package from npm, sets it up as a systemd service, and registers the node with your account. <span class="nowrap">Source: bash script at <a href="https://glassmkr.com/install.sh">install.sh</a></span>, about 130 lines.
    </p>

    <a class="docs-link" href="/docs">Or read the install docs &rarr;</a>
  </div>
</section>

<style>
  .install-block {
    padding: 96px 24px;
  }
  .inner {
    max-width: 760px;
    margin: 0 auto;
    text-align: center;
  }

  h2 {
    font-size: clamp(28px, 4.4vw, 40px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 0 0 16px;
  }

  .lede {
    font-size: 15px;
    color: var(--text-secondary);
    margin: 0 0 36px;
    line-height: 1.6;
  }

  .terminal {
    background: #0d0d0d;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    text-align: left;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--surface-border);
    background: rgba(255, 255, 255, 0.015);
  }
  .tab {
    background: none;
    border: none;
    padding: 12px 18px;
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    color: var(--text-tertiary);
    cursor: pointer;
    border-right: 1px solid var(--surface-border);
    transition: color 0.15s, background 0.15s;
  }
  .tab:hover { color: var(--text-secondary); }
  .tab.active {
    color: var(--accent);
    background: rgba(245, 166, 35, 0.04);
  }

  .terminal-body {
    padding: 24px 24px 26px;
  }

  /* Positioning context for the copy button: hugs the code so the button
     lands on the command's top-right, not in the terminal's chrome. */
  .code-wrap {
    position: relative;
  }

  pre {
    /* The .terminal is the frame. Without this reset a global code-block
       style gives this <pre> its own border/background/radius/padding, which
       nests a second box inside the terminal (the "box in a box"). Strip it so
       the command + output sit bare inside the single terminal frame. */
    margin: 0;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 0;
    overflow-x: auto;
  }

  code.cmd {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--accent);
    line-height: 1.6;
    white-space: pre-wrap;
  }
  code.output {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--text-tertiary);
    line-height: 1.7;
    white-space: pre;
  }

  /* Matches the docs code-copy button (docs/+layout.svelte) so the two
     read as one component across the site: same surface, padding, font,
     hover-to-accent, and green "Copied" confirmation. */
  .copy-btn {
    margin-left: auto;
    align-self: center;
    margin-right: 10px;
    background: var(--surface);
    color: var(--text-secondary);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 4px 12px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .copy-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .copy-btn.ok {
    color: var(--green, #10b981);
    border-color: var(--green, #10b981);
  }

  .install-footnote {
    margin: 20px auto 0;
    max-width: 640px;
    text-align: left;
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-tertiary);
  }
  .install-footnote a {
    color: var(--text-secondary);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .install-footnote a:hover { color: var(--accent); text-decoration-color: var(--accent); }
  .install-footnote .nowrap { white-space: nowrap; }

  .docs-link {
    display: inline-block;
    margin-top: 16px;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .docs-link:hover {
    color: var(--accent);
    text-decoration: none;
  }

  @media (max-width: 600px) {
    .install-block { padding: 64px 20px; }
    .tabs { overflow-x: auto; }
    .tab { white-space: nowrap; }
  }
</style>
