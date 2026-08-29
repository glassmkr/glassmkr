<script lang="ts">
  // Hero per GLASSMKR_REDESIGN_FINAL_SPEC section 14.1: the exact factual
  // hierarchy (what it monitors, self-hostable, licenses, hosted optional),
  // the canonical Compose quickstart as the hero command (never curl|bash),
  // and one product evidence exhibit below. License labels come from the
  // configured product facts, never typed into copy.
  import HeroSurface from "./HeroSurface.svelte";
  import ComposeQuickstart from "$lib/components/ComposeQuickstart.svelte";
  import { CRUCIBLE_LICENSE, DASHBOARD_LICENSE_LABEL } from "$lib/product-facts";

</script>

<section class="hero">
  <p class="eyebrow">OPEN SOURCE · CRUCIBLE {CRUCIBLE_LICENSE} · GLASSMKR {DASHBOARD_LICENSE_LABEL}</p>

  <h1>Open-source monitoring for bare metal.</h1>

  <p class="subhead">
    Glassmkr watches SMART, IPMI, ECC, RAID, ZFS, and network hardware, then
    shows the evidence and the next command to run. Self-host the full stack
    or use the hosted service.
  </p>

  <div class="cta-row">
    <a href="https://github.com/glassmkr/crucible" class="btn btn-primary btn-lg">View on GitHub</a>
    <a href="https://app.glassmkr.com/register" class="btn btn-ghost btn-lg">Use the hosted service</a>
    <a href="/docs/self-hosting" class="btn btn-ghost btn-lg">Self-host Glassmkr</a>
  </div>

  <div class="hero-quickstart">
    <ComposeQuickstart />
  </div>

  <p class="audience-line">
    If you can run software on a Linux server but would not call yourself a
    Linux administrator, Glassmkr is designed for you.
  </p>

  <HeroSurface />
</section>

<style>
  /* Left-aligned, not centred. A centred headline, subhead, button row and
     code block stacked down the middle is the template signal the brief named,
     and the references this follows are all left-aligned. Vertical space is
     tightened so the evidence exhibit reaches the fold. */
  .hero {
    padding: 56px 24px 44px;
    text-align: left;
    max-width: 1120px;
    margin: 0 auto;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    color: var(--accent);
    margin: 0 0 16px;
  }

  h1 {
    font-size: clamp(32px, 4.6vw, 54px);
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.1;
    margin: 0 0 16px;
    max-width: 20ch;
    color: var(--text-primary);
    text-wrap: balance;
  }

  .subhead {
    max-width: 62ch;
    margin: 0 0 26px;
    font-size: clamp(15px, 1.5vw, 17px);
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .cta-row {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .btn-lg {
    padding: 11px 22px;
    font-size: 14.5px;
    font-weight: 500;
    border-radius: var(--radius-md);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--surface-border);
  }
  .btn-ghost:hover { border-color: var(--accent); text-decoration: none; }
  .btn-ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Audience-recognition line (prelaunch spec B1): shipped once, here, and
     nowhere else. Quiet on purpose; it addresses the reader the H1 does not,
     without costing the expert reader anything. */
  .audience-line {
    max-width: 640px;
    margin: 0 0 22px;
    font-size: 14.5px;
    line-height: 1.6;
    color: var(--text-tertiary);
  }

  .hero-quickstart {
    max-width: 640px;
    margin: 0 0 4px;
  }

  @media (max-width: 720px) {
    .hero { padding: 48px 20px 48px; }
    .cta-row { flex-direction: column; align-items: stretch; }
    .btn-lg { justify-content: center; }
  }
</style>
