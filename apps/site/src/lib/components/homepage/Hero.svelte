<script lang="ts">
  // Hero per the visual spec (10.1, 10.2) with the exact copy from the
  // server-owner content redesign (5.2). Two buttons, one tertiary text link,
  // no deployment command in the hero, hosted route primary. The node cap
  // comes from configured product facts, never a literal.
  import ProductStage from "./ProductStage.svelte";
  import { HOSTED_NODE_CAP } from "$lib/product-facts";
</script>

<section class="hero">
  <div class="ambient" aria-hidden="true"></div>
  <div class="site-grid hero-grid">
    <div class="col-1-9 hero-copy">
      <p class="eyebrow">OPEN SOURCE LINUX SERVER MONITORING</p>

      <h1>
        Know when your server is in trouble, and
        <span class="h1-accent">what to do next.</span>
      </h1>

      <p class="subhead">
        Glassmkr watches the Linux and hardware signals most people never
        configure, explains what needs attention, and gives you the next
        command to run. Install one agent. Use the free hosted dashboard or run
        the complete stack yourself.
      </p>

      <div class="cta-row">
        <a href="https://app.glassmkr.com/register" class="btn btn-solid-brand btn-hero">Monitor a server for free</a>
        <a href="https://app.glassmkr.com/demo" class="btn btn-hero btn-quiet">Explore the live demo</a>
      </div>
      <p class="cta-caption">
        No card. Hosted accounts are free up to {HOSTED_NODE_CAP} nodes.
        Self-hosted has no node limit.
        <a href="https://github.com/glassmkr/glassmkr" class="source-link">View the source on GitHub</a>
      </p>
    </div>

    <div class="col-1-12 hero-stage">
      <ProductStage />
    </div>
  </div>
</section>

<style>
  .hero {
    position: relative;
    padding-top: clamp(50px, 7.2vh, 78px);
    overflow: hidden;
  }
  /* The one allowed ambient field (spec 9.2): a subtle warm radial behind the
     hero only, never global, hidden from assistive tech. */
  .ambient {
    position: absolute;
    inset: -20% -10% auto;
    height: 640px;
    pointer-events: none;
    background: radial-gradient(ellipse 70% 55% at 28% 8%, rgba(255, 107, 53, 0.07) 0%, transparent 70%);
  }
  .hero-grid {
    position: relative;
    row-gap: 0;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.16em;
    color: var(--g-brand);
    margin: 0 0 14px;
  }

  h1 {
    /* Display scale (spec 5.2): large, weight 500, tight leading and
       tracking, at most two lines at 1280. */
    font-size: clamp(2.5rem, 2rem + 2.8vw, 4.6rem);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.0;
    margin: 0 0 16px;
    /* The approved H1 is 58 characters and the hero copy spans nine columns
       (about 1000px). "No more than two lines" is a hard requirement; the
       72-76px size is a target, so the size yields the last few pixels. */
    max-width: 1120px;
    color: var(--text-primary);
    text-wrap: balance;
  }
  /* One solid brand phrase, no gradient (spec 10.2). */
  .h1-accent {
    color: var(--g-brand);
  }

  .subhead {
    max-width: 70ch;
    margin: 0 0 20px;
    font-size: 16px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 10px;
  }
  :global(.btn.btn-hero) {
    padding: 11px 22px;
    font-size: 15px;
    min-height: 44px;
  }
  :global(.btn.btn-quiet) {
    background: transparent;
    border: 1px solid var(--g-border-strong);
    color: var(--text-primary);
  }
  :global(.btn.btn-quiet:hover) {
    border-color: var(--g-brand-edge);
    background: transparent;
    color: var(--text-primary);
  }

  .cta-caption {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0 0 26px;
    max-width: 78ch;
  }
  .source-link {
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 3px;
    margin-left: 6px;
  }
  .source-link:hover {
    color: var(--text-primary);
  }

  .hero-stage {
    padding-bottom: 8px;
  }

  @media (max-width: 767px) {
    .hero {
      padding-top: 36px;
    }
    h1 {
      line-height: 1.04;
    }
    .cta-row :global(.btn) {
      width: 100%;
      justify-content: center;
    }
    .cta-caption {
      margin-bottom: 28px;
    }
  }
</style>
