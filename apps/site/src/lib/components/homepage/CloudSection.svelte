<script lang="ts">
  // The hosted service, introduced only after the open-source product
  // (redesign spec 14.6): the ONLY detailed hosted comparison on the
  // homepage. Restrained two-column comparison, not pricing cards. The
  // node cap comes from product-facts; no location claim ships until
  // Simon approves one (spec 8.5).
  import { HOSTED_NODE_CAP } from "$lib/product-facts";
</script>

<section class="cloud" id="hosted">
  <div class="inner">
    <h2>Don't want to operate the monitoring stack?</h2>
    <p class="lede">
      The Glassmkr hosted service runs the same open-source software for you.
    </p>

    <div class="compare" role="table" aria-label="Self-hosted vs Glassmkr hosted">
      <div class="col" role="row">
        <p class="col-label">SELF-HOSTED</p>
        <p class="price">$0</p>
        <ul>
          <li>Complete AGPL-3.0-only stack</li>
          <li>Your infrastructure and operations</li>
          <li>Your retention and storage policy</li>
        </ul>
        <a href="/docs/self-hosting" class="col-link">Read the self-hosting guide &rarr;</a>
      </div>
      <div class="col" role="row">
        <p class="col-label">GLASSMKR HOSTED</p>
        <p class="price">$0</p>
        <ul>
          <li>Same product, operated by Glassmkr</li>
          <li>Free up to {HOSTED_NODE_CAP} nodes per account</li>
          <li>Managed updates and backups</li>
        </ul>
        <a href="https://app.glassmkr.com/register" class="btn btn-primary col-cta">Create an account</a>
      </div>
    </div>

    <p class="fine"><a href="/pricing">Pricing details &rarr;</a></p>
  </div>
</section>

<style>
  .cloud {
    padding: 72px 24px 88px;
    border-top: 1px solid var(--border-subtle);
  }
  .inner { max-width: 1000px; margin: 0 auto; }

  h2 {
    font-size: clamp(24px, 3.2vw, 34px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 10px;
  }
  .lede {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 28px;
  }

  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .col { padding: 20px; }
  .col:first-child { border-right: 1px solid var(--border-subtle); }
  .col-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    margin: 0 0 10px;
  }
  .price {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 14px;
  }
  .col ul {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .col li {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .col-link { font-size: 14px; color: var(--accent); text-decoration: none; }
  .col-link:hover { text-decoration: underline; }
  .col-cta {
    display: inline-block;
    padding: 9px 18px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
  }

  .fine {
    margin: 16px 0 0;
    font-size: 13px;
    color: var(--text-tertiary);
  }
  /* Standalone link in fine print, 17px tall. */
  .fine a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }

  @media (max-width: 720px) {
    .compare { grid-template-columns: 1fr; }
    .col:first-child { border-right: none; border-bottom: 1px solid var(--border-subtle); }
  }

  /* Mobile technical-text floor (taste pass 4.1). The provenance line is
     deliberately excluded: 4.2 keeps it exactly as established. */
  @media (max-width: 768px) {
    .col-label { font-size: 12px; }
  }
</style>
