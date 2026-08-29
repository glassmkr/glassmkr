<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import VulnRow from "./VulnRow.svelte";

  // Vuln list distilled from obs-security.png. All 19 mitigated.
  const vulns = [
    { name: "gather_data_sampling",  status: "Not affected" },
    { name: "ghostwrite",            status: "Not affected" },
    { name: "indirect_target_selection", status: "Not affected" },
    { name: "itlb_multihit",         status: "Not affected" },
    { name: "l1tf",                  status: "Not affected" },
    { name: "mds",                   status: "Not affected" },
    { name: "meltdown",              status: "Not affected" },
    { name: "mmio_stale_data",       status: "Not affected" },
    { name: "old_microcode",         status: "Not affected" },
    { name: "reg_file_data_sampling",status: "Not affected" },
    { name: "retbleed",              status: "Mitigation: Enhanced IBRS" },
    { name: "spec_rstack_overflow",  status: "Not affected" },
    { name: "spec_store_bypass",     status: "Mitigation: Speculative Store Bypass disabled via prctl" },
    { name: "spectre_v1",            status: "Mitigation: usercopy/swapgs barriers and __user pointer sanitization" },
    { name: "spectre_v2",            status: "Mitigation: Enhanced / Automatic IBRS; IBPB: conditional" },
    { name: "tsa",                   status: "Mitigation: Clear CPU buffers" },
    { name: "vmscape",               status: "Mitigation: IBPB before exit to userspace" },
  ];
</script>

<DashboardFrame>
  <div class="body">
    <h2>Security Posture</h2>

    <div class="row">
      <span class="label">FIREWALL</span>
      <span class="pill green">ACTIVE</span>
    </div>

    <div class="row">
      <span class="label">KERNEL VULNERABILITIES</span>
      <span class="pill green">19 MITIGATED</span>
      <span class="show">&#9662; Show all 19</span>
    </div>

    <div class="vulns">
      {#each vulns as v (v.name)}
        <VulnRow name={v.name} status={v.status} />
      {/each}
    </div>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px 22px 22px;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .label {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-tertiary, #707070);
    text-transform: uppercase;
  }
  .pill {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    border-radius: var(--radius-md);
  }
  .pill.green {
    background: rgba(52, 211, 153, 0.1);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.25);
  }
  .show {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
  .vulns {
    background: var(--bg-surface, #141414);
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
    border-radius: var(--radius-md);
    overflow: hidden;
    flex: 1;
    overflow-y: hidden;
    position: relative;
  }
  .vulns::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 36px;
    background: linear-gradient(transparent, #0a0a0a);
    pointer-events: none;
  }
</style>
