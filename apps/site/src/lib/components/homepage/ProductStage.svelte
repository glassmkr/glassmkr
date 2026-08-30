<script lang="ts">
  // The homepage product stage (redesign spec 10.3): the complete value chain
  // in one composition, spanning the wide grid. Fleet state, the alert, its
  // evidence, the consequence, and the next safe step.
  //
  // Every value renders from the demo-fleet-raid exhibit: a verbatim capture
  // of the read-only sample fleet the public demo serves, hash-verified by
  // scripts/check-exhibits.mjs. Nothing here is invented; this component
  // replaced a hand-written fleet table whose hostnames and telemetry were
  // fabricated, which the spec's truth test forbids.
  import exhibit from "$lib/data/exhibits/demo-fleet-raid.json";

  const fleet = exhibit.fleet;
  const alert = exhibit.alert;

  // The plain-language consequence leads (content redesign 5.5); the captured
  // technical message is the evidence beneath it, not a replacement for it.
  const consequence =
    "One disk has dropped out of the RAID array. The server is still online, but it has lost redundancy. Replace or safely re-add /dev/sdd before another disk fails.";

  const provenance = {
    capturedAt: "2026-08-30 10:31 UTC",
    host: alert.host,
    source: "public demo, read-only sample-fleet capture",
    collector: exhibit.host_snapshot.collector_version,
  };

  const osLabel = (h: (typeof fleet)[number]) => `${h.os_type} ${h.os_version}`;
</script>

<figure class="stage" aria-label="Glassmkr product: fleet view with an active RAID alert">
  <div class="stage-head">
    <span class="stage-mark">GLASSMKR</span>
    <div class="stage-tabs" aria-hidden="true">
      <span class="stage-tab active">Servers</span>
      <span class="stage-tab">Trend warnings</span>
      <span class="stage-tab">Channels</span>
    </div>
    <span class="stage-state">SAMPLE FLEET · READ-ONLY CAPTURE</span>
  </div>

  <div class="stage-body">
    <div class="stage-fleet" role="table" aria-label="Sample fleet: four servers with alert counts">
      <div class="fleet-head" role="row">
        <span role="columnheader">HOST</span>
        <span role="columnheader" class="num">ALERTS</span>
      </div>
      {#each fleet as h (h.hostname)}
        <div class="fleet-row" class:selected={h.hostname === alert.host} role="row">
          <span class="fleet-host" role="cell">
            {h.hostname}
            <span class="fleet-meta">{osLabel(h)} · {h.dmi_vendor} {h.dmi_product}</span>
          </span>
          <span
            class="fleet-alerts num"
            class:hot={h.active_alerts > 0}
            role="cell">{h.active_alerts}</span
          >
        </div>
      {/each}
    </div>

    <div class="stage-alert">
      <div class="alert-head">
        <span class="sev">{alert.rendered_priority}</span>
        <span class="alert-title">{alert.title}</span>
        <span class="alert-host">{alert.host}</span>
      </div>

      <p class="alert-consequence">{consequence}</p>

      <div class="alert-section">
        <p class="sec-label">EVIDENCE</p>
        <p class="evidence-line">{alert.message}</p>
      </div>

      <div class="alert-section">
        <p class="sec-label">NEXT SAFE STEP</p>
        <p class="next-step">{alert.recommendation}</p>
      </div>
    </div>
  </div>

  <figcaption class="provenance">
    captured {provenance.capturedAt} · host {provenance.host} · {provenance.source} · agent
    {provenance.collector}
  </figcaption>
</figure>

<style>
  .stage {
    margin: 0;
    border: 1px solid var(--g-border-strong);
    border-radius: var(--g-radius-3);
    background: var(--g-surface-1);
    overflow: hidden;
    /* The one restrained ambient shadow the spec allows, behind the stage. */
    box-shadow: 0 24px 80px -32px rgba(0, 0, 0, 0.7);
  }

  .stage-head {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 0 20px;
    height: 46px;
    border-bottom: 1px solid var(--g-border-subtle);
    background: var(--g-surface-2);
  }
  .stage-mark {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--text-primary);
  }
  .stage-tabs {
    display: flex;
    gap: 18px;
    flex: 1;
    min-width: 0;
  }
  .stage-tab {
    font-size: 13px;
    color: var(--text-tertiary);
    white-space: nowrap;
    line-height: 44px;
  }
  .stage-tab.active {
    color: var(--text-primary);
    box-shadow: inset 0 -2px 0 var(--g-brand);
  }
  .stage-state {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .stage-body {
    display: grid;
    grid-template-columns: minmax(280px, 5fr) 7fr;
  }

  /* Fleet rail */
  .stage-fleet {
    border-right: 1px solid var(--g-border-subtle);
  }
  .fleet-head {
    display: flex;
    justify-content: space-between;
    padding: 10px 20px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .fleet-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .fleet-row.selected {
    background: var(--g-brand-faint);
    box-shadow: inset 2px 0 0 var(--g-brand);
  }
  .fleet-host {
    font-family: var(--font-mono);
    font-size: 13.5px;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fleet-meta {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fleet-alerts {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-tertiary);
  }
  .fleet-alerts.hot {
    color: var(--g-critical);
  }

  /* Alert panel */
  .stage-alert {
    padding: 18px 24px 20px;
    min-width: 0;
  }
  .alert-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-bottom: 12px;
  }
  .sev {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--g-critical);
    border: 1px solid var(--g-critical);
    border-radius: var(--g-radius-1);
    padding: 2px 7px;
    white-space: nowrap;
  }
  .alert-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .alert-host {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .alert-consequence {
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--text-primary);
    margin: 0 0 16px;
    max-width: 62ch;
  }
  .alert-section {
    border-top: 1px solid var(--g-border-subtle);
    padding-top: 12px;
    margin-top: 0;
  }
  .alert-section + .alert-section {
    margin-top: 14px;
  }
  .sec-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 6px;
  }
  .evidence-line {
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .next-step {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
    max-width: 68ch;
  }

  .provenance {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    border-top: 1px solid var(--g-border-subtle);
    padding: 8px 20px;
    margin: 0;
  }

  @media (max-width: 860px) {
    .stage-body {
      grid-template-columns: 1fr;
    }
    .stage-fleet {
      border-right: none;
      border-bottom: 1px solid var(--g-border-subtle);
    }
    .stage-tabs {
      display: none;
    }
    .stage-head {
      justify-content: space-between;
    }
  }
</style>
