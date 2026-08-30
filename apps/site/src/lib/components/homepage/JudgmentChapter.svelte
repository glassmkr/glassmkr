<script lang="ts">
  // Chapter 1 (spec 10.4): the judgment Glassmkr supplies. Text rail in
  // columns 1-4, evidence bands in 5-12, then the job-removed comparison
  // (content redesign 5.3 and 5.4, exact copy). The concluded/next bands
  // quote the same hash-verified demo capture the product stage renders.
  import exhibit from "$lib/data/exhibits/demo-fleet-raid.json";

  const alert = exhibit.alert;
  const watched = ["/proc", "/sys", "SMART", "IPMI", "mdadm", "ZFS", "ECC", "network"];

  const jobRows: [string, string][] = [
    ["Decide which hardware and Linux signals matter", "Supported signals are detected automatically"],
    ["Choose thresholds and write alert rules", "The generated rule set ships enabled and opinionated"],
    ["Interpret SMART, IPMI, RAID, kernel, and network output", "Each alert shows the evidence in context"],
    ["Search for a fix while the server is failing", "The alert includes the next check and remediation workflow"],
    ["Build and maintain a monitoring stack", "Use hosted, or self-host when you want full control"],
  ];
</script>

<section class="chapter band-major" id="how-it-works">
  <div class="site-grid">
    <div class="col-1-4 rail">
      <h2>You run the software. Glassmkr watches the server underneath it.</h2>
      <p class="rail-body">
        You might run an application, database, game server, storage box, or AI
        workload. You know how to deploy it and keep it useful, but you do not
        have an infrastructure team deciding which disk, memory, cooling,
        kernel, and network signals deserve an alert. Glassmkr brings that
        judgment with the product.
      </p>
      <ul class="recognition">
        <li>You have one to a few Linux servers and no dedicated SRE team.</li>
        <li>You can use SSH and sudo, but monitoring is not your specialty.</li>
        <li>You want defaults that work before you learn a query language.</li>
        <li>You want an alert to explain the risk and the next step.</li>
      </ul>
      <p class="boundary">
        Glassmkr monitors the server and its hardware. It does not replace
        application tracing, external uptime checks, or Kubernetes monitoring.
      </p>
    </div>

    <div class="col-5-12 evidence">
      <div class="band">
        <p class="band-label">WHAT GLASSMKR WATCHES</p>
        <div class="band-content sources">
          {#each watched as s (s)}
            <span class="source">{s}</span>
          {/each}
        </div>
      </div>
      <div class="band">
        <p class="band-label">WHAT IT CONCLUDED</p>
        <div class="band-content">
          <span class="verdict-sev">{alert.rendered_priority}</span>
          <span class="verdict-title">{alert.title}</span>
          <span class="verdict-host">{alert.host}</span>
        </div>
      </div>
      <div class="band">
        <p class="band-label">WHAT YOU DO NEXT</p>
        <div class="band-content">
          <p class="next">
            Replace /dev/sdd and re-add it to the array, then watch the
            rebuild. The alert carries the full remediation, including the path
            when the hardware is rented and the provider must act.
          </p>
        </div>
      </div>

      <div class="job-table-wrap">
        <h3>You should not have to design a monitoring system first.</h3>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Without Glassmkr versus with Glassmkr">
          <table>
            <thead>
              <tr><th>Without Glassmkr</th><th>With Glassmkr</th></tr>
            </thead>
            <tbody>
              {#each jobRows as [w, g] (w)}
                <tr><td>{w}</td><td>{g}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
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
    margin: 0 0 18px;
    text-wrap: balance;
  }
  .rail-body {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 18px;
  }
  .recognition {
    list-style: none;
    padding: 0;
    margin: 0 0 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .recognition li {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-secondary);
    padding-left: 18px;
    position: relative;
  }
  .recognition li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 8px;
    height: 2px;
    background: var(--g-brand);
  }
  .boundary {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-tertiary);
    margin: 0;
    border-top: 1px solid var(--g-border-subtle);
    padding-top: 14px;
  }

  .evidence {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .band {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 20px;
    align-items: baseline;
    padding: 18px 0;
    border-top: 1px solid var(--g-border);
  }
  .band:first-child {
    border-top: 1px solid var(--g-border-strong);
  }
  .band-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0;
  }
  .band-content {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 14px;
    min-width: 0;
  }
  .sources .source {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
    border: 1px solid var(--g-border);
    border-radius: var(--g-radius-1);
    padding: 3px 8px;
  }
  .verdict-sev {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--g-critical);
    border: 1px solid var(--g-critical);
    border-radius: var(--g-radius-1);
    padding: 2px 7px;
    white-space: nowrap;
  }
  .verdict-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .verdict-host {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .next {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
    max-width: 62ch;
  }

  .job-table-wrap {
    margin-top: 40px;
  }
  h3 {
    font-size: var(--type-h3);
    font-weight: 500;
    letter-spacing: -0.015em;
    margin: 0 0 16px;
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 520px;
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
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-secondary);
    padding: 12px 20px 12px 0;
    border-bottom: 1px solid var(--g-border-subtle);
    vertical-align: top;
  }
  td:last-child {
    color: var(--text-primary);
  }

  @media (max-width: 1023px) {
    .rail {
      margin-bottom: 40px;
    }
  }
  @media (max-width: 640px) {
    .band {
      grid-template-columns: 1fr;
      gap: 8px;
    }
  }
</style>
