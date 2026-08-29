<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import { FALLBACK_CRUCIBLE_VERSION } from "$lib/crucible-version";

  // Server-detail showcase, redesigned (2026-05-31) to match the live
  // dashboard: CPU aggregate donut + per-core grid, Memory + Load cards,
  // a Network saturation/errors row and IPMI sensor tiles. Hand-built
  // from the real theme tokens; illustrative values (RFC 5737 IP block).
  //
  // crucibleVersion is fed from the homepage +page.server.ts loader
  // (npm dist-tags.latest); default is the shipped FALLBACK_LATEST.
  let { crucibleVersion = FALLBACK_CRUCIBLE_VERSION }: { crucibleVersion?: string } = $props();

  const coreVals = [12, 31, 18, 24, 9, 41, 22, 15, 28, 11, 35, 19, 26, 14, 38, 17];
  // Per-core heatmap color bands, matching the dashboard CpuHeroCard: a calm
  // dim-green field that lights amber then red as a core saturates.
  const cellColor = (b: number) =>
    b >= 85 ? "#f87171" : b >= 65 ? "#fbbf24" : b >= 40 ? "#4ade80" : b >= 15 ? "rgba(74,222,128,0.55)" : "rgba(74,222,128,0.20)";
  const LEGEND = [10, 30, 55, 75, 95];
</script>

