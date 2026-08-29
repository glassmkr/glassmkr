<script lang="ts">
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // The static docs pages each have a generated /docs/<slug>.md twin
  // (scripts/docs-md.mjs, run at prebuild). The data-driven pages below do not,
  // so they get no actions. Keep in sync with STATIC_DOC_SLUGS: a static page
  // added there gets actions automatically; a new data-driven page must be
  // added to this exclude set.
  const NO_MARKDOWN = new Set(["/docs", "/docs/rules", "/docs/rules/[id]"]);
  let hasMarkdown = $derived($page.route.id != null && !NO_MARKDOWN.has($page.route.id));
  let mdHref = $derived($page.url.pathname.replace(/\/$/, "") + ".md");
  let copied = $state(false);

  // "Copy for LLM" fetches the page's Markdown twin and copies it to the
  // clipboard, so an agent or a human can paste the clean source straight
  // into a model. Degrades silently if fetch/clipboard is unavailable.
  async function copyForLlm() {
    try {
      const res = await fetch(mdHref);
      if (!res.ok) return;
      await navigator.clipboard.writeText(await res.text());
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* clipboard or fetch unavailable */
    }
  }

  // Give every docs code block a hover "Copy" button (the docs pages author
  // code as static <pre><code>, so we enhance in the DOM rather than per page).
  // A per-block copy is the right granularity here: several blocks are heredocs
  // or multi-line configs where a single line is not independently runnable.
  function enhanceCodeBlocks() {
    if (typeof document === "undefined") return;
    document.querySelectorAll<HTMLElement>(".docs-content pre").forEach((pre) => {
      if (pre.dataset.copyEnhanced) return;
      pre.dataset.copyEnhanced = "1";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code block");
      btn.addEventListener("click", async () => {
        try {
          const code = pre.querySelector("code") ?? pre;
          // Strip trailing blank lines and any leading "$ " shell prompts so the
          // clipboard holds exactly what you would type. Same cleaning as the
          // homepage InstallBlock copy, so both behave identically. (Docs blocks
          // are authored without prompts today; this keeps copy correct if one
          // is ever added, and never touches "#" comment lines.)
          const clean = (code.textContent ?? "").replace(/\n+$/, "").replace(/^\$\s+/gm, "");
          await navigator.clipboard.writeText(clean);
          btn.textContent = "Copied";
          btn.classList.add("ok");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("ok");
          }, 1500);
        } catch {
          /* clipboard unavailable */
        }
      });
      pre.appendChild(btn);
    });
  }
  onMount(enhanceCodeBlocks);
  afterNavigate(() => {
    tick().then(enhanceCodeBlocks);
  });
</script>

{#if hasMarkdown}
  <div class="doc-actions">
    <button class="da-btn" onclick={copyForLlm} title="Copy this page as Markdown for an LLM">
      {copied ? "Copied" : "Copy for LLM"}
    </button>
    <a class="da-btn" href={mdHref} title="View this page as raw Markdown">View as Markdown</a>
  </div>
{/if}

{@render children()}

<style>
  .doc-actions {
    position: fixed;
    top: 70px;
    right: 20px;
    z-index: 40;
    display: flex;
    gap: 6px;
  }
  .da-btn {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    padding: 5px 11px;
    border-radius: var(--radius-md);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .da-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Wrap long lines so code blocks never scroll horizontally; preserves
     indentation (pre-wrap) while breaking long URLs/flags. !important wins the
     specificity tie with each page's own scoped `pre` rule. */
  :global(.docs-content pre) {
    position: relative;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    overflow-x: visible !important;
  }
  /* Below 900px the sidebar is hidden, so the row has exactly one item and
     there is nothing to lay out in a row. Leaving the container as a flex
     context is what let /docs/changelog collapse its content column to 0px
     wide while its children rendered at the right padding edge and spilled
     past the viewport. Every docs page carries its own copy of the
     .docs-layout rule, so this lives here once rather than seventeen times. */
  @media (max-width: 900px) {
    :global(.docs-layout) {
      /* !important because each page's own `.docs-layout` rule is scoped, so
         it carries an extra class and wins the specificity contest against a
         bare :global selector. Same reason the pre rules below need it. */
      display: block !important;
    }
  }
  :global(.docs-content pre code) {
    /* !important for the same reason the rule above needs it, and this half was
       missing it: several docs pages set `pre code { white-space: pre }` in
       their own scoped styles, which won. That left a pre that wraps wrapping a
       code that does not, inside a pre told never to scroll, so the overflow
       escaped to the document: /docs/api pushed the page to 642px in a 390px
       viewport and /docs/changelog to 718px. Both halves now say the same
       thing. */
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
  }
  :global(.docs-content .code-copy) {
    position: absolute;
    top: 8px;
    right: 8px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    /* 21px tall, and it is the only way to take a command on a phone. */
    min-height: 24px;
    padding: 4px 9px;
    border-radius: var(--radius-md);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
  }
  :global(.docs-content pre:hover .code-copy),
  :global(.docs-content .code-copy:focus-visible) {
    opacity: 1;
  }
  :global(.docs-content .code-copy:hover) {
    color: var(--accent);
    border-color: var(--accent);
  }
  :global(.docs-content .code-copy.ok) {
    color: var(--green, #10b981);
    border-color: var(--green, #10b981);
    opacity: 1;
  }

  @media (max-width: 860px) {
    .doc-actions {
      display: none;
    }
    /* On touch there's no hover; keep the copy button visible. */
    :global(.docs-content .code-copy) {
      opacity: 0.85;
    }
  }
</style>
