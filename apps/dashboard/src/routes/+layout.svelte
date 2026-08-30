<script lang="ts">
  import "@glassmkr/ui/base.css";
  // Self-hosted IBM Plex (OFL) via @fontsource, matching the marketing site,
  // per the 2026-08 design brief (two voices: Plex Sans for prose, Commit Mono
  // for machine-readable values).
  import "@fontsource/ibm-plex-sans/400.css";
  import "@fontsource/ibm-plex-sans/500.css";
  import "@fontsource/ibm-plex-sans/600.css";
  import "@fontsource/commit-mono/400.css";
  import "@fontsource/commit-mono/500.css";
  import Toaster from "$lib/components/Toaster.svelte";
  import BugReportButton from "$lib/components/BugReportButton.svelte";
  import DemoRibbon from "$lib/components/DemoRibbon.svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";

  let { children } = $props();
  let customer = $derived($page.data.customer);
  let pathname = $derived($page.url.pathname);

  // Sidebar open/close state (mobile only — on desktop the sidebar
  // is always visible).
  let sidebarOpen = $state(false);

  // Linear-style two-key keyboard shortcuts.
  // Press "g" then within 1s another key to navigate:
  //   g s → /              (Servers)
  //   g t → /trend-warnings
  //   g c → /channels
  //   g , → /settings      (macOS convention)
  //   g d → https://glassmkr.com/docs (opens in a new tab; Docs is
  //                                     hosted on the marketing site)
  // Plus single-key:
  //   ?     → toggle keyboard-shortcuts help modal
  //   Esc   → close help modal (or mobile sidebar overlay)
  let waitingForG = $state(false);
  let gTimer: ReturnType<typeof setTimeout> | undefined;
  let helpOpen = $state(false);

  function isActive(path: string): boolean {
    // "/" is the Servers section: keep it highlighted on the servers list AND
    // on a server detail page (/server/<slug>), which is a child of Servers.
    // The exact-match guard alone dropped the highlight on detail pages.
    if (path === "/") return pathname === "/" || pathname.startsWith("/server/");
    return pathname === path || pathname.startsWith(path + "/");
  }

  function closeSidebar() {
    sidebarOpen = false;
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Don't intercept when the user is typing in an input or any
    // editable element.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target.isContentEditable) return;
    }
    // Don't intercept when modifier keys are held (those are reserved
    // for browser/OS shortcuts).
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // ? toggles the keyboard-shortcuts help modal.
    // (`?` on US keyboards is typed as Shift+/; KeyboardEvent.key is just
    // "?". Shift is not in the modifier short-circuit above because it's
    // normal for capital letters, so this works without further gating.)
    if (e.key === "?" && customer) {
      e.preventDefault();
      helpOpen = !helpOpen;
      return;
    }

    // Escape closes (priority): help modal > mobile sidebar overlay.
    if (e.key === "Escape") {
      if (helpOpen) { helpOpen = false; return; }
      if (sidebarOpen) { sidebarOpen = false; return; }
    }

    if (waitingForG) {
      let path: string | null = null;
      switch (e.key.toLowerCase()) {
        case "s": path = "/"; break;
        case "c": path = "/channels"; break;
        case "t": path = "/trend-warnings"; break;
        case ",": path = "/settings"; break;
        case "d": path = "https://glassmkr.com/docs"; break;
      }
      waitingForG = false;
      if (gTimer) clearTimeout(gTimer);
      if (path !== null && customer) {
        e.preventDefault();
        sidebarOpen = false;
        // External docs URL opens in a new tab to match the sidebar
        // link's target=_blank behavior. Same-origin paths use goto()
        // for SPA navigation.
        if (path.startsWith("http")) {
          window.open(path, "_blank", "noopener");
        } else {
          goto(path);
        }
      }
      return;
    }

    if ((e.key === "g" || e.key === "G") && customer) {
      e.preventDefault();
      waitingForG = true;
      gTimer = setTimeout(() => {
        waitingForG = false;
      }, 1000);
    }
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      if (gTimer) clearTimeout(gTimer);
    };
  });
</script>

<Toaster />

