<script lang="ts">
  // Slightly different background tone (#0d0d0d vs page's #0a0a0a) per
  // spec. No form, no email capture, no FAQ.
</script>

<section class="closing">
  <div class="inner">
    <h2>Run it where your trust model lives.</h2>
    <a href="/docs/self-hosting" class="btn btn-primary btn-lg">Self-host in 10 minutes</a>
    <p class="fineprint">Or <a href="https://app.glassmkr.com/register">use the hosted version</a>: free, no credit card, no email blasts.</p>
    <p class="subtitle">
      One compose file, one agent command. AGPL-3.0-only end to end, everything readable.
    </p>
  </div>
</section>

<style>
  .closing {
    padding: 96px 24px;
    background: #0d0d0d;
    border-top: 1px solid var(--surface-border);
  }
  .inner {
    max-width: 720px;
    margin: 0 auto;
    text-align: center;
  }

  h2 {
    font-size: clamp(28px, 4.4vw, 42px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 0 0 32px;
  }

  .btn-lg {
    display: inline-block;
    padding: 14px 28px;
    font-size: 15px;
    font-weight: 500;
    border-radius: var(--radius-md);
    text-decoration: none;
  }
  /* Primary CTA state model lives in packages/ui/base.css; this
     button picks it up via the .btn-primary class. */

  .fineprint {
    margin: 24px 0 0;
    font-size: 12.5px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }

  .subtitle {
    margin: 18px auto 0;
    max-width: 540px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .closing { padding: 72px 20px; }
  }
</style>
