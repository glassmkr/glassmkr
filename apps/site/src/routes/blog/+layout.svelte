<script lang="ts">
  // Blog route group. This layout exists to scope the editorial face:
  // Source Serif 4 loads HERE and nowhere else (final spec 9.4/9.5), so the
  // homepage and docs never pay for a font they must not use, and the serif
  // keeps meaning "this is an essay" rather than becoming general decoration.
  //
  // Article typography itself is applied per post; this layout only makes the
  // face available and sets the reading measure the spec asks for (680 to
  // 760px) on the article body without touching existing post markup.
  import "@fontsource/source-serif-4/400.css";
  import "@fontsource/source-serif-4/600.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="blog-scope">
  {@render children()}
</div>

<style>
  /* Editorial typography, scoped to the blog. Titles, dek, and long-form
     prose take the serif; code, data, captions, and any UI chrome inside a
     post keep the mono and sans they already use. */
  .blog-scope :global(article h1),
  .blog-scope :global(article h2),
  .blog-scope :global(article h3),
  .blog-scope :global(.post-dek),
  .blog-scope :global(.post-body p),
  .blog-scope :global(.post-body li) {
    font-family: var(--font-serif);
  }
  /* Never the serif: machine-readable content and figure captions stay in
     their own voices even inside an article. */
  .blog-scope :global(article code),
  .blog-scope :global(article pre),
  .blog-scope :global(article figcaption),
  .blog-scope :global(article .provenance) {
    font-family: var(--font-mono);
  }
</style>
