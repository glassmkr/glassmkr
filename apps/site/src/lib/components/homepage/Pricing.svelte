<script lang="ts">
  import rules from "$lib/data/rules.json";

  // asPage: rendered as the standalone /pricing route rather than a
  // homepage section. On the homepage the page h1 is the hero, so this
  // section leads with an h2; on /pricing it is the page's own h1.
  let { asPage = false }: { asPage?: boolean } = $props();

  // Rule count from the generated catalog, never a literal.
  const ruleCount = rules.length;

  // OSS pivot (2026-08): both deployment forms are free. The old
  // Free/Pro tier model, the retired per-node price, and the slider are
  // gone; hosted carries a per-account node cap purely as capacity
  // protection, not tiering. Feature parity is total: the
  // GLASSMKR_SELF_HOSTED flag ungates self-host, and hosted accounts
  // get the same feature set. The cap value comes from product-facts,
  // never typed into a template (ground-truth.yaml: hosted_node_cap).
  import { HOSTED_NODE_CAP } from "$lib/product-facts";
  // A comparison sheet, not two product cards. Aligned attribute rows let the
  // two deployments be read against each other line by line, which is the real
  // question ("which do I run?"), and it drops the pricing-card shape that
  // reads as a SaaS template. No "Free forever" headline either: the fact is
  // $0, and the reason self-hosting stays $0 is the license, which the rows
  // state plainly.
  const sheet: [string, string, string][] = [
    ["Cost", "$0", "$0"],
    ["License", "AGPL-3.0-only", "Same software, operated for you"],
    ["Nodes", "No limit", `Up to ${HOSTED_NODE_CAP} per account`],
    ["Alert rules", `All ${ruleCount}`, `All ${ruleCount}`],
    ["Remediation and trend warnings", "Included", "Included"],
    ["Notification channels", "All", "All"],
    ["API", "Full read and write", "Full read and write"],
    ["MCP server", "Included, needs TLS in front", "Available"],
    ["AI analysis", "Any OpenAI-compatible endpoint", "Included"],
    ["Where data lives", "Your network", "Amsterdam"],
    ["Who operates it", "You", "Glassmkr"],
  ];

  const ctas = [
    { label: "Self-host in 10 minutes", href: "/docs/self-hosting", primary: true },
    { label: "Create an account", href: "https://app.glassmkr.com/register", primary: false },
  ];


  // The first answer is adopted verbatim from the round-2 decisions doc
  // (2026-08-24); the node count renders from HOSTED_NODE_CAP so the text
  // stays identical while the value stays sourced.
  const faq = [
    {
      q: "Why is hosted Glassmkr free?",
      a: `Glassmkr is primarily an open-source project. The hosted service is a convenient way to use the same software without operating the stack yourself. Hosted accounts currently support up to ${HOSTED_NODE_CAP} nodes.`,
    },
    {
      q: "Will hosted stay free?",
      a: "That is the intent. If hosted load ever forces a change, self-hosting stays free under AGPL-3.0-only and export exists.",
    },
    {
      q: "What is the difference?",
      a: "Same codebase. Self-hosted runs on your hardware with every gate removed; hosted is the same thing operated for you. Agents re-point between them with one init command.",
    },
  ];
</script>

