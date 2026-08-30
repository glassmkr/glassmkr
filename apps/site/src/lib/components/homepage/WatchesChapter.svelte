<script lang="ts">
  // Chapter 2 (spec 10.4): what it watches. One dense matrix grouped by
  // consequence, plain problem labels first, protocol sources second
  // (content redesign 5.6, exact copy). The rule count is generated.
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;

  const groups: { label: string; plain: string; sources: string }[] = [
    {
      label: "Drives and storage",
      plain:
        "failing drives, NVMe wear, degraded RAID, unhealthy ZFS pools, filesystems filling up.",
      sources: "smartctl · nvme · mdadm · zpool · statvfs",
    },
    {
      label: "Memory and CPU",
      plain:
        "memory pressure, ECC errors, machine-check events, thermal problems, abnormal load.",
      sources: "meminfo · EDAC · mcelog · hwmon · loadavg",
    },
    {
      label: "Power and cooling",
      plain:
        "failed fans, lost PSU redundancy, critical BMC events, unsafe temperatures.",
      sources: "IPMI sensors · IPMI SEL",
    },
    {
      label: "Network",
      plain:
        "link errors, bond degradation, speed drops, saturation, and packet problems.",
      sources: "ethtool · /proc/net · bonding · conntrack",
    },
    {
      label: "Operating system",
      plain:
        "unexpected reboots, failed services, missing security updates, firewall and kernel state.",
      sources: "systemd · apt/dnf · uptime · kernel logs",
    },
    {
      label: "GPU hosts",
      plain:
        "XID events, ECC, thermal throttling, power state, and link health where supported.",
      sources: "nvidia-smi · NVML",
    },
  ];
</script>

<section class="chapter band-std" id="watches">
  <div class="site-grid">
    <h2 class="col-1-8">The checks most server owners discover only after something breaks.</h2>
    <div class="col-1-12 matrix" role="list">
      {#each groups as g (g.label)}
        <div class="row" role="listitem">
          <p class="row-label">{g.label}</p>
          <p class="row-plain">{g.plain}</p>
          <p class="row-sources">{g.sources}</p>
        </div>
      {/each}
    </div>
    <p class="col-1-12 browse">
      <a href="/docs/rules">Browse all {ruleCount} alert rules, each with its evidence fields and remediation &rarr;</a>
    </p>
  </div>
</section>

<style>
  h2 {
    font-size: var(--type-h2);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 32px;
    text-wrap: balance;
  }
  .matrix {
    border-top: 1px solid var(--g-border-strong);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(160px, 3fr) 6fr minmax(180px, 3fr);
    gap: 12px 24px;
    padding: 16px 0;
    border-bottom: 1px solid var(--g-border-subtle);
    align-items: baseline;
  }
  .row-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0;
  }
  .row-plain {
    font-size: 14px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
  }
  .row-sources {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0;
    text-align: right;
    white-space: nowrap;
  }
  .browse {
    margin: 20px 0 0;
  }
  .browse a {
    font-size: 14px;
    color: var(--g-brand);
    text-decoration: underline;
    text-underline-offset: 3px;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  .browse a:hover {
    color: var(--g-brand-soft);
  }

  @media (max-width: 860px) {
    .row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .row-sources {
      text-align: left;
      white-space: normal;
    }
  }
</style>
