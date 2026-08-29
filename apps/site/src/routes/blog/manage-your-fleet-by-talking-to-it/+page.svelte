<svelte:head>
  <title>Manage your fleet by talking to it - Glassmkr Blog</title>
  <meta name="description" content="Glassmkr now speaks the Model Context Protocol. A compatible AI client connects to your fleet with a browser sign-in and can query it, and with the scopes you grant, manage it: acknowledge alerts, enroll servers, rotate keys. The interesting part was making destructive tools safe for an LLM to hold." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/manage-your-fleet-by-talking-to-it" />
  <meta property="og:title" content="Manage your fleet by talking to it" />
  <meta property="og:description" content="Glassmkr over MCP: connect an AI client with a browser sign-in, query your fleet, and (with consent) manage it. Plus how we made an LLM-invokable delete safe." />
  <meta property="og:image" content="https://glassmkr.com/og/manage-your-fleet-by-talking-to-it.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Manage your fleet by talking to it" />
  <meta name="twitter:description" content="Glassmkr over MCP: connect an AI client with a browser sign-in, query your fleet, and (with consent) manage it. Plus how we made an LLM-invokable delete safe." />
  <meta name="twitter:image" content="https://glassmkr.com/og/manage-your-fleet-by-talking-to-it.png?v=20260826" />
  <link rel="canonical" href="https://glassmkr.com/blog/manage-your-fleet-by-talking-to-it" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Manage your fleet by talking to it",
    description: "Glassmkr now speaks the Model Context Protocol: an AI client connects with a browser sign-in and can query your fleet and, with the scopes you grant, manage it. Plus the design that makes an LLM-invokable delete safe.",
    image: "https://glassmkr.com/og/manage-your-fleet-by-talking-to-it.png?v=20260826",
    datePublished: "2026-07-21",
    dateModified: "2026-07-21",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/manage-your-fleet-by-talking-to-it.png?v=20260826" } },
    mainEntityOfPage: "https://glassmkr.com/blog/manage-your-fleet-by-talking-to-it",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Manage your fleet by talking to it", item: "https://glassmkr.com/blog/manage-your-fleet-by-talking-to-it" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">July 2026 · Engineering · 5 min read</p>
      <h1>Manage your fleet by talking to it.</h1>
      <p class="lede">
        Glassmkr now speaks the Model Context Protocol. A compatible AI client connects to your fleet with a browser sign-in, no key to paste, and can query it, and with the scopes you grant, act on it. The capability is the easy part. The interesting part was making a delete safe to hand an LLM.
      </p>
    </header>

    <h2>What it is</h2>

    <p>
      MCP is an open protocol for connecting AI clients to external tools and data. We added an MCP server to the Glassmkr dashboard, served over streamable HTTP at <code>https://app.glassmkr.com/mcp</code>. Point a compatible client at that URL, complete a browser sign-in, and it can work with your account through a small, deliberate set of tools. There is nothing to install on your servers beyond the <a href="/docs/getting-started">Crucible agent</a> you already run.
    </p>

    <p>
      Authorization is per-user OAuth 2.1 (authorization code with PKCE). You never paste a Glassmkr password or key into the client; you approve it on a consent screen, and you revoke it from <strong>Settings, MCP connections</strong> at any time. A revoke, or a password reset, cuts off existing tokens immediately.
    </p>

    <h2>Three scopes, granted separately</h2>

    <p>
      Access is tiered, and a client only ever has what you approved on the consent screen:
    </p>

    <ul>
      <li><strong>Read</strong> lists your servers, reads a server's latest health snapshot and active alerts, pulls bounded resource-usage history, and reads the fleet summary. This is the tier for "triage my fleet" and "explain this alert."</li>
      <li><strong>Write</strong> acknowledges alerts, and resolves the forensic alert types that do not auto-clear (most alerts auto-resolve when their condition clears; those are acknowledged, not resolved). Reversible.</li>
      <li><strong>Administrative</strong> enrolls a server, rotates a collector key, or moves a server to trash.</li>
    </ul>

    <p>
      Read went live first, on its own, precisely because it cannot change anything: a compromised or confused client with a read token can look but not touch. Write and admin are separate opt-ins on top. All three are generally available today; you pick which to grant on the consent screen.
    </p>

    <h2>Making a destructive tool safe for an LLM</h2>

    <p>
      Here is the honest problem. A language model is a probabilistic thing, and we were about to give one a tool named <code>glassmkr.admin.delete_server</code>. And "the client asks for confirmation" cannot be the whole answer, because the model is the one driving the client. So the safety is a stack of independent controls, and the real human-in-the-loop is your client's own approval prompt, not anything the model types:
    </p>

    <ul>
      <li><strong>A scope you granted.</strong> Admin tools require the <code>glassmkr:admin</code> scope, which you approved by name on the consent screen. A read or write connection cannot reach them at all.</li>
      <li><strong>A signed, two-step token.</strong> A destructive action is never a single call. The client first calls <code>glassmkr.admin.prepare</code>, which returns a short-lived token bound to that exact account, action, and target; the action requires the token back and the target's name echoed. The model supplies both, so this is not itself a human check: it forces a deliberate two step and binds the action to one specific server, so a stray or prompt-injected single call cannot act on the wrong one.</li>
      <li><strong>Your client's approval prompt.</strong> This is the actual human gate: a person approves the tool call in the client before it runs. The controls above make that approval specific and hard to fumble; they do not replace it.</li>
      <li><strong>Delete does not destroy.</strong> A delete over MCP is a soft delete: the server moves to trash and is restorable from the dashboard, not wiped. The truly irreversible path stays in the dashboard, behind a human.</li>
      <li><strong>Telemetry is untrusted input.</strong> Hostnames, alert text, and other host-derived strings come from monitored machines, so every tool result labels those fields as untrusted and instructs the client never to follow instructions found in them. A box cannot talk your assistant into doing something through its own hostname.</li>
      <li><strong>Everything is bounded and logged.</strong> Mutations respect the same per-action rate limits as our REST API, tenant isolation is enforced on every call, and every tool call lands in your <a href="/docs/programmatic-api#audit">audit log</a>.</li>
    </ul>

    <p>
      None of these is novel on its own. Stacked, they turn "an AI can delete your server" into "an AI can move a server to trash, only with a scope you granted, only behind your client's approval prompt, only via a signed two-step bound to that one server, and only in a way you can undo and audit." That is a boundary we are comfortable shipping.
    </p>

    <h2>How to connect</h2>

    <p>
      Add <code>https://app.glassmkr.com/mcp</code> as an MCP server in your client. It will send you to Glassmkr to sign in and review exactly which scopes it is asking for; approve, and the connection appears under Settings with a revoke button. The client discovers the OAuth endpoints automatically from the standard metadata documents, so there is no manual configuration beyond the URL.
    </p>

    <p>
      The full tool catalog, the trust boundary, and the confirmation flow are documented in the <a href="/docs/mcp">MCP server guide</a>. If you want the same operations from a script instead of a conversation, the <a href="/docs/programmatic-api">programmatic API</a> covers the same ground.
    </p>

    <footer class="post-footer">
      <p>Glassmkr is in-OS hardware-health monitoring for bare metal: a lightweight agent, a curated bare-metal alert rule catalog, and alerts routed where your team already works.</p>
    </footer>
  </article>
