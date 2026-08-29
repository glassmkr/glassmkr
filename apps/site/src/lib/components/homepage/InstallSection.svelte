<script lang="ts">
  // Installation as documentation (design brief section 12): the real
  // command, what actually occurs, and the security posture facts beside
  // it. No window chrome; a code surface, not terminal cosplay.
  import rules from "$lib/data/rules.json";

  const CMD = "curl -fsSL https://glassmkr.com/install.sh | sudo bash";
  let copied = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(CMD);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch { /* selectable text remains */ }
  }

  const steps = [
    "Crucible installed",
    "IPMI detected",
    "2 NVMe drives detected",
    "ECC monitoring available",
    `${rules.length} rules active`,
    "connected",
  ];
  const posture: [string, string][] = [
    ["runs as", "glassmkr"],
    ["root", "no"],
    ["inbound ports", "none"],
    ["transport", "HTTPS"],
  ];
</script>

<section class="install" id="install">
  <div class="inner">
    <h2>One command per server.</h2>
    <p class="lede">
      The installer adds the agent, the Node runtime it needs, and a systemd
      unit, then starts
      reporting. Self-hosted dashboards add one flag:
      <a href="/docs/self-hosting">--ingest-url</a>.
    </p>

    <div class="grid">
      <div class="term">
        <div class="cmd-row">
          <pre><code>$ {CMD}</code></pre>
          <button class="copy-btn" class:ok={copied} onclick={copy} aria-label="Copy install command">
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <p class="alt-label">Or read it before you run it:</p>
        <pre class="alt"><code>curl -fsSL https://glassmkr.com/install.sh -o install.sh
less install.sh
sudo bash install.sh</code></pre>
        <ul class="steps">
          {#each steps as s (s)}
            <li><span class="check" aria-hidden="true">&#10003;</span>{s}</li>
          {/each}
        </ul>
      </div>

      <dl class="posture">
        {#each posture as [k, v] (k)}
          <div class="posture-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        {/each}
        <p class="posture-note">
          Privileged reads go through one fixed-argv wrapper with an
          allowlisted action set. <a href="/trust">The full inventory &rarr;</a>
        </p>
      </dl>
    </div>
  </div>
</section>

<style>
  .install {
    padding: 72px 24px;
    border-top: 1px solid var(--border-subtle);
  }
  .inner { max-width: 1000px; margin: 0 auto; }

  h2 {
    font-size: clamp(24px, 3.2vw, 34px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 10px;
  }
  .lede {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 28px;
    max-width: 620px;
  }

  .grid {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 24px;
    align-items: start;
  }

  .term {
    border: 1px solid var(--border-default);
    background: var(--bg);
    overflow: hidden;
  }
  .cmd-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
  }
  .cmd-row pre { margin: 0; padding: 12px 16px; overflow-x: auto; flex: 1; }
  .cmd-row code {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .copy-btn {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    background: transparent;
    border: none;
    border-left: 1px solid var(--border-subtle);
    padding: 12px 14px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--text-primary); }
  .copy-btn.ok { color: var(--green); }

  .alt-label {
    margin: 14px 0 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  .alt {
    margin: 0 0 4px;
    padding: 10px 12px;
    background: var(--bg);
    /* Already inside the bordered terminal */
    border: none;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .alt code {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-secondary);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 12px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .steps li {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .check { color: var(--green); margin-right: 10px; }

  .posture {
    margin: 0;
    /* A list of links is not an object; the hairline between rows is
       enough structure without a box around the set. */
    border-top: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .posture-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .posture dt {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .posture dd {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-primary);
    margin: 0;
  }
  .posture-note {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    padding: 12px 16px;
    margin: 0;
  }

  @media (max-width: 860px) {
    .grid { grid-template-columns: 1fr; }
  }

  /* Mobile technical-text floor (taste pass 4.1). The provenance line is
     deliberately excluded: 4.2 keeps it exactly as established. */
  @media (max-width: 768px) {
    .alt-label { font-size: 12px; }
    .posture dt { font-size: 12px; }
    .posture dd { font-size: 12px; }
  }
</style>
