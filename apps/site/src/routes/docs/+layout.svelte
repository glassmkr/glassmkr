<script lang="ts">
  import "$lib/docs.css";
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // The docs shell (redesign spec 12.1): persistent left navigation, article
  // at a readable measure, on-page outline right. Every docs route renders
  // its <article class="docs-content"> inside this shell; the shared prose
  // styles live in $lib/docs.css, replacing the style block each route
  // duplicated.
  const NAV: { label: string; items: { href: string; label: string; child?: boolean }[] }[] = [
    {
      label: "START HERE",
      items: [
        { href: "/docs", label: "Docs home" },
        { href: "/docs/getting-started", label: "Getting started" },
        { href: "/docs/self-hosting", label: "Self-hosting" },
      ],
    },
    {
      label: "CONFIGURE",
      items: [
        { href: "/docs/configuration", label: "Configuration" },
        { href: "/docs/channels", label: "Notification channels" },
        { href: "/docs/rules", label: "Alert rules" },
      ],
    },
    {
      label: "API + AUTOMATION",
      items: [
        { href: "/docs/programmatic-api", label: "Programmatic API" },
        { href: "/docs/api", label: "API reference" },
        { href: "/docs/api/errors", label: "Error codes", child: true },
        { href: "/docs/automated-onboarding", label: "Automated onboarding" },
        { href: "/docs/mcp", label: "MCP" },
      ],
    },
    {
      label: "OPERATE",
      items: [
        { href: "/docs/troubleshooting", label: "Troubleshooting" },
        { href: "/docs/troubleshooting/ipmi", label: "IPMI", child: true },
        { href: "/docs/faq", label: "FAQ" },
        { href: "/docs/changelog", label: "Changelog" },
      ],
    },
  ];

  let pathname = $derived($page.url.pathname.replace(/\/$/, "") || "/docs");
  // Mobile: the nav collapses to a disclosure (spec 12.2).
  let navCollapsed = $state(true);

  // The static docs pages each have a generated /docs/<slug>.md twin
  // (scripts/docs-md.mjs, run at prebuild). The data-driven pages below do not,
  // so they get no actions. Keep in sync with STATIC_DOC_SLUGS: a static page
  // added there gets actions automatically; a new data-driven page must be
  // added to this exclude set.
  const NO_MARKDOWN = new Set(["/docs", "/docs/rules", "/docs/rules/[id]"]);
  let hasMarkdown = $derived($page.route.id != null && !NO_MARKDOWN.has($page.route.id));
  let mdHref = $derived($page.url.pathname.replace(/\/$/, "") + ".md");
  let copied = $state(false);

  // On-page outline (spec 12.1): generated from the article's section ids
  // after render. A navigation aid, not content, so building it client-side
  // loses nothing for a reader without script.
  let outline = $state<{ id: string; label: string }[]>([]);
  function buildOutline() {
    if (typeof document === "undefined") return;
    outline = [...document.querySelectorAll<HTMLElement>(".docs-content section[id]")]
      .map((s) => {
        const h = s.querySelector("h2");
        return h ? { id: s.id, label: h.textContent?.replace(/^#\s*/, "").trim() ?? s.id } : null;
      })
      .filter((x): x is { id: string; label: string } => !!x);
  }

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
          // homepage install block copy, so both behave identically.
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
  onMount(() => {
    enhanceCodeBlocks();
    buildOutline();
  });
  afterNavigate(() => {
    navCollapsed = true;
    tick().then(() => {
      enhanceCodeBlocks();
      buildOutline();
    });
  });
</script>

<div class="docs-shell">
  <nav class="docs-nav" aria-label="Documentation" data-collapsed={navCollapsed}>
    <button
      class="docs-nav-toggle"
      onclick={() => (navCollapsed = !navCollapsed)}
      aria-expanded={!navCollapsed}
    >
      DOCUMENTATION
      <span aria-hidden="true">{navCollapsed ? "+" : "−"}</span>
    </button>
    {#each NAV as group (group.label)}
      <div class="docs-nav-group">
        <p class="docs-nav-label">{group.label}</p>
        {#each group.items as item (item.href)}
          <a href={item.href} class:current={pathname === item.href} class:child={item.child}>
            {item.label}
          </a>
        {/each}
      </div>
    {/each}
  </nav>

  <div class="docs-article-col">
    {#if hasMarkdown}
      <div class="doc-actions">
        <button class="da-btn" onclick={copyForLlm} title="Copy this page as Markdown for an LLM">
          {copied ? "Copied" : "Copy for LLM"}
        </button>
        <a class="da-btn" href={mdHref} title="View this page as raw Markdown">View as Markdown</a>
      </div>
    {/if}
    {@render children()}
  </div>

  <nav class="docs-outline" aria-label="On this page">
    {#if outline.length > 1}
      <p class="docs-outline-label">ON THIS PAGE</p>
      {#each outline as o (o.id)}
        <a href="#{o.id}">{o.label}</a>
      {/each}
    {/if}
  </nav>
</div>

<style>
  /* Wrap long lines so code blocks never scroll horizontally; preserves
     indentation (pre-wrap) while breaking long URLs/flags. !important wins the
     specificity tie with any page's own scoped `pre` rule. */
  :global(.docs-content pre) {
    position: relative;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  :global(.docs-content pre .code-copy) {
    position: absolute;
    top: 8px;
    right: 8px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    background: var(--g-surface-2);
    border: 1px solid var(--g-border);
    border-radius: var(--g-radius-1);
    padding: 3px 9px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
  }
  :global(.docs-content pre:hover .code-copy),
  :global(.docs-content pre .code-copy:focus-visible) {
    opacity: 1;
  }
  :global(.docs-content pre .code-copy:hover) {
    color: var(--text-primary);
    border-color: var(--g-border-strong);
  }
  :global(.docs-content pre .code-copy.ok) {
    color: var(--g-healthy);
    border-color: var(--g-healthy);
    opacity: 1;
  }
</style>
