<script lang="ts">
  // Chapter 5 (spec 10.4): open source and trust. The human questions from
  // content redesign 5.8, answered from checked behavior; the fixed-argv
  // privilege boundary as a real diagram; licenses from configured product
  // facts. The content document's body predates the relicense, so the
  // license claims here read the locked product-facts values instead of the
  // document's stale MIT line.
  import productFacts from "$lib/data/product-facts.json";

  // Each answer is checked against current behavior:
  // - inbound ports / egress: crucible ships snapshots outbound over TLS and
  //   listens on nothing (documented on /trust and in the agent README).
  // - egress content: metrics, alert state, and bounded log excerpts
  //   (corrected in crucible #555; the "metrics only" claim was false and
  //   must not return).
  // - execute fixes: remediation is guidance; the agent never mutates the
  //   server.
  // - removal: one systemd unit, one package, one config directory.
  const questions: [string, string][] = [
    ["Does it open inbound ports?", "No. The agent reports outbound over TLS and listens on nothing."],
    ["Does it execute fixes?", "No. Remediation is guidance for you; the agent never changes your server."],
    ["What leaves the server?", "Metrics, alert state, and bounded log excerpts, sent to the dashboard you choose."],
    ["Can I self-host?", "Yes. The complete stack is public and runs from one compose file."],
    ["Can I remove it?", "Yes. One systemd unit, one package, one config directory."],
  ];

  const facts: [string, string][] = [
    ["Crucible", productFacts.crucibleLicense],
    ["Dashboard", productFacts.dashboardLicenseSpdx],
    ["API", "Open"],
    ["Alert rules", "Open"],
    ["Self-hosting", "Supported"],
    ["Cloud dependency", "None"],
  ];
</script>

<section class="chapter band-std" id="trust">
  <div class="site-grid">
    <div class="col-1-7 head">
      <h2>Monitoring sees deep into your server. You should be able to inspect it.</h2>
      <p class="lede">
        Crucible runs on the machine and reads health data from Linux and
        supported hardware interfaces. The agent and the dashboard are public
        under {productFacts.crucibleLicense}. Privileged reads use a narrow,
        fixed-action boundary rather than running the whole agent as root, and
        the dashboard can be self-hosted, so the monitoring path remains under
        your control.
      </p>
    </div>

    <div class="col-1-6 qa">
      <dl>
        {#each questions as [q, a] (q)}
          <div class="qa-row">
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        {/each}
      </dl>
      <div class="fact-strip" aria-label="License and openness facts">
        {#each facts as [k, v] (k)}
          <span class="fact"><span class="fact-k">{k}</span> <span class="fact-v">{v}</span></span>
        {/each}
      </div>
    </div>

    <figure class="col-8-12 privilege" aria-label="Privilege boundary: the agent runs unprivileged; privileged reads go through a fixed-action wrapper">
      <p class="priv-label">THE PRIVILEGE BOUNDARY</p>
      <div class="priv-diagram">
        <div class="priv-node">
          <p class="priv-node-title">Crucible agent</p>
          <p class="priv-node-sub">runs as <code>glassmkr</code>, unprivileged</p>
        </div>
        <div class="priv-wire" aria-hidden="true">
          <span class="priv-wire-label">one fixed command per action<br />no shell · no caller arguments</span>
        </div>
        <div class="priv-node">
          <p class="priv-node-title">Root-owned wrapper</p>
          <p class="priv-node-sub">allowlisted reads: <code>smartctl</code> · <code>ipmitool</code> · <code>mdadm</code></p>
        </div>
      </div>
      <figcaption class="priv-caption">
        The agent never runs as root. Each privileged read is one auditable,
        fixed-argument action. <a href="/trust">The full inventory is on the Trust page &rarr;</a>
      </figcaption>
    </figure>

    <nav class="col-1-12 trust-links" aria-label="Source and trust resources">
      <a href="https://github.com/glassmkr/glassmkr">Repository</a>
      <a href="/trust">Trust page</a>
      <a href="/docs/getting-started">Review the installer</a>
      <a href="/docs/self-hosting">Self-hosting guide</a>
    </nav>
  </div>
</section>

<style>
  h2 {
    font-size: var(--type-h2);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 14px;
    text-wrap: balance;
  }
  .lede {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 32px;
    max-width: 66ch;
  }

  dl {
    margin: 0 0 20px;
    border-top: 1px solid var(--g-border-strong);
  }
  .qa-row {
    display: grid;
    grid-template-columns: minmax(180px, 4fr) 6fr;
    gap: 8px 20px;
    padding: 12px 0;
    border-bottom: 1px solid var(--g-border-subtle);
  }
  dt {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }
  dd {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .fact-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
  }
  .fact {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .fact-k {
    color: var(--text-tertiary);
  }
  .fact-v {
    color: var(--text-secondary);
  }

  .privilege {
    margin: 0;
    border: 1px solid var(--g-border);
    border-radius: var(--g-radius-2);
    padding: 20px;
    align-self: start;
  }
  .priv-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 16px;
  }
  .priv-diagram {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .priv-node {
    border: 1px solid var(--g-border-strong);
    border-radius: var(--g-radius-2);
    padding: 12px 16px;
  }
  .priv-node-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 3px;
  }
  .priv-node-sub {
    font-size: 12.5px;
    color: var(--text-tertiary);
    margin: 0;
  }
  .priv-node-sub code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
  }
  .priv-wire {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0 10px 24px;
    position: relative;
  }
  .priv-wire::before {
    content: "";
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--g-brand);
  }
  .priv-wire-label {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-tertiary);
    letter-spacing: 0.04em;
  }
  .priv-caption {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-tertiary);
    margin: 14px 0 0;
  }
  .priv-caption a {
    color: var(--g-brand);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .trust-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin-top: 28px;
    border-top: 1px solid var(--g-border-subtle);
    padding-top: 18px;
  }
  .trust-links a {
    font-size: 13.5px;
    color: var(--text-secondary);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  .trust-links a:hover {
    color: var(--text-primary);
  }
  .trust-links a::after {
    content: " \2192";
    color: var(--g-brand);
    margin-left: 6px;
  }

  @media (max-width: 1023px) {
    .qa {
      margin-bottom: 32px;
    }
  }
  @media (max-width: 560px) {
    .qa-row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
