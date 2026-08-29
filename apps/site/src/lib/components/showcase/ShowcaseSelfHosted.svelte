<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  // Self-hosted vertical showcase: storage mounts, SMART health, and IPMI
  // sensor tiles, the bare-metal signals a homelab/self-host operator cares
  // about. Hand-built from theme tokens.
</script>

<DashboardFrame url="app.glassmkr.com/server/db-hel1-01" maxHeight={540}>
  <div class="body">
    <div class="sec"><span class="title">Storage</span><span class="badge">2 mounts</span></div>
    <div class="mounts">
      <div class="card mount"><div class="mt"><span class="mono">/</span><span class="md">40.0 / 100 GB &middot; 40.0%</span></div><div class="bar"><i style="width:40%;background:var(--green)"></i></div></div>
      <div class="card mount"><div class="mt"><span class="mono">/var/lib/pgsql</span><span class="md">6.8 / 8.0 TB &middot; 85.0%</span></div><div class="bar"><i style="width:85%;background:var(--yellow)"></i></div></div>
    </div>

    <div class="sec"><span class="title">SMART health</span><span class="badge">2 drives</span></div>
    <div class="smart">
      <div class="card sc"><div class="st"><span class="mono">/dev/sda</span><span class="tag green">PASSED</span></div><div class="sm">Seagate Exos X18 16TB</div><div class="smeta"><span>38&deg;C</span><span>1100d on</span><span>0 reallocated</span></div></div>
      <div class="card sc"><div class="st"><span class="mono">/dev/sdd</span><span class="tag red">FAILED</span></div><div class="sm">Seagate Exos X18 16TB</div><div class="smeta"><span>45&deg;C</span><span class="tag red">1184 reallocated</span></div></div>
    </div>

    <div class="sec"><span class="title">IPMI</span><span class="sub">temperatures &middot; fans &middot; power</span></div>
    <div class="tiles">
      <div class="tile"><div class="k">CPU1</div><div class="v green-t">58&deg;C</div></div>
      <div class="tile"><div class="k">CPU2</div><div class="v green-t">61&deg;C</div></div>
      <div class="tile"><div class="k">System</div><div class="v green-t">33&deg;C</div></div>
      <div class="tile"><div class="k">FAN1</div><div class="v">7200<span class="u"> rpm</span></div></div>
      <div class="tile"><div class="k">PSU1</div><div class="v">410<span class="u"> W</span></div></div>
      <div class="tile"><div class="k">PSU2</div><div class="v">398<span class="u"> W</span></div></div>
    </div>
  </div>
</DashboardFrame>

<style>
  .body { padding: 16px 18px 24px; }
  .sec { display: flex; align-items: baseline; gap: 8px; margin: 16px 0 10px; }
  .sec:first-child { margin-top: 0; }
  .title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .badge { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: var(--radius-md); color: var(--text-secondary); border: 1px solid var(--surface-border); text-transform: uppercase; }
  .sub { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
  .mono { font-family: var(--font-mono, monospace); }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); }

  .mounts { display: flex; flex-direction: column; gap: 10px; }
  .mount { padding: 12px 16px; }
  .mt { display: flex; justify-content: space-between; align-items: baseline; }
  .mt .mono { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .md { font-size: 12px; color: var(--text-tertiary); }
  .bar { height: 7px; border-radius: var(--radius-md); background: var(--bg-elevated); margin-top: 9px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: var(--radius-md); }

  .smart { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .sc { padding: 12px 14px; }
  .st { display: flex; justify-content: space-between; align-items: center; }
  .st .mono { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .sm { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
  .smeta { display: flex; gap: 12px; align-items: center; margin-top: 9px; font-size: 12px; color: var(--text-tertiary); }
  .tag { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-md); }
  .tag.green { background: var(--green-bg); color: var(--green); }
  .tag.red { background: var(--red-bg); color: var(--red); }

  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
  .tile { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 9px 11px; }
  .k { font-size: 12px; color: var(--text-tertiary); }
  .v { font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-primary); }
  .v .u { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
  .green-t { color: var(--green); }

  @media (max-width: 640px) { .smart { grid-template-columns: 1fr; } .tiles { grid-template-columns: repeat(3, 1fr); } }
</style>
