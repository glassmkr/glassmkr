<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  // GPU-vertical showcase: the per-GPU cards (temp / power / VRAM / ECC /
  // PCIe) plus a per-core CPU glimpse. Hand-built from theme tokens.
  const gpus = [
    { i: 0, t: 36, p: 12.25, ecc: 0 },
    { i: 1, t: 38, p: 12.3, ecc: 0 },
  ];
</script>

<DashboardFrame url="app.glassmkr.com/server/gpu-ams-a16-01" maxHeight={520}>
  <div class="body">
    <div class="ghead">
      <span class="pill">2 devices</span>
      <span class="pill tier">Tier 1</span>
      <span class="pill drv">Driver 550.163.01</span>
    </div>
    <div class="grid">
      {#each gpus as g}
        <div class="card">
          <div class="ch"><span class="idx">GPU {g.i}</span><span class="name">NVIDIA A16</span></div>
          <div class="metrics">
            <div><div class="k">Temp</div><div class="v green">{g.t}&deg;C</div></div>
            <div><div class="k">Power</div><div class="v">{g.p}<span class="u"> / 62.5 W</span></div><div class="bar"><i style="width:20%"></i></div></div>
            <div><div class="k">VRAM</div><div class="v">12 MiB<span class="u"> / 15.0 GB</span></div><div class="bar"><i style="width:1%"></i></div></div>
          </div>
          <div class="ecc"><span class="eccp on">ECC: on</span><span class="es">Corrected <b>0</b></span><span class="es">Uncorrected <b>{g.ecc}</b></span></div>
          <div class="pcie">PCIe Gen 4 x16</div>
        </div>
      {/each}
    </div>
    <div class="xid">XID event log: <span class="clean">no events in 30 days</span></div>
  </div>
</DashboardFrame>

<style>
  .body { padding: 16px 18px 24px; }
  .ghead { display: flex; gap: 8px; margin-bottom: 14px; }
  .pill { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: var(--radius-md); border: 1px solid var(--surface-border); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
  .pill.tier { background: rgba(96,165,250,0.12); color: #60a5fa; border-color: rgba(96,165,250,0.3); }
  .pill.drv { text-transform: none; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid var(--accent); border-radius: var(--radius-md); padding: 14px 16px; }
  .ch { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
  .idx { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); font-weight: 600; }
  .name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .k { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); font-weight: 600; }
  .v { font-size: 14px; color: var(--text-primary); margin-top: 3px; }
  .v.green { font-size: 20px; font-weight: 700; color: var(--green); }
  .v .u { font-size: 12px; color: var(--text-tertiary); }
  .bar { height: 3px; background: var(--bg-elevated); border-radius: var(--radius-sm); margin-top: 5px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); }
  .ecc { display: flex; gap: 12px; align-items: center; margin-top: 12px; font-size: 12px; color: var(--text-secondary); }
  .eccp { font-size: 12px; font-weight: 600; padding: 2px 7px; border-radius: var(--radius-md); text-transform: uppercase; }
  .eccp.on { background: var(--green-bg); color: var(--green); }
  .es b { color: var(--text-primary); }
  .pcie { font-size: 12px; color: var(--text-secondary); margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--surface-border); }
  .xid { font-size: 12px; color: var(--text-tertiary); margin-top: 14px; }
  .clean { color: var(--green); }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
