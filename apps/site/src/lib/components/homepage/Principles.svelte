<script lang="ts">
  // Three principles per CONTENT_TRANCHE_1 spec (2026-05-17). The
  // previous version positioned the principles abstractly ("Built
  // from operations", "Transparency by default", "Free tools, paid
  // reliability"); the spec rewrites them to be more direct about
  // the operational stance, the audit-the-agent posture, and the
  // hedged-AI assistant. Heading also added per spec.
  //
  import rules from "$lib/data/rules.json";

  // Bodies are 2-3 sentences each; spec calls for substantive prose
  // not one-liners. Each principle stays under 60 words to keep the
  // grid scannable.
  const principles = [
    {
      number: "01",
      title: "Opinionated thresholds, not “configure your own monitoring.”",
      body: `You shouldn’t have to figure out what to monitor. We’ve watched bare-metal servers fail for ten years. The ${rules.length} alert rules that ship with Glassmkr fire when something is genuinely wrong, not when CPU briefly spikes. Tune per-server thresholds or disable rules that don’t apply to your fleet. You don’t have to.`,
    },
    {
      number: "02",
      title: "A stack you can read.",
      body: "The Crucible agent, the dashboard, the rules, the trend engine, and the remediation library are all AGPL-3.0-only. Read every line that runs on your servers and every line that judges their health. No proprietary blob, no telemetry you can’t inspect. We’d be suspicious of any monitoring tool that asks you not to.",
    },
    {
      number: "03",
      title: "AI where it helps, not as the headline.",
      body: "Furnace is our AI assistant. It reads the alert, looks at the evidence, suggests a fix. It doesn’t autocomplete shell commands at you. It hedges interpretive claims. It says “I don’t know” when it doesn’t know. The AI is a value-add for the alert remediation workflow, not the product.",
    },
  ];
</script>

<section class="principles">
  <div class="inner">
    <p class="section-eyebrow">FOUNDING PRINCIPLES</p>
    <h2 class="section-heading">Three principles.</h2>
    <div class="grid">
      {#each principles as p (p.number)}
        <div class="principle">
          <div class="principle-number">{p.number}</div>
          <h3>{p.title}</h3>
          <p>{p.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .principles {
    padding: 96px 24px;
  }
  .inner {
    max-width: 1200px;
    margin: 0 auto;
  }

  .section-eyebrow {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--accent);
    opacity: 0.7;
    margin: 0 0 16px;
    text-align: center;
  }

  .section-heading {
    text-align: center;
    font-size: clamp(24px, 3vw, 32px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.25;
    color: var(--text-primary);
    margin: 0 auto 56px;
    max-width: 640px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 60px 48px;
  }

  .principle {
    text-align: left;
  }

  .principle-number {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    letter-spacing: 0.1em;
    color: var(--accent);
    opacity: 0.55;
    margin-bottom: 18px;
  }

  .principle h3 {
    font-weight: 600;
    font-size: 22px;
    line-height: 1.25;
    color: var(--text-primary);
    margin: 0 0 12px;
  }

  .principle p {
    font-size: 14.5px;
    line-height: 1.65;
    color: var(--text-secondary);
    margin: 0;
  }

  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; gap: 48px; }
    .principles { padding: 72px 24px; }
  }
</style>