<div class="ambient"></div>
<div class="glass-edges">
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
  <div class="glass-edge"></div>
</div>

{#if customer}
  <!-- Mobile top bar: visible only below 900px -->
  <div class="mobile-topbar">
    <button
      class="hamburger"
      onclick={toggleSidebar}
      aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
      aria-expanded={sidebarOpen}
      aria-controls="sidebar"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="3" y1="6" x2="17" y2="6" />
        <line x1="3" y1="10" x2="17" y2="10" />
        <line x1="3" y1="14" x2="17" y2="14" />
      </svg>
    </button>
    <a href="/" class="mobile-brand" onclick={closeSidebar}>
      <img src="/logo.svg?v=20260830" alt="" width="20" height="20" />
      <span>GLASSMKR</span>
    </a>
  </div>

  <!-- Mobile backdrop: only when sidebar open -->
  {#if sidebarOpen}
    <button
      class="sidebar-backdrop"
      onclick={closeSidebar}
      aria-label="Close navigation"
    ></button>
  {/if}

  <!-- Sidebar (sticky on desktop; overlay on mobile) -->
  <aside
    id="sidebar"
    class="sidebar"
    class:open={sidebarOpen}
    aria-label="Primary navigation"
  >
    <div class="sidebar-brand">
      <a href="/" class="brand-link" title="Dashboard home" onclick={closeSidebar}>
        <img src="/logo.svg?v=20260830" alt="" width="24" height="24" />
        <span>GLASSMKR</span>
      </a>
    </div>

    <nav class="sidebar-nav">
      <!-- Primary navigation: the three workflow pages an operator
           uses every session. Servers first (default landing),
           Trend Warnings second (the Pro feature with active state
           to inspect), Channels third (configured once then mostly
           static). -->
      <a
        href="/"
        onclick={closeSidebar}
        class:active={isActive("/")}
        aria-current={isActive("/") ? "page" : undefined}
      >Servers</a>
      <a
        href="/trend-warnings"
        onclick={closeSidebar}
        class:active={isActive("/trend-warnings")}
        aria-current={isActive("/trend-warnings") ? "page" : undefined}
      >Trend Warnings</a>
      <a
        href="/channels"
        onclick={closeSidebar}
        class:active={isActive("/channels")}
        aria-current={isActive("/channels") ? "page" : undefined}
      >Channels</a>

      <!-- Secondary group, visually separated and pushed to the
           bottom (sidebar-nav-secondary uses margin-top:auto to
           hug the sidebar-account block). Settings + Docs sit
           here because they're "configure once" / "look something
           up" pages, not the daily workflow. Docs opens in a new
           tab because it lives on glassmkr.com (separate origin). -->
      <div class="sidebar-nav-secondary">
        <a
          href="/settings"
          onclick={closeSidebar}
          class:active={isActive("/settings")}
          aria-current={isActive("/settings") ? "page" : undefined}
        >Settings</a>
        <a
          href="https://glassmkr.com/docs"
          target="_blank"
          rel="noopener"
          onclick={closeSidebar}
        >Docs ↗</a>
        <!-- Report a problem lives here rather than in a floating button. As a
             fixed circle in the bottom-right corner it sat on top of whatever
             had scrolled under it: the alert tabs on a server page, the rows of
             the audit table, the trend-warning list. A control that covers the
             data is worse than one that takes a click to reach. -->
        <BugReportButton customerEmail={customer?.email ?? ""} inline onopen={closeSidebar} />
      </div>
    </nav>

    <div class="sidebar-account">
      <p class="account-email" title={customer.email}>{customer.email}</p>
      <a href="/api/v1/auth/logout" class="account-logout">Log out</a>
    </div>
  </aside>

  <!-- Keyboard-shortcuts help modal. Toggled by `?` key (handled in
       handleKeydown). Esc closes (Esc-priority: help > sidebar). Click
       overlay closes. Inline mini-modal that follows the dashboard's
       existing modal pattern (see packages/ui/src/lib/components/
       ConfirmModal.svelte) — kept inline because it's a single-purpose
       static surface, not worth a reusable component yet. -->
  {#if helpOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="kbd-overlay" role="presentation" onclick={() => (helpOpen = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="kbd-modal"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
      >
        <h3>Keyboard shortcuts</h3>
        <ul class="kbd-list">
          <li><span class="combo"><kbd>g</kbd> <kbd>s</kbd></span><span class="label">Servers</span></li>
          <li><span class="combo"><kbd>g</kbd> <kbd>t</kbd></span><span class="label">Trend Warnings</span></li>
          <li><span class="combo"><kbd>g</kbd> <kbd>c</kbd></span><span class="label">Channels</span></li>
          <li><span class="combo"><kbd>g</kbd> <kbd>,</kbd></span><span class="label">Settings</span></li>
          <li><span class="combo"><kbd>g</kbd> <kbd>d</kbd></span><span class="label">Docs (new tab)</span></li>
          <li><span class="combo"><kbd>?</kbd></span><span class="label">Toggle this help</span></li>
          <li><span class="combo"><kbd>Esc</kbd></span><span class="label">Close this help / mobile menu</span></li>
        </ul>
        <p class="hint">Disabled while typing in form fields.</p>
      </div>
    </div>
  {/if}

  <div class="layout">
    <main class="main" style="position:relative; z-index:1;">
      {#if customer?.isDemo}<DemoRibbon />{/if}
      {@render children()}
    </main>
    <footer class="footer">
      <div class="container text-center">
        <p>&copy; {new Date().getFullYear()} Glassmkr</p>
      </div>
    </footer>
  </div>
{:else}
  <!-- Logged-out (login / register / unauthenticated docs visits):
       fall back to the horizontal top nav so login/register pages
       render full-width without the sidebar real-estate eating into
       form layouts. -->
  <nav class="nav">
    <div class="nav-inner container">
      <div class="nav-left-group">
        <span class="nav-logo">
          <img src="/logo.svg?v=20260830" alt="" width="24" height="24" />
          <span>GLASSMKR</span>
        </span>
      </div>
      <div class="nav-links">
        <a href="https://glassmkr.com/docs" target="_blank" rel="noopener">Docs ↗</a>
        <a href="/login" class="nav-login">Log in</a>
        <a href="/register" class="btn btn-primary btn-small">Sign up</a>
      </div>
    </div>
  </nav>

  <main class="main" style="position:relative; z-index:1;">
    {@render children()}
  </main>

  <footer class="footer">
    <div class="container text-center">
      <p>&copy; {new Date().getFullYear()} Glassmkr</p>
    </div>
  </footer>
{/if}

<style>
  /* ===== Sidebar (logged-in, desktop) ===== */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 220px;
    z-index: 100;
    background: #0c0d10;
    border-right: 1px solid var(--surface-border);
    padding: 24px 0 20px;
    display: flex;
    flex-direction: column;
  }
  .sidebar-brand {
    padding: 0 20px 24px;
  }
  .brand-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .brand-link:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  .sidebar-nav {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 12px;
  }
  .sidebar-nav a {
    display: block;
    padding: 8px 12px 8px 14px;
    font-size: 14px;
    color: var(--text-secondary);
    text-decoration: none;
    border-left: 2px solid transparent;
    border-radius: 0 4px 4px 0;
    /* Interaction must not make navigation drift (spec 17.1): color and
       surface only, no hover translation. */
    transition: color 150ms ease, background 150ms ease;
  }
  .sidebar-nav a:hover {
    color: var(--text-primary);
    background: var(--g-hover-surface);
    text-decoration: none;
  }
  .sidebar-nav a.active {
    color: var(--text-primary);
    font-weight: 600;
    border-left-color: var(--g-brand);
    background: var(--g-surface-2);
  }
  /* Secondary nav group: Settings + Docs. Pushed to the bottom of
     the scrollable nav so it sits next to the account/log-out block.
     A faint top rule visually separates it from the primary trio.
     Symmetric vertical padding (12px top, 12px bottom) so the last
     item (Docs) doesn't sit flush against the divider below it. */
  .sidebar-nav-secondary {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 12px;
    padding-bottom: 12px;
    border-top: 1px solid var(--surface-border);
  }
  .sidebar-account {
    padding: 16px 20px 0;
    border-top: 1px solid var(--surface-border);
  }
  .account-email {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account-logout {
    display: inline-block;
    font-size: 13px;
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 150ms ease;
  }
  .account-logout:hover {
    color: var(--text-primary);
    text-decoration: none;
  }

  /* ===== Layout: main content offset by sidebar width ===== */
  .layout {
    margin-left: 220px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  /* Consistent app shell (spec 17.1): the shared .container is 960px for
     marketing reading; the app's data surfaces get a 1400px ceiling with
     24-32px gutters. :global because routes own the class. */
  .main :global(.container) {
    max-width: 1400px;
    padding-left: clamp(24px, 2.5vw, 32px);
    padding-right: clamp(24px, 2.5vw, 32px);
  }
  .layout .main {
    flex: 1;
    padding: 32px 0;
  }

  /* ===== Mobile (< 900px): sidebar becomes overlay ===== */
  .mobile-topbar {
    display: none;
  }
  .hamburger {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 150ms ease, background 150ms ease;
  }
  .hamburger:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.04);
  }
  /* 22px tall: the home link in the mobile top bar, and the only way back to
     the fleet from a detail page on a phone. */
  .mobile-brand {
    min-height: 24px;
    display: inline-flex;
    align-items: center;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .mobile-brand:hover {
    text-decoration: none;
  }
  .sidebar-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 95;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    border: none;
    cursor: pointer;
  }

  @media (max-width: 900px) {
    .sidebar {
      transform: translateX(-100%);
      /* Translating a panel off-screen hides it from eyes but not from a
         screen reader: the closed drawer stayed fully in the accessibility
         tree, so its brand link read as a second GLASSMKR link on every
         mobile page and its nav announced alongside the page content. The
         visibility flip removes it from the tree; the 200ms delay on the way
         out keeps the slide-out animation visible instead of blinking away. */
      visibility: hidden;
      transition:
        transform 200ms ease,
        visibility 0s linear 200ms;
    }
    .sidebar.open {
      transform: translateX(0);
      visibility: visible;
      transition:
        transform 200ms ease,
        visibility 0s;
    }
    .layout {
      margin-left: 0;
    }
    .mobile-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      position: sticky;
      top: 0;
      z-index: 90;
      background: rgba(8, 9, 12, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--surface-border);
    }
    .sidebar-backdrop {
      display: block;
    }
  }

  /* ===== Logged-out fallback: horizontal top nav ===== */
  .nav {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 14px 0;
    border-bottom: 1px solid var(--surface-border);
    background: rgba(8, 9, 12, 0.85);
    backdrop-filter: blur(12px);
  }
  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .nav-left-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nav-logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .nav-logo:hover {
    text-decoration: none;
  }
  .nav-links {
    display: flex;
    gap: 24px;
    align-items: center;
  }
  .nav-links a {
    font-size: 14px;
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.15s;
  }
  .nav-links a:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  .nav-links a:global(.btn-primary) {
    color: var(--accent);
  }
  .nav-links a:global(.btn-primary):hover {
    color: #0B0C0E;
  }
  .nav-links a:global(.btn-small) {
    font-size: 14px;
  }
  .nav-links :global(.nav-login) {
    color: var(--accent);
    font-weight: 500;
  }

  /* ===== Shared: main + footer ===== */
  .main {
    min-height: calc(100vh - 120px);
    padding: 32px 0;
  }
  .footer {
    position: relative;
    z-index: 1;
    padding: 24px 0;
    border-top: 1px solid var(--surface-border);
  }
  .footer p {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  /* ===== Keyboard-shortcuts help modal ===== */
  .kbd-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .kbd-modal {
    background: var(--bg);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 24px;
    max-width: 380px;
    width: 90%;
  }
  .kbd-modal h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 16px;
    color: var(--text-primary);
  }
  .kbd-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .kbd-list li {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
  }
  .kbd-list .combo {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }
  .kbd-list .label {
    color: var(--text-secondary);
  }
  .kbd-list kbd {
    display: inline-block;
    min-width: 22px;
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    text-align: center;
    line-height: 1.4;
  }
  .kbd-modal .hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 16px 0 0;
  }
</style>
