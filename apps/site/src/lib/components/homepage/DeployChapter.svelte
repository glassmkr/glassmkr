<script lang="ts">
  // Chapter 4 (spec 10.4): start hosted, retain control. Hosted first and
  // visually recommended, self-hosted second, quieter but complete; one
  // shared comparison baseline rather than two oversized cards (content
  // redesign 5.7 and 5.9, exact copy). The node cap is configured product
  // data, never a literal.
  import { HOSTED_NODE_CAP } from "$lib/product-facts";

  const steps = [
    "Create a free hosted account.",
    "Name the server.",
    "Copy the generated install command into SSH.",
    "Confirm the first snapshot and notification channel.",
  ];

  const baseline: [string, string, string][] = [
    ["Source", "Same public AGPL-3.0-only stack", "Same public AGPL-3.0-only stack"],
    ["Deployment", "Nothing to run; one agent per server", "Docker Compose on your host, plus the agent"],
    ["Data location", "Glassmkr's dashboard in Amsterdam", "Your network; telemetry never leaves it"],
    ["Operations", "Updates, storage, and backups operated by Glassmkr", "You operate databases, upgrades, backups, and TLS"],
    ["Node limit", `Free up to ${HOSTED_NODE_CAP} nodes`, "No node limit"],
  ];
</script>

<section class="chapter band-std" id="deploy">
  <div class="site-grid">
    <div class="col-1-4 rail">
      <h2>Start hosted. Self-host when you need the control.</h2>
      <p class="setup-h">From no monitoring to your first health snapshot in about five minutes.</p>
      <ol class="steps">
        {#each steps as s, i (s)}
          <li>{s}</li>
        {/each}
      </ol>
      <p class="setup-body">
        Glassmkr detects the supported hardware and starts evaluating the
        shipped checks. You do not need to build a dashboard or choose
        thresholds before the first useful result.
      </p>
      <p class="installer-link">
        <a href="/docs/getting-started">Read exactly what the installer does &rarr;</a>
      </p>
    </div>

    <div class="col-5-12 paths">
      <div class="path recommended">
        <p class="path-label">HOSTED GLASSMKR <span class="rec-tag">RECOMMENDED START</span></p>
        <p class="path-body">Best when you want monitoring without another service to maintain.</p>
        <a href="https://app.glassmkr.com/register" class="btn btn-primary">Create a free account</a>
      </div>
      <div class="path">
        <p class="path-label">SELF-HOSTED GLASSMKR</p>
        <p class="path-body">
          Best when telemetry must remain on your network or you want complete
          operational control. Equally available; you carry the operations.
        </p>
        <a href="/docs/self-hosting" class="btn btn-quiet-sm">Read the self-hosting guide</a>
      </div>

      <div class="table-scroll" tabindex="0" role="region" aria-label="Hosted versus self-hosted comparison">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Hosted</th>
              <th>Self-hosted</th>
            </tr>
          </thead>
          <tbody>
            {#each baseline as [k, hosted, self] (k)}
              <tr>
                <td class="row-key">{k}</td>
                <td>{hosted}</td>
                <td>{self}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</section>

<style>
  h2 {
    font-size: var(--type-h2);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 22px;
    text-wrap: balance;
  }
  .setup-h {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 12px;
    line-height: 1.5;
  }
  .steps {
    margin: 0 0 14px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .steps li {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .setup-body {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-tertiary);
    margin: 0 0 14px;
  }
  .installer-link a {
    font-size: 13.5px;
    color: var(--g-brand);
    text-decoration: underline;
    text-underline-offset: 3px;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }

  .paths {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--grid-gap);
    align-content: start;
  }
  .path {
    border: 1px solid var(--g-border);
    border-radius: var(--g-radius-2);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }
  .path.recommended {
    border-color: var(--g-brand-edge);
  }
  .path-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-primary);
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }
  .rec-tag {
    font-size: 12px;
    color: var(--g-brand);
    letter-spacing: 0.08em;
  }
  .path-body {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
    flex: 1;
  }
  :global(.btn.btn-quiet-sm) {
    background: transparent;
    border: 1px solid var(--g-border-strong);
    color: var(--text-primary);
  }
  :global(.btn.btn-quiet-sm:hover) {
    border-color: var(--g-brand-edge);
    background: transparent;
  }

  .table-scroll {
    grid-column: 1 / -1;
    overflow-x: auto;
    margin-top: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 560px;
  }
  th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    font-weight: 500;
    padding: 10px 20px 10px 0;
    border-bottom: 1px solid var(--g-border-strong);
  }
  td {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    padding: 11px 20px 11px 0;
    border-bottom: 1px solid var(--g-border-subtle);
    vertical-align: top;
  }
  .row-key {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  @media (max-width: 1023px) {
    .rail {
      margin-bottom: 36px;
    }
  }
  @media (max-width: 640px) {
    .paths {
      grid-template-columns: 1fr;
    }
  }
</style>
