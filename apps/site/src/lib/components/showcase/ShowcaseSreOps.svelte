<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  // SRE-vertical showcase: a firing alert + network saturation/errors,
  // the signals an on-call engineer reads first.
</script>

<DashboardFrame url="app.glassmkr.com/server/edge-sjc-02" maxHeight={540}>
  <div class="body">
    <div class="sec"><span class="title">Alerts</span><span class="count">(1)</span></div>
    <div class="alert">
      <div class="ah"><span class="sev">warning</span><span class="at">NIC errors on eno2</span><span class="age">1h 4m</span></div>
      <p class="am">eno2 has accumulated 160 hardware errors (CRC + frame) and 90 discards. Error ratio exceeds 0.1% of packets. Check cabling / SFP.</p>
      <code class="rule">interface_errors</code>
    </div>

    <div class="sec"><span class="title">Network</span><span class="sub">saturation &middot; errors &middot; discards</span></div>
    <div class="grid">
      <div class="card">
        <div class="nh"><span class="mono">eno1</span><span class="speed">1 GbE</span><span class="dot green"></span></div>
        <div class="ns"><span>Saturation</span><span class="nv green-t">19.2%</span></div>
        <div class="sb"><i style="width:19%;background:var(--green)"></i></div>
        <div class="nstats"><div class="ns2"><span class="k">Errors</span><span class="tag green">0</span></div><div class="ns2"><span class="k">Discards</span><span class="tag green">0</span></div></div>
      </div>
      <div class="card">
        <div class="nh"><span class="mono">eno2</span><span class="speed">1 GbE</span><span class="dot red"></span></div>
        <div class="ns"><span>Saturation</span><span class="nv">4.8%</span></div>
        <div class="sb"><i style="width:5%;background:var(--green)"></i></div>
        <div class="nstats"><div class="ns2"><span class="k">Errors</span><span class="tag red">160</span></div><div class="ns2"><span class="k">Discards</span><span class="tag red">90</span></div></div>
      </div>
    </div>

    <div class="sec"><span class="title">History</span><span class="pills"><i class="rp">1h</i><i class="rp">6h</i><i class="rp on">24h</i><i class="rp">7d</i><i class="rp">30d</i></span></div>
    <div class="card chart">
      <div class="ch"><span class="ct">Memory used</span><span class="cr">3.7 / 16.0 GB</span></div>
      <svg width="100%" height="84" viewBox="0 0 560 90" preserveAspectRatio="none">
        <defs><linearGradient id="sreg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#10B981" stop-opacity="0.3"/><stop offset="1" stop-color="#10B981" stop-opacity="0"/></linearGradient></defs>
        <path d="M0,70 L80,66 L160,72 L240,60 L320,68 L400,58 L480,64 L560,62 L560,90 L0,90 Z" fill="url(#sreg)"/>
        <polyline fill="none" stroke="#10B981" stroke-width="1.6" points="0,70 80,66 160,72 240,60 320,68 400,58 480,64 560,62"/>
      </svg>
    </div>
  </div>
</DashboardFrame>

<style>
  .body { padding: 16px 18px 24px; }
  .sec { display: flex; align-items: baseline; gap: 8px; margin: 16px 0 10px; }
  .sec:first-child { margin-top: 0; }
  .title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .count { font-size: 12px; color: var(--text-tertiary); }
  .sub { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
  .mono { font-family: var(--font-mono, monospace); }

  .alert { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid var(--yellow); border-radius: var(--radius-md); padding: 12px 14px; }
  .ah { display: flex; align-items: center; gap: 10px; }
  .sev { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: var(--radius-md); background: var(--yellow-bg); color: var(--yellow); }
  .at { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .age { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
  .am { font-size: 12px; color: var(--text-secondary); margin: 8px 0 6px; line-height: 1.45; }
  .rule { font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono, monospace); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 12px 14px; }
  .nh { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .speed { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-md); color: var(--text-secondary); border: 1px solid var(--surface-border); }
  .dot { width: 7px; height: 7px; border-radius: 50%; margin-left: auto; }
  .dot.green { background: var(--green); } .dot.red { background: var(--red); }
  .ns { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
  .nv { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .green-t { color: var(--green); }
  .sb { height: 6px; border-radius: var(--radius-sm); background: var(--bg-elevated); margin: 7px 0; overflow: hidden; }
  .sb i { display: block; height: 100%; border-radius: var(--radius-sm); }
  .nstats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
  .ns2 { background: var(--bg-elevated); border-radius: var(--radius-md); padding: 6px 9px; display: flex; justify-content: space-between; align-items: center; }
  .k { font-size: 12px; color: var(--text-tertiary); }
  .tag { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-md); }
  .tag.green { background: var(--green-bg); color: var(--green); }
  .tag.red { background: var(--red-bg); color: var(--red); }

  .pills { margin-left: auto; display: flex; gap: 4px; }
  .rp { font-size: 12px; font-style: normal; padding: 2px 8px; border-radius: var(--radius-md); border: 1px solid var(--surface-border); color: var(--text-secondary); }
  .rp.on { background: var(--accent-glow); border-color: rgba(255, 107, 53,0.4); color: var(--accent); font-weight: 600; }
  .chart .ch { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .ct { font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .cr { font-size: 12px; color: var(--text-secondary); }

  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
