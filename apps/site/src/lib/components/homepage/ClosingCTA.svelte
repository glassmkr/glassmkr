<script lang="ts">
  // Closing action (content redesign 5.10, exact copy). One primary, one
  // secondary, one text route to the source.
</script>

<section class="closing band-std">
  <div class="site-grid">
    <div class="col-1-8">
      <h2>See what Glassmkr notices on one server.</h2>
      <p class="body">
        Start with a server whose history you know. The hosted service is free,
        and you can remove the agent or point it at a self-hosted dashboard
        later.
      </p>
      <div class="actions">
        <a href="https://app.glassmkr.com/register" class="btn btn-solid-brand btn-hero">Monitor a server for free</a>
        <a href="https://app.glassmkr.com/demo" class="btn btn-hero btn-quiet">Browse the live demo</a>
      </div>
      <p class="source">
        <a href="https://github.com/glassmkr/glassmkr">Read the source &rarr;</a>
      </p>
    </div>
  </div>
</section>

<style>
  .closing {
    border-top: 1px solid var(--g-border-subtle);
  }
  h2 {
    font-size: var(--type-h2);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 14px;
    text-wrap: balance;
  }
  .body {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 24px;
    max-width: 58ch;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 14px;
  }
  .source a {
    font-size: 13.5px;
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 3px;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  .source a:hover {
    color: var(--text-primary);
  }
  @media (max-width: 640px) {
    .actions :global(.btn) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
