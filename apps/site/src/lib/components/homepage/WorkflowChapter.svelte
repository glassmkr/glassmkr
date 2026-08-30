<script lang="ts">
  // Chapter 3 (spec 10.4): the alert is a workflow. Four stages rendered from
  // ONE real example: the hash-verified val-debian capture (a real alert from
  // a real machine, provenance below). Consequence, evidence, check,
  // remediation, in that order (content redesign 5.5: plain meaning first,
  // technical evidence preserved).
  import exhibit from "$lib/data/exhibits/val-debian-os-eol.json";

  const host = exhibit.host;
  const alert = exhibit.alert;
  const rule = exhibit.rule;
  const evidence = alert.evidence as Record<string, unknown>;
  const supportEnds = String(evidence.standard_support_ends ?? "");
  const extendedEnds = String(evidence.extended_support_ends ?? "");

  const provenance = {
    capturedAt: "2026-08-26 12:03 UTC",
    host: host.hostname,
    crucible: host.crucible_version,
    scenario: "unarmed baseline",
  };
</script>

<section class="chapter band-std" id="alert-workflow">
  <div class="site-grid">
    <div class="col-1-7 head">
      <h2>This is what an alert should tell you.</h2>
      <p class="lede">
        Not a red badge and a metric name: what happened, the evidence behind
        the conclusion, the check to run, and the remediation. One real alert,
        exactly as the product raised it.
      </p>
    </div>

    <figure class="col-1-12 workflow">
      <div class="wf-head">
        <span class="sev">{rule.priority} {alert.severity.toUpperCase()}</span>
        <span class="wf-title">{alert.title}</span>
        <span class="wf-host">{host.hostname} · {host.hardware}</span>
      </div>
      <div class="stages">
        <div class="wf-stage">
          <p class="stage-label"><span class="stage-num">1</span>CONSEQUENCE</p>
          <p class="stage-body">{alert.message}</p>
        </div>
        <div class="wf-stage">
          <p class="stage-label"><span class="stage-num">2</span>EVIDENCE</p>
          <div class="stage-body evidence-list">
            <span>standard support ended {supportEnds}</span>
            <span>extended window to {extendedEnds}</span>
            <span class="rule-id">rule {rule.id}</span>
          </div>
        </div>
        <div class="wf-stage">
          <p class="stage-label"><span class="stage-num">3</span>CHECK</p>
          <pre class="stage-body cmd"><code>{rule.quick_check_command}</code></pre>
        </div>
        <div class="wf-stage">
          <p class="stage-label"><span class="stage-num">4</span>REMEDIATION</p>
          <p class="stage-body">{alert.recommendation}</p>
        </div>
      </div>
      <figcaption class="provenance">
        captured {provenance.capturedAt} · host {provenance.host} · Crucible
        {provenance.crucible} · scenario {provenance.scenario}
      </figcaption>
    </figure>

    <p class="col-1-8 furnace-note">
      Optional AI analysis can narrate context after the evidence and the fixed
      remediation. It never replaces them, and it never executes anything.
    </p>
  </div>
</section>

<style>
  h2 {
    font-size: var(--type-h2);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 14px;
    text-wrap: balance;
  }
  .lede {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 28px;
    max-width: 60ch;
  }

  .workflow {
    margin: 0;
    border: 1px solid var(--g-border-strong);
    border-radius: var(--g-radius-3);
    background: var(--g-surface-1);
    overflow: hidden;
  }
  .wf-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 10px 14px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--g-border-subtle);
    background: var(--g-surface-2);
  }
  .sev {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--g-warning);
    border: 1px solid var(--g-warning);
    border-radius: var(--g-radius-1);
    padding: 2px 7px;
    white-space: nowrap;
  }
  .wf-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .wf-host {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .stages {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }
  .wf-stage {
    padding: 16px 20px 18px;
    border-right: 1px solid var(--g-border-subtle);
    min-width: 0;
  }
  .wf-stage:last-child {
    border-right: none;
  }
  .stage-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stage-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1px solid var(--g-brand-edge);
    border-radius: 50%;
    color: var(--g-brand);
    font-size: 12px;
  }
  .stage-body {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .evidence-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .rule-id {
    color: var(--text-tertiary);
  }
  .cmd {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--g-bg);
    border: 1px solid var(--g-border-subtle);
    border-radius: var(--g-radius-1);
    padding: 10px 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  .furnace-note {
    margin: 20px 0 0;
    font-size: 13px;
    color: var(--text-tertiary);
    line-height: 1.6;
    max-width: 68ch;
  }

  @media (max-width: 1023px) {
    .stages {
      grid-template-columns: 1fr 1fr;
    }
    .wf-stage {
      border-bottom: 1px solid var(--g-border-subtle);
    }
    .wf-stage:nth-child(even) {
      border-right: none;
    }
    .wf-stage:nth-child(n + 3) {
      border-bottom: none;
    }
  }
  @media (max-width: 600px) {
    .stages {
      grid-template-columns: 1fr;
    }
    .wf-stage {
      border-right: none;
      border-bottom: 1px solid var(--g-border-subtle);
    }
    .wf-stage:nth-child(n + 3) {
      border-bottom: 1px solid var(--g-border-subtle);
    }
    .wf-stage:last-child {
      border-bottom: none;
    }
  }
</style>
