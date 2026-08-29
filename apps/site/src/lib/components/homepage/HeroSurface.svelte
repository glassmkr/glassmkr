<script lang="ts">
  // The hero's product exhibit (redesign spec sections 7 and 14.1).
  //
  // This is a recorded-data render, the second exhibit form the spec allows:
  // the captured alert is immutable JSON in $lib/data/exhibits, and this
  // component renders it. That is deliberate over a screenshot. An image of a
  // dark dashboard is unreadable on a phone, unselectable, invisible to a
  // screen reader, and goes stale silently; this reflows, and
  // scripts/check-exhibits.mjs recomputes the artifact's hash so the exhibit
  // cannot drift from the provenance line beneath it.
  //
  // Every value below comes from the capture. Nothing here is illustrative.
  import exhibit from "$lib/data/exhibits/val-debian-os-eol.json";

  const host = exhibit.host;
  const alert = exhibit.alert;
  const rule = exhibit.rule;

  // The dashboard composes the OS label from these two fields; do the same
  // rather than storing a display string nobody captured.
  const osLabel = `${host.os_type.charAt(0).toUpperCase()}${host.os_type.slice(1)} ${host.os_version}`;

  // Provenance values, kept in one place so the caption cannot disagree with
  // the manifest entry.
  const provenance = {
    capturedAt: "2026-08-26 12:03 UTC",
    host: host.hostname,
    crucible: host.crucible_version,
    scenario: "unarmed baseline",
  };

  const evidence = alert.evidence as Record<string, unknown>;
  const supportEnds = String(evidence.standard_support_ends ?? "");
  const extendedEnds = String(evidence.extended_support_ends ?? "");
</script>

<figure class="exhibit">
  <div class="host-row">
    <span class="hostname">{host.hostname}</span>
    <span class="state state-warning">{host.active_alerts} ALERTS</span>
  </div>

  <div class="facts">
    <span>{osLabel}</span>
    <span>{host.hardware}</span>
    <span>CRUCIBLE v{host.crucible_version}</span>
    <span>IPMI {host.ipmi_sensors} SENSORS</span>
  </div>

  <div class="alert">
    <div class="alert-head">
      <span class="sev">{rule.priority} {alert.severity.toUpperCase()}</span>
      <span class="alert-title">{alert.title}</span>
    </div>

    <p class="alert-message">{alert.message}</p>

    <div class="alert-evidence">
      <span>standard support ended {supportEnds}</span>
      <span>extended window to {extendedEnds}</span>
      <span class="rule-id">{rule.id}</span>
    </div>

    <p class="alert-recommendation">{alert.recommendation}</p>

    <p class="cmd-label">QUICK CHECK</p>
    <pre class="alert-cmd"><code>{rule.quick_check_command}</code></pre>
  </div>

  <!-- Spec 7.3: the provenance line is real HTML inside figcaption, never
       baked into an image, and carries actual values from capture time. -->
  <figcaption class="provenance">
    captured {provenance.capturedAt} · host {provenance.host} · Crucible
    {provenance.crucible} · scenario {provenance.scenario}
  </figcaption>
</figure>

<style>
  .exhibit {
    max-width: 880px;
    margin: 48px auto 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface);
    text-align: left;
    overflow: hidden;
  }

  .host-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .hostname {
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .state {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
  }
  .state-warning { color: var(--yellow); }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    text-transform: uppercase;
  }

  .alert { padding: 16px 20px 18px; }
  .alert-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 10px;
  }
  .sev {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--yellow);
    border: 1px solid var(--yellow);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    white-space: nowrap;
  }
  .alert-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .alert-message {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0 0 10px;
  }
  .alert-evidence {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .rule-id { color: var(--text-tertiary); }
  .alert-recommendation {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .cmd-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin: 0 0 6px;
  }
  .alert-cmd {
    margin: 0;
    padding: 10px 14px;
    background: var(--bg);
    /* Already inside the bordered hero surface */
    border: none;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .alert-cmd code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  .provenance {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-subtle);
    padding: 8px 20px;
    margin: 0;
  }

  @media (max-width: 720px) {
    .exhibit { margin-top: 32px; }
    .facts { gap: 6px 16px; }
    .alert { padding: 14px 16px 16px; }
  }

  /* Mobile technical-text floor (taste pass 4.1). The provenance line is
     deliberately excluded: 4.2 keeps it exactly as established. */
  @media (max-width: 768px) {
    .state { font-size: 12px; }
    .cmd-label { font-size: 12px; }
    .facts { font-size: 12px; }
    .alert-evidence { font-size: 12px; }
    .sev { font-size: 12px; }
  }
</style>
