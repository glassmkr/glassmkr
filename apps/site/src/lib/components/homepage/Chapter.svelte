<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Chapter number, e.g. "1.0", "2.0" */
    number: string;
    title: string;
    /** Visual snippet rendered in the image column. Optional since the
     *  2026-05-17 tranche-1 refresh: chapters covering topics with no
     *  natural showcase pairing (notifications, pricing) render
     *  text-only with a wider prose column. All non-text visuals are
     *  HTML/CSS recreations from $lib/components/showcase. */
    visual?: Snippet;
    /** Place the visual column on the left (true) or right (false).
     *  Alternated per chapter so the page doesn't read as a column. */
    imageLeft?: boolean;
    /** "split" = side-by-side (default for 1.0/2.0/4.0).
     *  "fullbleed" = prose above + visual full-width below + prose
     *                below (used by chapter 3.0). */
    layout?: "split" | "fullbleed";
    /** Sub-features list, e.g. ["1.1 ...", "1.2 ...", ...] */
    subfeatures?: string[];
    /** Body prose. For fullbleed layout the snippet receives no args
     *  and renders both the above and below prose blocks itself. */
    children: Snippet;
    belowImage?: Snippet;
  }

  let {
    number,
    title,
    visual,
    imageLeft = true,
    layout = "split",
    subfeatures = [],
    children,
    belowImage,
  }: Props = $props();
</script>

<section class="chapter" class:fullbleed={layout === "fullbleed"} class:image-right={!imageLeft && layout === "split"} class:text-only={!visual && layout === "split"}>
  <div class="inner">
    {#if layout === "split"}
      <div class="split-grid" class:single-col={!visual}>
        <div class="prose-col">
          <div class="chapter-number">{number}</div>
          <h2>{title}</h2>
          <div class="prose">
            {@render children()}
          </div>
          {#if subfeatures.length > 0}
            <ul class="subfeatures">
              {#each subfeatures as f}
                <li>{f}</li>
              {/each}
            </ul>
          {/if}
        </div>
        {#if visual}
          <div class="image-col">
            {@render visual()}
          </div>
        {/if}
      </div>
    {:else}
      <!-- fullbleed: prose above, screenshot full-width, prose below.
           Spec says NOT side-by-side and NOT a vertical stack of multiple
           alerts. -->
      <div class="fullbleed-stack">
        <div class="prose-header">
          <div class="chapter-number">{number}</div>
          <h2>{title}</h2>
          <div class="prose">
            {@render children()}
          </div>
        </div>

        {#if visual}
          <div class="fullbleed-visual">
            {@render visual()}
          </div>
        {/if}

        {#if belowImage}
          <div class="prose-footer">
            {@render belowImage()}
          </div>
        {/if}

        {#if subfeatures.length > 0}
          <ul class="subfeatures fullbleed-subs">
            {#each subfeatures as f}
              <li>{f}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .chapter {
    padding: 96px 24px;
  }

  .inner {
    max-width: 1280px;
    margin: 0 auto;
  }

  .split-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 80px;
    align-items: center;
  }
  /* Text-only chapter (no visual prop). Single centered column wider
     than the prose half of a split chapter; keeps line lengths
     readable while removing the side-by-side rhythm cleanly. */
  .split-grid.single-col {
    grid-template-columns: 1fr;
    max-width: 760px;
    margin: 0 auto;
  }
  /* Alternate sides: when image-right, the image column moves to col 2. */
  .chapter.image-right .split-grid .prose-col { order: 1; }
  .chapter.image-right .split-grid .image-col { order: 2; }

  .chapter-number {
    font-family: var(--font-mono, monospace);
    font-size: 36px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--accent);
    opacity: 0.55;
    margin-bottom: 28px;
  }

  h2 {
    font-size: clamp(28px, 3.4vw, 38px);
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 0 0 22px;
  }

  .prose :global(p) {
    font-size: 15.5px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 16px;
  }
  .prose :global(p:last-child) { margin-bottom: 0; }
  .prose :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    background: rgba(245, 166, 35, 0.06);
    color: var(--accent);
    padding: 2px 6px;
    border-radius: var(--radius-md);
  }

  .image-col { width: 100%; }

  .subfeatures {
    list-style: none;
    padding: 0;
    margin: 32px 0 0;
  }
  .subfeatures li {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    color: var(--text-tertiary);
    padding: 8px 0;
    border-top: 1px solid var(--surface-border);
  }
  .subfeatures li:last-child { border-bottom: 1px solid var(--surface-border); }

  /* Fullbleed layout (chapter 3.0) */
  .fullbleed-stack {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .prose-header, .prose-footer {
    max-width: 820px;
    margin: 0 auto;
    text-align: center;
  }
  .prose-header h2 { margin-bottom: 22px; }
  .fullbleed-visual {
    width: 100%;
  }
  .fullbleed-subs {
    max-width: 820px;
    margin: 24px auto 0;
  }

  @media (max-width: 1024px) {
    .split-grid {
      grid-template-columns: 1fr;
      gap: 40px;
    }
    .chapter.image-right .split-grid .prose-col { order: 2; }
    .chapter.image-right .split-grid .image-col { order: 1; }
  }

  @media (max-width: 640px) {
    .chapter { padding: 64px 20px; }
    .chapter-number { font-size: 28px; margin-bottom: 18px; }
  }
</style>
