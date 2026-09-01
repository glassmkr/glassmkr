<script lang="ts">
  import "@glassmkr/ui/base.css";
  import "$lib/theme.css";
  // Self-hosted IBM Plex (OFL) via @fontsource; two typographic voices per
  // the 2026-08 design brief: Plex Sans for prose/navigation, Commit Mono for
  // machine-readable technical information (commands, metrics, identifiers).
  // Source Serif 4 is NOT loaded here: it is editorial-only and loads on the
  // blog routes that use it (final spec 9.5, two font preloads max).
  import "@fontsource/ibm-plex-sans/400.css";
  import "@fontsource/ibm-plex-sans/500.css";
  import "@fontsource/ibm-plex-sans/600.css";
  import "@fontsource/commit-mono/400.css";
  import "@fontsource/commit-mono/500.css";
  import { page } from "$app/stores";
  import { afterNavigate } from "$app/navigation";
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
  let mobileOpen = $state(false);
  let pathname = $derived($page.url.pathname);
  let cookieDismissed = $state(false);

  $effect(() => {
    if (typeof window !== "undefined") {
      cookieDismissed = localStorage.getItem("cookie_ok") === "1";
    }
  });

  function dismissCookie() {
    cookieDismissed = true;
    localStorage.setItem("cookie_ok", "1");
  }
  let loggedIn = $derived($page.data.loggedIn ?? false);

  function toggleMobile() {
    mobileOpen = !mobileOpen;
  }

  function closeMobile() {
    mobileOpen = false;
  }

  afterNavigate(() => {
    mobileOpen = false;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && mobileOpen) {
      mobileOpen = false;
    }
  }
</script>

