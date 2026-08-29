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
  import { Footer } from "@glassmkr/ui";
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
    logo: "https://glassmkr.com/og/introducing-glassmkr.png?v=20260826",
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

<svg width="0" height="0" style="position:absolute"><filter id="noise"><feTurbulence baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></svg>
<div class="noise-overlay"></div>
<div class="ambient"></div>
<div class="glass-edges">
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
</div>

<header class="site-nav">
  <div class="container nav-inner">
    <div class="nav-left">
      <a href="/" class="nav-logo">
        <img src="/assets/logo.svg" alt="" width="24" height="24" />
        <span>GLASSMKR</span>
      </a>
      <div class="nav-links">
        <!-- Launch navigation per GLASSMKR_REDESIGN_FINAL_SPEC 13.1: no mega
             menu. Use-case and comparison routes stay indexed and reachable
             from the footer and in-page links. -->
        <a href="/docs" class="nav-link">Docs</a>
        <a href="/blog" class="nav-link" class:active={pathname.startsWith("/blog")}>Blog</a>
        <a href="/trust" class="nav-link" class:active={pathname === "/trust"}>Trust</a>
        <a href="/pricing" class="nav-link">Pricing</a>
        <!-- The demo is the fastest way to see the product without installing
             anything, and the launch post points at it by name. It was lost when
             the nav was simplified, surviving only in the footer. Plain nav-link
             rather than the old separate pill, to fit the simplified nav. -->
        <a href="https://app.glassmkr.com/demo" class="nav-link">Live demo</a>
        <a href="https://github.com/glassmkr/crucible" class="nav-link">GitHub</a>
      </div>
    </div>
    <div class="nav-right">
      {#if loggedIn}
        <a href="https://app.glassmkr.com" class="btn btn-primary btn-small">Dashboard</a>
        <a href="https://app.glassmkr.com/api/v1/auth/logout" class="nav-link nav-login">Log out</a>
      {:else}
        <a href="https://app.glassmkr.com/login" class="nav-link nav-login">Log in</a>
        <a href="/docs/self-hosting" class="btn btn-primary btn-small">Self-host</a>
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
    <a href="/docs" class="mobile-link" onclick={closeMobile}>Docs</a>
    <a href="/blog" class="mobile-link" onclick={closeMobile}>Blog</a>
    <a href="/trust" class="mobile-link" onclick={closeMobile}>Trust</a>
    <a href="/pricing" class="mobile-link" onclick={closeMobile}>Pricing</a>
    <a href="https://app.glassmkr.com/demo" class="mobile-link" onclick={closeMobile}>Live demo</a>
    <a href="https://github.com/glassmkr/crucible" class="mobile-link" onclick={closeMobile}>GitHub</a>
    <div class="mobile-divider"></div>
    {#if loggedIn}
      <a href="https://app.glassmkr.com" class="btn btn-primary mobile-cta" onclick={closeMobile}>Dashboard</a>
      <a href="https://app.glassmkr.com/api/v1/auth/logout" class="mobile-link" onclick={closeMobile}>Log out</a>
    {:else}
      <a href="https://app.glassmkr.com/login" class="mobile-link" onclick={closeMobile}>Log in</a>
      <a href="/docs/self-hosting" class="btn btn-primary mobile-cta" onclick={closeMobile}>Self-host</a>
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

<Footer>
  <div class="footer-content">
    <div class="footer-row">
      <p class="footer-left">Crucible, Dashboard, and backend under AGPL-3.0-only. &copy; 2026 Glassmkr.</p>
      <div class="footer-links">
        <a href="/docs">Docs</a>
        <a href="/blog">Blog</a>
        <a href="/vs">Compare</a>
        <a href="https://github.com/glassmkr">GitHub</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/billing-policy">Billing</a>
        <a href="/trust">Trust</a>
      </div>
    </div>
    <p class="footer-bottom">Hosted in Amsterdam.</p>
  </div>
</Footer>

<style>
  /* Nav */
  .site-nav {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 14px 0;
    background: rgba(8, 9, 12, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--surface-border);
  }
  .nav-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .nav-left {
    display: flex;
    align-items: center;
    gap: 32px;
  }
  .nav-logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.12em;
  }
  .nav-logo:hover {
    text-decoration: none;
  }
  /* Nav links grouped into a rounded pill. The demo used to sit outside
     this group in its own pill; it now lives inside as a plain link,
     because the simplified navigation has no separate CTA slot. */
  /* No pill container. A rounded, tinted, bordered capsule around the nav
     links is the most template-like detail on the page, and the references
     this design follows all use plain links. */
  .nav-links {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .nav-link {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition: color 0.15s;
  }
  .nav-link:hover, .nav-link.active {
    color: var(--text-primary);
    text-decoration: none;
  }

  /* "For" dropdown: hover-revealed on desktop. The trigger uses
     the same .nav-link styling so it sits naturally with the other
     nav items. The dropdown menu appears below the trigger with a
     small entrance animation and a slight upward offset so it
     visually connects to the trigger. */
  .nav-dropdown {
    position: relative;
    display: inline-block;
  }
  .nav-dropdown-trigger {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
  }
  .nav-dropdown-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }
  .nav-dropdown.active .nav-dropdown-trigger {
    color: var(--text-primary);
  }
  .nav-dropdown-trigger :global(.nav-dropdown-chevron) {
    opacity: 0.7;
    transition: transform 0.15s;
  }
  .nav-dropdown:hover .nav-dropdown-trigger :global(.nav-dropdown-chevron),
  .nav-dropdown:focus-within .nav-dropdown-trigger :global(.nav-dropdown-chevron) {
    transform: rotate(180deg);
  }
  .nav-dropdown-menu {
    position: absolute;
    top: calc(100% + 12px);
    left: -16px;
    min-width: 248px;
    background: rgba(13, 14, 16, 0.96);
    backdrop-filter: blur(16px);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 6px;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
    z-index: 200;
  }
  .nav-dropdown:hover .nav-dropdown-menu,
  .nav-dropdown:focus-within .nav-dropdown-menu {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
  .nav-dropdown-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 12px;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: color 0.12s, background 0.12s;
  }
  .nav-dropdown-item:hover {
    background: rgba(245, 166, 35, 0.08);
    text-decoration: none;
  }
  .nav-dropdown-item :global(.nav-dropdown-icon) {
    color: var(--text-tertiary);
    flex: none;
    transition: color 0.12s;
  }
  .nav-dropdown-item:hover :global(.nav-dropdown-icon) { color: var(--accent); }
  .nav-dropdown-text { display: flex; flex-direction: column; gap: 1px; }
  .nav-dropdown-label { font-size: 13.5px; color: var(--text-primary); }
  .nav-dropdown-item:hover .nav-dropdown-label { color: var(--accent); }
  .nav-dropdown-sub { font-size: 12px; color: var(--text-tertiary); line-height: 1.3; }

  .mobile-section-label {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--text-tertiary);
    margin: 0 0 4px;
    padding: 8px 16px 0;
  }
  .mobile-sublink {
    padding-left: 28px;
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  /* The global .btn-small class sets font-size:12px, which makes
     the Dashboard / Sign up button text smaller than the surrounding
     14px nav links. Match the nav font-size so the row reads as one
     consistent element. */
  .nav-right :global(.btn-small) {
    font-size: 14px;
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

  /* Mobile menu */
  .mobile-menu {
    position: fixed;
    top: 49px;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg);
    z-index: 99;
    display: flex;
    flex-direction: column;
    padding: 24px;
    gap: 4px;
  }
  .mobile-link {
    color: var(--text-primary);
    text-decoration: none;
    font-size: 18px;
    font-weight: 500;
    padding: 14px 0;
    border-bottom: 1px solid var(--surface-border);
  }
  .mobile-link:hover {
    text-decoration: none;
  }
  .mobile-divider {
    height: 1px;
    margin: 8px 0;
  }
  .mobile-cta {
    margin-top: 8px;
    text-align: center;
    justify-content: center;
    padding: 12px;
  }

  @media (max-width: 768px) {
    .nav-links {
      display: none;
    }
    .nav-right .nav-link,
    .nav-right .btn {
      display: none;
    }
    .nav-hamburger {
      display: flex;
    }
  }

  .noise-overlay {
    position: fixed;
    inset: 0;
    filter: url(#noise);
    opacity: 0.03;
    pointer-events: none;
    z-index: 9999;
    width: 100%;
    height: 100%;
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
    border-top: 1px solid var(--surface-border);
  }
  .cookie-notice p {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
    text-align: center;
  }
  .cookie-notice a {
    color: var(--accent);
    text-decoration: none;
  }
  .cookie-notice a:hover {
    text-decoration: underline;
  }

  /* Footer */
  .footer-content {
    width: 100%;
  }
  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  .footer-left {
    color: var(--text-tertiary);
    font-size: 13px;
    margin: 0;
  }
  .footer-links {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .footer-links a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 13px;
    /* 13px text gives a 21px box, under the 24px minimum for a standalone
       control. These are the site's only navigation on a phone once the header
       collapses, and they sit 16px apart in a wrapping row, so a near-miss hits
       the neighbour rather than nothing. Padding rather than a height keeps the
       row wrapping naturally; the negative margin keeps the visual gap the
       design intends, so nothing moves. */
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 3px 0;
    margin: -3px 0;
  }
  .footer-links a:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  .footer-bottom {
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
    margin: 16px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--surface-border);
    opacity: 0.7;
  }
  @media (max-width: 720px) {
    .footer-row { justify-content: center; text-align: center; }
    .footer-left { width: 100%; }
    .footer-links { justify-content: center; }
  }
</style>