</div>

<style>
  .post {
    padding: 56px 0 80px;
  }
  .post-header {
    margin-bottom: 40px;
  }
  .post-meta {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 18px;
  }
  .post h1 {
    font-size: clamp(30px, 4.6vw, 44px);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 0 0 20px;
  }
  .lede {
    font-size: clamp(16px, 1.8vw, 19px);
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .post h2 {
    font-size: clamp(22px, 2.4vw, 26px);
    font-weight: 600;
    color: var(--text-primary);
    margin: 44px 0 18px;
    letter-spacing: -0.005em;
  }
  .post p {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 18px;
  }
  .post ul {
    margin: 0 0 18px;
    padding-left: 22px;
  }
  .post li {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 10px;
  }
  .post a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .post a:hover {
    border-bottom-color: var(--accent);
  }
  .post code {
    font-family: var(--font-mono, monospace);
    font-size: 14px;
    background: var(--surface-subtle);
    padding: 2px 6px;
    border-radius: var(--radius-md);
    color: var(--text-primary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .post-footer {
    margin-top: 56px;
    padding-top: 28px;
    border-top: 1px solid var(--surface-border);
    font-size: 13.5px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }
  .post-footer p { font-size: 13.5px; line-height: 1.7; margin: 0 0 8px; }
</style>
