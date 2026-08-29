<script lang="ts">
  import productFacts from "$lib/data/product-facts.json";
  // The OSS architecture, within the first 1.5 screens (design brief
  // section 9). Structured HTML with fine borders and mono labels; no
  // cartoon cloud architecture, no decorative ASCII.
  const sources = ["/proc", "/sys", "SMART", "IPMI", "ZFS", "ECC", "network"];
  const platform = ["alerts", "history", "dashboard", "notifications", "API", "MCP"];
</script>

<section class="arch" aria-label="Glassmkr architecture">
  <div class="inner">
    <div class="stage">
      <p class="stage-label">YOUR SERVER</p>
      <ul class="items">
        {#each sources as s (s)}<li>{s}</li>{/each}
      </ul>
    </div>

    <div class="link" aria-hidden="true">
      <span class="link-line"></span>
      <span class="link-label">Crucible<br /><em>AGPL-3.0-only</em></span>
      <span class="link-arrow">&rarr;</span>
    </div>

    <div class="stage">
      <p class="stage-label">GLASSMKR</p>
      <ul class="items">
        {#each platform as p (p)}<li>{p}</li>{/each}
      </ul>
    </div>

    <div class="link" aria-hidden="true">
      <span class="link-line"></span>
      <span class="link-arrow">&rarr;</span>
    </div>

    <div class="stage targets">
      <div class="target">
        <p class="stage-label">SELF HOST</p>
        <p class="target-note">{productFacts.dashboardLicenseSpdx}</p>
      </div>
      <div class="target">
        <p class="stage-label">HOSTED</p>
        <p class="target-note">managed</p>
      </div>
    </div>
  </div>
</section>

<style>
  .arch {
    padding: 56px 24px;
    border-top: 1px solid var(--border-subtle);
  }
  .inner {
    max-width: 1000px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: 20px;
    align-items: stretch;
  }

  .stage {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: 16px 18px;
    background: var(--surface);
  }
  .stage-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .items li {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  .link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 84px;
  }
  .link-line {
    width: 1px;
    flex: 0 0 12px;
    background: var(--border-default);
    display: none;
  }
  .link-label {
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .link-label em { font-style: normal; color: var(--accent); }
  .link-arrow {
    font-family: var(--font-mono);
    color: var(--text-tertiary);
    font-size: 14px;
  }

  .targets {
    border: none;
    padding: 0;
    background: transparent;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .target {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: 14px 18px;
    background: var(--surface);
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .target .stage-label { margin: 0 0 4px; }
  .target-note {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
    margin: 0;
  }

  @media (max-width: 860px) {
    .inner { grid-template-columns: 1fr; }
    .link { flex-direction: row; min-width: 0; padding: 2px 0; }
    .link-arrow { transform: rotate(90deg); }
  }

  /* Mobile technical-text floor (taste pass 4.1). The provenance line is
     deliberately excluded: 4.2 keeps it exactly as established. */
  @media (max-width: 768px) {
    .stage-label { font-size: 12px; }
    .link-label { font-size: 12px; }
    .target-note { font-size: 12px; }
  }
</style>
