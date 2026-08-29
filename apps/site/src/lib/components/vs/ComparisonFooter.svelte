<script lang="ts">
  // Shared "Compare to other tools" footer for all 8 /vs/<competitor>
  // comparison pages per CONTENT_TRANCHE_2 spec (2026-05-17). Filters
  // the current page out so each page surfaces only the other 7.
  //
  // The authoritative competitor list lives in ./competitors.ts so the
  // /vs hub index can reuse it; adding/removing a competitor is a
  // one-line change there.
  import { COMPETITORS } from "./competitors";

  let { current }: { current: string } = $props();
  let others = $derived(COMPETITORS.filter((c) => c.slug !== current));
</script>

<aside class="compare-footer" aria-label="Compare Glassmkr to other tools">
  <h2>Compare Glassmkr to other tools</h2>
  <ul>
    {#each others as c (c.slug)}
      <li><a href="/vs/{c.slug}">Glassmkr vs {c.label}</a></li>
    {/each}
  </ul>
</aside>

<style>
  .compare-footer {
    max-width: 880px;
    margin: 64px auto 80px;
    padding: 32px 24px 40px;
    border-top: 1px solid var(--surface-border);
  }
  .compare-footer h2 {
    font-size: clamp(20px, 2.4vw, 24px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 20px;
  }
  .compare-footer ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px 24px;
  }
  .compare-footer li {
    padding: 4px 0;
  }
  .compare-footer a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14.5px;
    transition: color 0.12s;
    /* 19px tall in a grid of stacked links: under the 24px floor, and this is
       how a reader moves between the ten comparison pages. */
    display: block;
    min-height: 24px;
    padding: 2px 0;
  }
  .compare-footer a:hover {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
</style>
