<svelte:head>
  <title>Billing Policy - Glassmkr</title>
  <meta name="description" content="Glassmkr no longer charges for anything. Both self-hosted and hosted are free as of August 2026." />
  <link rel="canonical" href="https://glassmkr.com/billing-policy" />
</svelte:head>

<div class="container-narrow">
  <h1>Billing Policy</h1>
  <div class="legal-content">
    <p class="last-updated">Last updated: August 24, 2026</p>

    <p>As of August 2026, Glassmkr no longer charges for anything.</p>

    <p>Both deployment forms are free: self-hosted is free forever under an open-source license (AGPL-3.0-only end to end) with no node limits, and the hosted service at <a href="https://app.glassmkr.com">app.glassmkr.com</a> is free with a 10-node per-account cap.</p>

    <p>Historical charges, where any account ever had them, were settled through Stripe. No subscriptions remain active and no future charges will occur.</p>

    <h2>Questions</h2>

    <p>Email <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a>.</p>
  </div>
</div>

<style>
  .container-narrow {
    max-width: 760px;
    margin: 0 auto;
    padding: 60px 24px 80px;
    position: relative;
    z-index: 1;
  }
  h1 {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 32px;
  }
  .legal-content :global(h2) {
    font-size: 20px;
    font-weight: 600;
    margin: 36px 0 12px;
    color: var(--text-primary);
  }
  .legal-content :global(p) {
    font-size: 15px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin-bottom: 14px;
  }
  .legal-content :global(ul) {
    margin: 0 0 14px 24px;
    padding: 0;
    color: var(--text-secondary);
    font-size: 15px;
    line-height: 1.75;
  }
  .legal-content :global(li) {
    margin-bottom: 6px;
  }
  .last-updated {
    color: var(--text-tertiary);
    font-size: 13px;
    margin-bottom: 32px;
  }
  .legal-content :global(a) {
    color: var(--accent);
  }
</style>
