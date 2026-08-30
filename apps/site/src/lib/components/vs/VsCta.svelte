<script lang="ts">
  // Shared in-content CTA for the /vs comparison cluster (hub + the 8
  // competitor pages). Two variants:
  //   - "mid":    a slim inline band dropped mid-page, at the point a
  //               reader has just learned where Glassmkr fits them.
  //   - "bottom": a fuller closing conversion band before the
  //               "compare to other tools" footer.
  // Both surface the two lowest-friction actions: the seeded read-only
  // live demo (no signup) and a free account. The demo is primary
  // because a comparison-page reader is still evaluating; the demo lets
  // them see real output without committing.
  //
  // Reuses the global .btn / .btn-primary / .btn-ghost classes from
  // packages/ui base.css; layout styles are scoped here.
  let {
    variant = "mid",
    competitor = "",
  }: { variant?: "mid" | "bottom"; competitor?: string } = $props();

  const DEMO_URL = "https://app.glassmkr.com/demo";
  const SIGNUP_URL = "https://app.glassmkr.com/register";
</script>

{#if variant === "mid"}
  <aside class="vs-cta vs-cta-mid" aria-label="Try Glassmkr">
    <div class="cta-copy">
      <p class="cta-lead">See it on real infrastructure.</p>
      <p class="cta-sub">
        The live demo is a seeded, read-only dashboard with real alerts firing. No signup, no card.
      </p>
    </div>
    <div class="cta-actions">
      <a href={DEMO_URL} class="btn btn-primary">Browse the live demo</a>
      <a href={SIGNUP_URL} class="btn btn-ghost">Start free</a>
    </div>
  </aside>
{:else}
  <aside class="vs-cta vs-cta-bottom" aria-label="Get started with Glassmkr">
    <p class="cta-lead">
      {competitor
        ? `Compare Glassmkr and ${competitor} on your own servers.`
        : "Try Glassmkr on your own servers."}
    </p>
    <p class="cta-sub">
      Free both ways: self-host the AGPL-3.0-only stack, or use the hosted service. Or explore the seeded live demo first.
    </p>
    <div class="cta-actions">
      <a href={DEMO_URL} class="btn btn-primary btn-cta">Browse the live demo</a>
      <a href="/docs/self-hosting" class="btn btn-ghost btn-cta">Self-host in 10 minutes</a>
      <a href={SIGNUP_URL} class="btn btn-ghost btn-cta">Use hosted</a>
    </div>
    <p class="cta-caption">No card required either way.</p>
  </aside>
{/if}

<style>
  .vs-cta {
    max-width: 880px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .cta-lead {
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .cta-sub {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 6px 0 0;
  }
  .cta-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  /* Mid: slim horizontal band inside the article flow. */
  .vs-cta-mid {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 18px 28px;
    margin-top: 40px;
    padding: 22px 24px;
    border: 1px solid var(--surface-border);
    border-left: 2px solid var(--accent);
    border-radius: 0 8px 8px 0;
    background: rgba(255, 107, 53, 0.04);
  }
  .vs-cta-mid .cta-copy {
    flex: 1 1 320px;
  }
  .vs-cta-mid .cta-lead {
    font-size: 16px;
  }
  .vs-cta-mid .cta-sub {
    font-size: 14px;
  }
  .vs-cta-mid .cta-actions {
    flex: 0 0 auto;
  }

  /* Bottom: fuller centered closing band. */
  .vs-cta-bottom {
    text-align: center;
    margin: 56px auto 0;
    padding: 40px 28px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    background:
      radial-gradient(ellipse at top, rgba(255, 107, 53, 0.06), transparent 60%),
      rgba(255, 255, 255, 0.015);
  }
  .vs-cta-bottom .cta-lead {
    font-size: clamp(20px, 2.6vw, 26px);
    letter-spacing: -0.01em;
  }
  .vs-cta-bottom .cta-sub {
    font-size: 15px;
    max-width: 560px;
    margin: 10px auto 0;
  }
  .vs-cta-bottom .cta-actions {
    justify-content: center;
    margin-top: 24px;
  }
  .btn-cta {
    padding: 11px 22px;
    font-size: 15px;
  }
  .cta-caption {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 16px 0 0;
  }

  @media (max-width: 640px) {
    .vs-cta-mid {
      flex-direction: column;
      align-items: flex-start;
    }
    .vs-cta-mid .cta-actions {
      width: 100%;
    }
  }
</style>
