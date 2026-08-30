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
  /* The shared article shell (post-redesign review P1-1). The old selectors
     targeted .post-body, which no post markup has ever had, so the shipped
     articles never rendered the editorial serif at all. These selectors match
     the real markup (article.post with direct children), which is the robust
     pattern the review prescribes. */
  .blog-scope :global(article.post h1),
  .blog-scope :global(article.post h2),
  .blog-scope :global(article.post h3),
  .blog-scope :global(article.post .lede),
  .blog-scope :global(article.post > p),
  .blog-scope :global(article.post > ul li),
  .blog-scope :global(article.post > ol li),
  .blog-scope :global(article.post > blockquote) {
    font-family: var(--font-serif);
  }
  /* Editorial body scale: 18.5px desktop, 1.65 line height, on the reading
     measure the container already provides. */
  .blog-scope :global(article.post > p),
  .blog-scope :global(article.post > ul li),
  .blog-scope :global(article.post > ol li),
  .blog-scope :global(article.post > blockquote) {
    font-size: 18.5px;
    line-height: 1.65;
  }
  .blog-scope :global(article.post .lede) {
    font-size: 20px;
    line-height: 1.6;
  }
  /* Major figures break out of the measure on wide viewports (review: 900
     to 1100px) while prose stays narrow. Negative-margin technique, gated to
     viewports that can afford it; mobile keeps everything in the column. */
  @media (min-width: 1120px) {
    .blog-scope :global(article.post > figure),
    .blog-scope :global(article.post > p > img) {
      width: 1000px;
      max-width: 1000px;
      margin-left: calc((100% - 1000px) / 2);
    }
    .blog-scope :global(article.post > figure img) {
      max-width: 100%;
    }
  }
  /* Never the serif: machine-readable content and figure captions stay in
     their own voices even inside an article. */
  .blog-scope :global(article.post code),
  .blog-scope :global(article.post pre),
  .blog-scope :global(article.post figcaption),
  .blog-scope :global(article.post .provenance),
  .blog-scope :global(article.post .post-meta) {
    font-family: var(--font-mono);
  }
  .blog-scope :global(article.post pre),
  .blog-scope :global(article.post code) {
    font-size: 14px;
  }
</style>
