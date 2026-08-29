<script lang="ts">
  // The monitoring system exposed directly (design brief section 11):
  // real rule ids, titles, and priorities from the generated catalog, not
  // a description of them. The seven shown span the hardware surface; the
  // full catalog page carries the rest.
  import rules from "$lib/data/rules.json";

  const SHOWN: [string, string][] = [
    ["smart_failing", "SMART"],
    ["nvme_wear_high", "NVMe"],
    ["ecc_errors", "EDAC"],
    ["raid_degraded", "mdadm"],
    ["zfs_pool_unhealthy", "ZFS"],
    ["interface_errors", "ethtool"],
    ["ipmi_sel_critical", "IPMI"],
  ];
  const rows = SHOWN.flatMap(([id, source]) => {
    const r = rules.find((x) => x.id === id);
    return r ? [{ id: r.id, title: r.title, priority: r.priority, source }] : [];
  });
</script>

<section class="rules" id="rules">
  <div class="inner">
    <h2>{rules.length} opinionated hardware rules.</h2>
    <p class="lede">
      Tuned on real bare-metal failures: not generic "host is unreachable" pings.
      Every rule ships with evidence fields and a remediation command.
    </p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Rule</th><th>Source</th><th>Priority</th><th class="col-title">Fires when</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <td class="mono"><a href={"/docs/rules/" + row.id}>{row.id}</a></td>
              <td class="mono">{row.source}</td>
              <td class="mono">{row.priority}</td>
              <td class="col-title">{row.title}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <a class="browse" href="/docs/rules">Browse all {rules.length} alert rules &rarr;</a>
  </div>
</section>

<style>
  .rules {
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
    max-width: 560px;
  }

  .table-wrap {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-align: left;
    color: var(--text-tertiary);
    font-weight: 500;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-default);
  }
  td {
    padding: 9px 16px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  td.mono { font-family: var(--font-mono); font-size: 12.5px; }
  /* The rule id is the link into each rule page and was 14px tall, the
     smallest target on the homepage. The cell padding already exceeds 24px, so
     filling the cell costs no layout. */
  td.mono a {
    color: var(--text-primary); text-decoration: none;
    display: inline-flex; align-items: center; min-height: 24px;
  }
  td.mono a:hover { color: var(--accent); }
  .col-title { white-space: normal; min-width: 220px; }

  .browse {
    display: inline-block;
    margin-top: 20px;
    font-size: 14px;
    color: var(--accent);
    text-decoration: none;
  }
  .browse:hover { text-decoration: underline; }

  /* Mobile technical-text floor (taste pass 4.1). The provenance line is
     deliberately excluded: 4.2 keeps it exactly as established. */
  @media (max-width: 768px) {
    .col-title { font-size: 12px; }
    th { font-size: 12px; }
    td { font-size: 12px; }
  }
</style>