<svelte:head>
  <!-- Sitewide structured data: Organization + WebSite identity. Per-page
       Article/BlogPosting/TechArticle JSON-LD is emitted by each route. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Glassmkr",
    url: "https://glassmkr.com",
    logo: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260830",
    sameAs: ["https://github.com/glassmkr", "https://www.npmjs.com/package/@glassmkr/crucible"],
  }).replace(/</g, "\\u003c")}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Glassmkr",
    url: "https://glassmkr.com",
  }).replace(/</g, "\\u003c")}</` + `script>`}
  <!-- Markdown twin of this page (served by hooks.server.ts), so agents can
       fetch clean Markdown by following this link or appending .md to the URL. -->
  <link
    rel="alternate"
    type="text/markdown"
    href={$page.url.pathname === "/"
      ? "/index.md"
      : $page.url.pathname.replace(/\/$/, "") + ".md"}
  />
  <!-- The two relations an agent uses to find the machine surfaces without
       being told they exist. `describedby` points at the LLM index, which is
       the short authoritative snapshot rather than the 145KB corpus;
       `service-desc` is the registered relation for a service description, so
       a client that wants the API contract can follow it from any page instead
       of knowing the path in advance. Both were absent: the site published
       both files and advertised neither. -->
  <link rel="describedby" type="text/plain" href="https://glassmkr.com/llms.txt" />
  <link
    rel="service-desc"
    type="application/vnd.oai.openapi+json"
    href="https://app.glassmkr.com/api/openapi.json"
  />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<!-- Global decoration removed per redesign spec 9.2: no glass edges, no
     noise overlay, no global ambient field. The one allowed warm ambient
     lives inside the homepage hero, mounted by that page. -->

<header class="site-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="/assets/logo.svg?v=20260830" alt="" width="24" height="24" />
      <span>GLASSMKR</span>
    </a>
    <nav class="nav-links" aria-label="Primary">
      <a href="/#how-it-works" class="nav-link">How it works</a>
      <a href="/docs" class="nav-link" class:active={pathname.startsWith("/docs")}>Docs</a>
      <a href="/blog" class="nav-link" class:active={pathname.startsWith("/blog")}>Blog</a>
      <a href="/vs" class="nav-link" class:active={pathname.startsWith("/vs")}>Compare</a>
      <a href="/trust" class="nav-link" class:active={pathname === "/trust"}>Trust</a>
      <a href="/pricing" class="nav-link" class:active={pathname === "/pricing"}>Pricing</a>
      <a href="https://app.glassmkr.com/demo" class="nav-link">Live demo</a>
    </nav>
    <div class="nav-right">
      {#if loggedIn}
        <a href="https://app.glassmkr.com/logout" class="nav-link nav-login">Log out</a>
        <a href="https://app.glassmkr.com" class="btn btn-primary">Dashboard</a>
      {:else}
        <a href="https://app.glassmkr.com/login" class="nav-link nav-login">Log in</a>
        <a href="https://app.glassmkr.com/register" class="btn btn-primary">Monitor a server</a>
      {/if}
      <button
        class="nav-hamburger"
        class:open={mobileOpen}
        onclick={toggleMobile}
        aria-label="Menu"
      >
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
    </div>
  </div>
</header>

{#if mobileOpen}
  <div class="mobile-menu">
    <a href="/#how-it-works" class="mobile-link" onclick={closeMobile}>How it works</a>
    <a href="/docs" class="mobile-link" onclick={closeMobile}>Docs</a>
    <a href="/blog" class="mobile-link" onclick={closeMobile}>Blog</a>
    <a href="/vs" class="mobile-link" onclick={closeMobile}>Compare</a>
    <a href="/trust" class="mobile-link" onclick={closeMobile}>Trust</a>
    <a href="/pricing" class="mobile-link" onclick={closeMobile}>Pricing</a>
    <a href="https://app.glassmkr.com/demo" class="mobile-link" onclick={closeMobile}>Live demo</a>
    <a href="https://github.com/glassmkr/glassmkr" class="mobile-link" onclick={closeMobile}>GitHub</a>
    <div class="mobile-divider"></div>
    {#if loggedIn}
      <a href="https://app.glassmkr.com" class="btn btn-primary mobile-cta" onclick={closeMobile}>Dashboard</a>
      <a href="https://app.glassmkr.com/logout" class="mobile-link" onclick={closeMobile}>Log out</a>
    {:else}
      <a href="https://app.glassmkr.com/login" class="mobile-link" onclick={closeMobile}>Log in</a>
      <a href="https://app.glassmkr.com/register" class="btn btn-primary mobile-cta" onclick={closeMobile}>Monitor a server</a>
    {/if}
  </div>
{/if}

<main>
  {@render children()}
</main>

<!-- A disclosure, not a consent gate. There is one strictly necessary
     authentication cookie and nothing to opt out of, so this sat as a fixed
     bar covering the bottom of every page for a notice that asks nothing of
     the reader. In flow above the footer it says the same thing without
     standing on the content. -->
{#if !cookieDismissed}
  <div class="cookie-notice">
    <p>We use a single authentication cookie. No tracking, no analytics. <a href="/privacy">Privacy policy</a></p>
    <button class="btn btn-small" onclick={dismissCookie}>Got it</button>
  </div>
{/if}

<!-- Footer on the wide grid (spec 9.3): identity left, product and docs
     links middle, source/legal right, license line across the bottom. -->
<footer class="site-footer">
  <div class="footer-grid">
    <div class="footer-identity">
      <a href="/" class="footer-mark">
        <img src="/assets/logo.svg?v=20260830" alt="" width="20" height="20" />
        <span>GLASSMKR</span>
      </a>
      <p class="footer-desc">
        Open-source Linux server monitoring that explains what needs attention
        and gives you the next command to run.
      </p>
      <p class="footer-oss">Open source, hosted or self-hosted.</p>
    </div>
    <nav class="footer-col" aria-label="Product">
      <p class="footer-col-label">PRODUCT</p>
      <a href="https://app.glassmkr.com/demo">Live demo</a>
      <a href="/pricing">Pricing</a>
      <a href="/for-storage">Storage servers</a>
      <a href="/for-compute">Bare-metal compute</a>
      <a href="/for-gpu">GPU and ML</a>
      <a href="/for-providers">Hosting providers</a>
      <a href="/vs">Compare</a>
    </nav>
    <nav class="footer-col" aria-label="Documentation">
      <p class="footer-col-label">DOCS</p>
      <a href="/docs">Documentation</a>
      <a href="/docs/getting-started">Getting started</a>
      <a href="/docs/self-hosting">Self-hosting</a>
      <a href="/docs/rules">Alert rules</a>
      <a href="/blog">Blog</a>
      <a href="/about">About</a>
    </nav>
    <nav class="footer-col" aria-label="Source and legal">
      <p class="footer-col-label">SOURCE</p>
      <a href="https://github.com/glassmkr/glassmkr">GitHub</a>
      <a href="https://status.glassmkr.com">Status</a>
      <a href="/trust">Trust</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/billing-policy">Billing</a>
    </nav>
  </div>
  <div class="footer-bottom">
    <p>Crucible, Dashboard, and backend under AGPL-3.0-only. &copy; 2026 Glassmkr.</p>
    <p class="footer-host">Hosted in Amsterdam.</p>
  </div>
</footer>

<style>
  /* Nav (spec 9.1): 64px, flat full-width header, one bottom hairline, logo
     on the wide grid's left edge, one solid brand action. */
  .site-nav {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(7, 7, 6, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .nav-inner {
    width: min(100%, var(--page-max));
    margin-inline: auto;
    padding-inline: var(--page-gutter);
    height: 64px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .nav-logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.12em;
    flex: none;
  }
  .nav-logo:hover {
    text-decoration: none;
  }
  .nav-links {
    display: flex;
    align-items: center;
    gap: 26px;
    min-width: 0;
  }
  .nav-link {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    transition: color 0.15s;
    position: relative;
  }
  .nav-link:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  /* Current page: text plus a small brand indicator, not a filled background. */
  .nav-link.active {
    color: var(--text-primary);
  }
  .nav-link.active::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -6px;
    height: 2px;
    background: var(--g-brand);
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: 18px;
    flex: none;
  }
  .nav-login {
    color: var(--text-tertiary);
  }
  /* Hamburger */
  .nav-hamburger {
    display: none;
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    flex-direction: column;
    gap: 5px;
  }
  .hamburger-line {
    display: block;
    width: 20px;
    height: 2px;
    background: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: transform 0.2s, opacity 0.2s;
  }
  .nav-hamburger.open .hamburger-line:nth-child(1) {
    transform: rotate(45deg) translate(5px, 5px);
  }
  .nav-hamburger.open .hamburger-line:nth-child(2) {
    opacity: 0;
  }
  .nav-hamburger.open .hamburger-line:nth-child(3) {
    transform: rotate(-45deg) translate(5px, -5px);
  }

  /* Mobile menu: attached full-width panel below the header; every link a
     44px touch target (spec 9.1). */
  .mobile-menu {
    position: fixed;
    top: 64px;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--g-bg);
    z-index: 99;
    display: flex;
    flex-direction: column;
    padding: 16px 20px 24px;
    gap: 0;
    overflow-y: auto;
  }
  .mobile-link {
    color: var(--text-primary);
    text-decoration: none;
    font-size: 17px;
    font-weight: 500;
    min-height: 44px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .mobile-link:hover {
    text-decoration: none;
  }
  .mobile-divider {
    height: 12px;
  }
  .mobile-cta {
    margin-top: 8px;
    text-align: center;
    justify-content: center;
    padding: 12px;
    min-height: 44px;
  }

  @media (max-width: 900px) {
    .nav-links {
      display: none;
    }
    .nav-right .nav-link,
    .nav-right :global(.btn) {
      display: none;
    }
    .nav-hamburger {
      display: flex;
    }
  }

  main {
    position: relative;
    z-index: 1;
  }

  .cookie-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px 16px;
    padding: 14px 24px;
    border-top: 1px solid var(--g-border-subtle);
  }
  .cookie-notice p {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
    text-align: center;
  }
  .cookie-notice a {
    color: var(--g-brand);
    text-decoration: none;
  }
  .cookie-notice a:hover {
    text-decoration: underline;
  }

  /* Footer (spec 9.3): wide grid, identity + three link columns, one
     brand rule as the molten-signal termination. */
  .site-footer {
    border-top: 1px solid var(--g-border-subtle);
    margin-top: 48px;
    position: relative;
  }
  .site-footer::before {
    content: "";
    position: absolute;
    top: -1px;
    left: var(--page-gutter);
    width: 72px;
    height: 2px;
    background: var(--g-brand);
  }
  .footer-grid {
    width: min(100%, var(--page-max));
    margin-inline: auto;
    padding: 48px var(--page-gutter) 32px;
    display: grid;
    grid-template-columns: minmax(220px, 1.6fr) repeat(3, minmax(140px, 1fr));
    gap: 32px;
  }
  .footer-mark {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.12em;
  }
  .footer-mark:hover { text-decoration: none; }
  .footer-desc {
    margin: 14px 0 6px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 34ch;
  }
  .footer-oss {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    letter-spacing: 0.03em;
  }
  .footer-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .footer-col-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    color: var(--text-tertiary);
    margin: 0 0 8px;
  }
  .footer-col a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    width: fit-content;
  }
  .footer-col a:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  .footer-bottom {
    width: min(100%, var(--page-max));
    margin-inline: auto;
    padding: 14px var(--page-gutter) 20px;
    border-top: 1px solid var(--g-border-subtle);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .footer-bottom p {
    color: var(--text-tertiary);
    font-size: 12.5px;
    margin: 0;
  }
  @media (max-width: 860px) {
    .footer-grid {
      grid-template-columns: 1fr 1fr;
    }
    .footer-identity {
      grid-column: 1 / -1;
    }
  }
  @media (max-width: 480px) {
    .footer-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
