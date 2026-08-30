<script lang="ts">
  // The product explained through its actual surfaces (design brief
  // sections 13-14): fleet table, one alert with evidence and remediation
  // (Furnace as a contextual diagnostic layer inside it, never a chatbot),
  // notification routing, and the API/MCP shape. Monitoring and alerts
  // carry the visual weight; AI and MCP are secondary.
  const fleet = [
    { host: "gpu-ams-a16-01", state: "warning", cpu: "34%", mem: "61%", storage: "8 disks", temp: "58 C", alerts: "1", seen: "42s" },
    { host: "storage-fra-2", state: "healthy", cpu: "6%", mem: "22%", storage: "12 disks", temp: "41 C", alerts: "0", seen: "18s" },
    { host: "web-ams-1", state: "healthy", cpu: "12%", mem: "48%", storage: "2 disks", temp: "44 C", alerts: "0", seen: "51s" },
    { host: "db-ams-1", state: "critical", cpu: "28%", mem: "74%", storage: "4 disks", temp: "47 C", alerts: "2", seen: "12s" },
  ];
</script>

<section class="surfaces" id="product">
  <div class="inner">
    <h2>The product is the surface.</h2>

    <!-- Fleet: dense table, not cards -->
    <div class="block">
      <p class="block-label">FLEET</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Host</th><th>State</th><th>CPU</th><th>MEM</th><th>Storage</th><th>Temp</th><th>Alerts</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            {#each fleet as f (f.host)}
              <tr>
                <td class="mono host">{f.host}</td>
                <td class="mono"><span class={"state " + f.state}>{f.state.toUpperCase()}</span></td>
                <td class="mono">{f.cpu}</td>
                <td class="mono">{f.mem}</td>
                <td class="mono">{f.storage}</td>
                <td class="mono">{f.temp}</td>
                <td class="mono">{f.alerts}</td>
                <td class="mono">{f.seen}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Alert: what broke, evidence, action, command, Furnace as a layer -->
    <div class="block">
      <p class="block-label">ALERT</p>
      <div class="alert-surface">
        <div class="alert-head">
          <span class="sev">CRITICAL</span>
          <span class="alert-title">RAID md126 degraded</span>
          <span class="alert-host">db-ams-1</span>
        </div>
        <div class="alert-section">
          <p class="sec-label">EVIDENCE</p>
          <pre><code>md126 : active raid1 sdb1[2](F) sda1[0]
        1953381440 blocks [2/1] [U_]</code></pre>
        </div>
        <div class="alert-section">
          <p class="sec-label">RECOMMENDED ACTION</p>
          <p class="sec-body">Identify the failed member, verify it is the disk and not the cable or backplane, then replace and re-add. One more failure loses the array.</p>
          <pre><code>mdadm --detail /dev/md126</code></pre>
        </div>
        <div class="alert-section furnace">
          <p class="sec-label">FURNACE</p>
          <p class="sec-body">This appears consistent with a single-drive failure: sdb1 is marked (F) while sda1 remains active, and the SMART snapshot for sdb shows 24 reallocated sectors that were first seen 11 days ago. The array is functional but unprotected.</p>
        </div>
      </div>
    </div>

    <div class="pair">
      <!-- Notifications: actual routing shape -->
      <div class="block">
        <p class="block-label">NOTIFICATIONS</p>
        <div class="mini-surface">
          <pre><code>critical  -&gt; pagerduty, slack #ops
warning   -&gt; slack #ops
info      -&gt; email digest, daily
maintenance window: suppressed</code></pre>
          <p class="mini-note">Telegram, Slack, Discord, PagerDuty, email, webhook. Route by severity, server, or team.</p>
        </div>
      </div>

      <!-- API/MCP: tiny real example -->
      <div class="block">
        <p class="block-label">API / MCP</p>
        <div class="mini-surface">
          <pre><code>curl -H "Authorization: Bearer $ACCT_KEY" \
  https://app.glassmkr.com/api/v1/servers</code></pre>
          <p class="mini-note">
            Everything the dashboard does, the API does. MCP clients connect
            with a browser sign-in and scoped, revocable access.
            <a href="/docs/mcp">MCP guide &rarr;</a>
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .surfaces {
    padding: 72px 24px;
    border-top: 1px solid var(--border-subtle);
  }
  .inner { max-width: 1000px; margin: 0 auto; }

  h2 {
    font-size: clamp(24px, 3.2vw, 34px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 28px;
  }

  .block { margin-bottom: 28px; }
  .block-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 8px;
  }

  .table-wrap {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-align: left;
    color: var(--text-tertiary);
    font-weight: 500;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border-default);
    white-space: nowrap;
  }
  td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-subtle);
    white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  td.mono { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary); }
  td.host { color: var(--text-primary); }
  .state { font-size: 12px; letter-spacing: 0.06em; }
  .state.healthy { color: var(--green); }
  .state.warning { color: var(--yellow); }
  .state.critical { color: var(--red); }

  .alert-surface {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }
  .alert-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .sev {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--red);
    border: 1px solid var(--red);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
  }
  .alert-title { font-family: var(--font-mono); font-size: 14px; color: var(--text-primary); }
  .alert-host { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); margin-left: auto; }

  .alert-section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .alert-section:last-child { border-bottom: none; }
  .sec-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 6px;
  }
  .sec-body {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 8px;
    max-width: 720px;
  }
  .alert-section pre {
    margin: 0;
    padding: 10px 14px;
    background: var(--bg);
    /* Already inside a bordered alert surface: a tint separates the command from the prose without drawing a box inside a box */
    border: none;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .alert-section code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .furnace { background: rgba(255, 107, 53, 0.03); }
  .furnace .sec-label { color: var(--accent); }
  .furnace .sec-body { margin-bottom: 0; }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  /* A grid item defaults to min-width:auto and refuses to be narrower than its
     own min-content width, so on a phone the block ran 15px past the section.
     Same cause as every other overflow in this pass. */
  .pair > * { min-width: 0; }
  .mini-surface {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
    height: 100%;
  }
  .mini-surface pre {
    margin: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    overflow-x: auto;
    background: var(--bg);
  }
  .mini-surface code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .mini-note {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    padding: 12px 16px;
    margin: 0;
  }

  @media (max-width: 860px) {
    .pair { grid-template-columns: 1fr; }
  }

  /* Mobile technical-text floor (taste pass 4.1): these are product-surface
     and table labels, which must stay legible on a phone. Widened data
     scrolls inside its container rather than shrinking. */
  @media (max-width: 768px) {
    table, thead th, tbody td { font-size: 12px; }
    .mono, .state, .sev { font-size: 12px; }
    .block-label { font-size: 12px; }
    .sec-label { font-size: 12px; }
    .col-label { font-size: 12px; }
    .col-title { font-size: 12px; }
  }
</style>