<DashboardFrame maxHeight={700}>
  <div class="body">
    <!-- header band -->
    <div class="band">
      <div class="band-card identity">
        <span class="pill blue">GPU server</span>
        <span class="hostname">gpu-ams-a16-01</span>
        <div class="status-pills">
          <span class="pill green">Active</span>
          <span class="pill green">Polling 5m</span>
        </div>
      </div>
      <div class="band-card">
        <div class="k">UPTIME</div><div class="v">12d 4h</div><div class="sub">snapshot 38s ago</div>
      </div>
      <div class="band-card">
        <div class="k">OS &amp; HARDWARE</div><div class="v">Debian 13</div><div class="sub">Supermicro AS-2015A</div>
      </div>
      <div class="band-card">
        <div class="k">CRUCIBLE</div><div class="v">v{crucibleVersion}</div><div class="sub">IPMI: 14 sensors</div>
      </div>
    </div>

    <!-- Firing alert: leads with the product's reason for existing, and
         ties to the eno2 errors shown in the Network section below. -->
    <div class="sec-head"><span class="title">Alerts</span><span class="badge warn">1 active</span><span class="summary">a hardware fault caught on this host</span></div>
    <div class="card alert">
      <div class="alert-head">
        <span class="sev">warning</span>
        <span class="alert-title">NIC errors on eno2</span>
        <span class="alert-age">1h 4m</span>
      </div>
      <p class="alert-msg">eno2 has logged 160 hardware errors (CRC + frame) and 90 discards: the error ratio crossed 0.1% of packets, usually a failing cable or SFP.</p>
      <div class="fix"><span class="fix-k">Suggested fix</span><code>ethtool -S eno2 | grep -iE 'err|crc'</code></div>
      <code class="rule">interface_errors</code>
    </div>

    <!-- CPU -->
    <div class="sec-head"><span class="title">CPU</span><span class="badge">16 cores</span><span class="summary">16 threads &middot; avg <b>23%</b> &middot; peak <b>41%</b></span></div>
    <div class="card cpu">
      <div class="donut">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle cx="46" cy="46" r="38" fill="none" stroke="var(--bg-elevated)" stroke-width="9" />
          <circle cx="46" cy="46" r="38" fill="none" stroke="var(--green)" stroke-width="9" stroke-linecap="round"
                  stroke-dasharray="238.76" stroke-dashoffset="189" transform="rotate(-90 46 46)" />
        </svg>
        <div class="donut-label">21%</div>
      </div>
      <div class="agg">
        <div class="agg-title">Aggregate load</div>
        <div class="agg-stats">
          <div><div class="ak">Current</div><div class="av">21%</div></div>
          <div><div class="ak">Avg core</div><div class="av">23%</div></div>
          <div><div class="ak">Peak core</div><div class="av">41%<span class="vsub"> C5</span></div></div>
          <div><div class="ak">Threads</div><div class="av">16</div></div>
        </div>
        <div class="breakdown">
          <span><i style="background:var(--blue)"></i>User 17%</span>
          <span><i style="background:var(--accent)"></i>System 3%</span>
          <span><i style="background:var(--red)"></i>IOWait 1%</span>
        </div>
      </div>
    </div>
    <div class="cores">
      <div class="cores-head">
        <span class="cores-label">Per-core load</span>
        <span class="legend">idle{#each LEGEND as l}<i class="sw" style="background:{cellColor(l)}"></i>{/each}busy</span>
      </div>
      <div class="heatmap">
        {#each coreVals as p, i}
          <div class="cell" style="background:{cellColor(p)}" title="Core {i}: {p}%"></div>
        {/each}
      </div>
    </div>

    <!-- Memory + Load -->
    <div class="two">
      <div class="card pad">
        <div class="sec-head tight"><span class="title sm">Memory</span></div>
        <div class="big">20.4<span class="bu">GB</span></div>
        <div class="bsub">32% of 62.7 GB &middot; swap 0 / 8 GB</div>
        <div class="seg"><i style="width:32%;background:var(--green)"></i><i style="width:37%;background:rgba(96,165,250,0.6)"></i></div>
        <div class="memleg">
          <span><i style="background:var(--green)"></i>used 20.4 GB</span>
          <span><i style="background:rgba(96,165,250,0.6)"></i>cache 23.3 GB</span>
          <span><i class="free"></i>free 19.0 GB</span>
        </div>
      </div>
      <div class="card pad">
        <div class="sec-head tight"><span class="title sm">Load average</span><span class="summary">16 cores</span></div>
        <div class="big">0.18</div>
        <div class="bsub">1% of capacity</div>
        <div class="loadrow"><div><div class="msk">1m</div><div class="lv">0.18</div></div><div><div class="msk">5m</div><div class="lv">0.22</div></div><div><div class="msk">15m</div><div class="lv">0.20</div></div></div>
      </div>
    </div>

    <!-- Network -->
    <div class="sec-head"><span class="title sm">Network</span><span class="summary">saturation &middot; errors &middot; discards</span></div>
    <div class="two">
      <div class="card pad net">
        <div class="net-head"><span class="mono">eno1</span><span class="speed">10 GbE</span><span class="dot green"></span></div>
        <div class="net-sat"><span>Saturation</span><span class="satv green-t">0.84%</span></div>
        <div class="satbar"><div style="width:3%;background:var(--green)"></div></div>
        <div class="netstats"><div class="nst"><div class="msk">Errors</div><span class="tag green">0</span></div><div class="nst"><div class="msk">Discards</div><span class="tag green">0</span></div></div>
      </div>
      <div class="card pad net">
        <div class="net-head"><span class="mono">eno2</span><span class="speed">1 GbE</span><span class="dot red"></span></div>
        <div class="net-sat"><span>Saturation</span><span class="satv">19.2%</span></div>
        <div class="satbar"><div style="width:19%;background:var(--green)"></div></div>
        <div class="netstats"><div class="nst"><div class="msk">Errors</div><span class="tag red">160</span></div><div class="nst"><div class="msk">Discards</div><span class="tag red">90</span></div></div>
      </div>
    </div>

    <!-- IPMI tiles -->
    <div class="sec-head"><span class="title sm">IPMI</span><span class="summary">temperatures &middot; fans</span></div>
    <div class="tiles">
      <div class="tile"><div class="msk">CPU1</div><div class="tv green-t">38&deg;C</div></div>
      <div class="tile"><div class="msk">CPU2</div><div class="tv green-t">41&deg;C</div></div>
      <div class="tile"><div class="msk">VRM</div><div class="tv green-t">44&deg;C</div></div>
      <div class="tile"><div class="msk">FAN1</div><div class="tv">5800<span class="u"> rpm</span></div></div>
      <div class="tile"><div class="msk">FAN2</div><div class="tv">5700<span class="u"> rpm</span></div></div>
      <div class="tile"><div class="msk">PSU1</div><div class="tv">168<span class="u"> W</span></div></div>
    </div>
  </div>
</DashboardFrame>

<style>
  .body { padding: 16px 20px 24px; font-size: 13px; }
  .mono { font-family: var(--font-mono, monospace); }

  .band { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 18px; }
  .band-card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 12px 14px; }
  .identity { display: flex; flex-direction: column; gap: 6px; }
  .pill { align-self: flex-start; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-md); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; line-height: 1.4; }
  .pill.blue { background: var(--blue-bg); color: var(--blue); }
  .pill.green { background: var(--green-bg); color: var(--green); }
  .hostname { font-size: 17px; font-weight: 700; font-family: var(--font-mono, monospace); color: var(--text-primary); }
  .status-pills { display: flex; gap: 5px; }
  .k { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; color: var(--text-tertiary); }
  .v { font-size: 13px; font-weight: 600; margin-top: 5px; color: var(--text-primary); }
  .sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

  .sec-head { display: flex; align-items: baseline; gap: 8px; margin: 16px 0 10px; }
  .sec-head.tight { margin: 0 0 8px; }
  .title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .title.sm { font-size: 13px; }
  .badge { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: var(--radius-md); color: var(--text-secondary); border: 1px solid var(--surface-border); text-transform: uppercase; }
  .badge.warn { background: var(--yellow-bg); color: var(--yellow); border-color: transparent; }
  .summary { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
  .summary b { color: var(--text-primary); }

  .alert { border-left: 3px solid var(--yellow); padding: 13px 15px; margin-bottom: 14px; }
  .alert-head { display: flex; align-items: center; gap: 10px; }
  .alert .sev { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: var(--radius-md); background: var(--yellow-bg); color: var(--yellow); }
  .alert-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .alert-age { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
  .alert-msg { font-size: 12px; color: var(--text-secondary); margin: 8px 0 10px; line-height: 1.45; }
  .fix { background: var(--bg-elevated); border-radius: var(--radius-md); padding: 8px 11px; margin-bottom: 9px; }
  .fix-k { display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; }
  .fix code { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--accent); }
  .alert .rule { font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono, monospace); }

  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); }
  .pad { padding: 14px 16px; }
  .cpu { display: flex; align-items: center; gap: 22px; padding: 16px 18px; margin-bottom: 10px; }
  .donut { position: relative; width: 92px; height: 92px; flex-shrink: 0; }
  .donut-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: var(--text-primary); }
  .agg-title { font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 10px; }
  .agg-stats { display: flex; gap: 18px 26px; flex-wrap: wrap; }
  .ak { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); }
  .av { font-size: 18px; font-weight: 700; margin-top: 2px; color: var(--text-primary); }
  .vsub { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .breakdown { display: flex; gap: 14px; margin-top: 13px; font-size: 12px; color: var(--text-secondary); flex-wrap: wrap; }
  .breakdown span { display: flex; align-items: center; gap: 5px; }
  .breakdown i { width: 8px; height: 8px; border-radius: var(--radius-sm); display: inline-block; }

  .cores-head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
  .cores-label { font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); }
  .legend { margin-left: auto; display: flex; align-items: center; gap: 3px; font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
  .legend .sw { width: 10px; height: 10px; border-radius: var(--radius-sm); display: inline-block; }
  .heatmap { display: grid; grid-template-columns: repeat(auto-fill, 15px); gap: 4px; }
  .cell { width: 15px; height: 15px; border-radius: var(--radius-sm); }

  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
  .big { font-size: 26px; font-weight: 700; line-height: 1; color: var(--text-primary); }
  .bu { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-left: 4px; }
  .bsub { font-size: 12px; color: var(--text-tertiary); margin-top: 5px; }
  .seg { display: flex; height: 10px; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-elevated); margin: 12px 0 10px; }
  .seg i { height: 100%; }
  .msk { font-size: 12px; color: var(--text-tertiary); }
  .memleg { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 11px; font-size: 12px; color: var(--text-secondary); }
  .memleg span { display: inline-flex; align-items: center; gap: 5px; }
  .memleg i { width: 9px; height: 9px; border-radius: var(--radius-sm); display: inline-block; }
  .memleg i.free { background: var(--bg-elevated); border: 1px solid var(--surface-border); }
  .loadrow { display: flex; gap: 22px; margin-top: 14px; }
  .lv { font-size: 16px; font-weight: 700; margin-top: 2px; color: var(--text-primary); }

  .net-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .speed { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-md); color: var(--text-secondary); border: 1px solid var(--surface-border); }
  .dot { width: 7px; height: 7px; border-radius: 50%; margin-left: auto; }
  .dot.green { background: var(--green); } .dot.red { background: var(--red); }
  .net-sat { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
  .satv { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .green-t { color: var(--green); }
  .satbar { height: 7px; border-radius: var(--radius-md); background: var(--bg-elevated); margin: 7px 0; overflow: hidden; }
  .satbar div { height: 100%; border-radius: var(--radius-md); }
  .netstats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
  .nst { background: var(--bg-elevated); border-radius: var(--radius-md); padding: 7px 9px; display: flex; justify-content: space-between; align-items: center; }
  .tag { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-md); }
  .tag.green { background: var(--green-bg); color: var(--green); }
  .tag.red { background: var(--red-bg); color: var(--red); }

  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
  .tile { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 9px 11px; }
  .tv { font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-primary); }
  .tv .u { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }

  @media (max-width: 800px) {
    .band { grid-template-columns: 1fr 1fr; }
    .tiles { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 560px) {
    .two { grid-template-columns: 1fr; }
    /* Stack the donut above the stats so the four aggregate stats get the full
       width and wrap cleanly instead of bleeding past the card edge. */
    .cpu { flex-direction: column; align-items: flex-start; gap: 16px; }
    .agg-stats { gap: 14px 22px; }
  }
</style>