<section class="pricing" id="pricing" style="scroll-margin-top: 70px">
  <div class="inner">
    <svelte:element this={asPage ? "h1" : "h2"}>Pricing</svelte:element>
    <p class="lede">Both ways of running Glassmkr are free. Pick where your trust model lives.</p>
      <div class="sheet" role="table" aria-label="Self-hosted compared with hosted">
        <div class="sheet-head" role="row">
          <span role="columnheader"></span>
          <span role="columnheader">Self-hosted</span>
          <span role="columnheader">Hosted</span>
        </div>
        {#each sheet as [label, selfHosted, hosted] (label)}
          <div class="sheet-row" role="row">
            <span class="attr" role="rowheader">{label}</span>
            <span role="cell">{selfHosted}</span>
            <span role="cell">{hosted}</span>
          </div>
        {/each}
      </div>

      <div class="sheet-ctas">
        {#each ctas as c (c.href)}
          <a href={c.href} class="btn {c.primary ? 'btn-primary' : 'btn-ghost'}">{c.label}</a>
        {/each}
      </div>


    <!-- These were h4 directly under the page h1, so the heading outline
         jumped two levels and a screen reader announced them as nested under
         a heading that does not exist. They are this page's second level: h2
         for the group, h3 for each question. Visual size comes from CSS, not
         from the tag. -->
    <section class="faq" aria-label="Pricing FAQ">
      <h2 class="faq-heading">Questions</h2>
      {#each faq as item (item.q)}
        <div class="faq-item">
          <h3>{item.q}</h3>
          <p>{item.a}</p>
        </div>
      {/each}
    </section>

    <p class="positioning">
      Every cloud, VM, and serverless workload runs on bare metal underneath. Glassmkr is the opinionated early-warning system that keeps that base running, so the layers above can focus on the app.
    </p>
  </div>
</section>

<style>
  .pricing {
    padding: 96px 24px;
  }
  .inner {
    max-width: 880px;
    margin: 0 auto;
    text-align: center;
  }

  h1,
  h2 {
    font-size: clamp(32px, 4.8vw, 48px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 16px;
  }

  .lede {
    font-size: 16px;
    color: var(--text-secondary);
    margin: 0 0 48px;
    line-height: 1.5;
  }
    /* Aligned attribute rows with one hairline between the two deployment
       columns. Deliberately not cards: a container around each option is the
       pricing-page cliche this replaces. */
    .sheet { margin: 40px auto 0; max-width: 760px; text-align: left; }
    .sheet-head,
    .sheet-row {
      display: grid;
      grid-template-columns: minmax(150px, 1.1fr) 1fr 1fr;
      gap: 24px;
      align-items: baseline;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .sheet-head {
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      border-bottom-color: var(--border-default);
    }
    .sheet-row span:not(.attr) { font-size: 14px; color: var(--text-primary); }
    .sheet-head > :nth-child(3),
    .sheet-row > :nth-child(3) {
      border-left: 1px solid var(--border-subtle);
      padding-left: 24px;
      margin-left: -12px;
    }
    .attr { font-size: 13.5px; color: var(--text-secondary); }
    .sheet-row:last-child { border-bottom: none; }
    .sheet-ctas {
      display: flex;
      gap: 12px;
      max-width: 760px;
      margin: 28px auto 0;
    }
    @media (max-width: 700px) {
      .sheet-head, .sheet-row { grid-template-columns: 1fr; gap: 2px; padding: 12px 0; }
      .sheet-head { display: none; }
      .sheet-head > :nth-child(3), .sheet-row > :nth-child(3) {
        border-left: none; padding-left: 0; margin-left: 0;
      }
      .sheet-row span:not(.attr)::before {
        font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em;
        color: var(--text-tertiary); margin-right: 8px;
      }
      .sheet-row span:nth-child(2)::before { content: "SELF-HOSTED"; }
      .sheet-row span:nth-child(3)::before { content: "HOSTED"; }
      .sheet-ctas { flex-direction: column; }
    }


  .faq {
    margin: 56px auto 0;
    max-width: 720px;
    text-align: left;
    border-top: 1px solid var(--surface-border);
    padding-top: 36px;
  }
  .faq-item {
    margin-bottom: 24px;
  }
  .faq-heading {
    font-size: 13px;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    font-weight: 400;
    margin: 0 0 6px;
  }
  .faq-item h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 6px;
  }
  .faq-item p {
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0;
  }

  .positioning {
    margin: 56px auto 0;
    max-width: 640px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-tertiary);
  }

  @media (max-width: 720px) {
    .pricing { padding: 64px 20px; }
  }

  /* Mobile technical-text floor (taste pass 4.1): these are product-surface
     and table labels, which must stay legible on a phone. Widened data
     scrolls inside its container rather than shrinking. */
  @media (max-width: 768px) {
    .sheet-head { font-size: 12px; }
  }
</style>
