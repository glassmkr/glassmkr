<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "MCP server", item: "https://glassmkr.com/docs/mcp" },
    ],
  });
</script>

<svelte:head>
  <title>MCP server: connect an AI client to your fleet: Glassmkr documentation</title>
  <meta name="description" content="Glassmkr exposes a Model Context Protocol (MCP) server so a compatible AI client can query your fleet and, with your consent, manage it: acknowledge and resolve alerts, enroll or rotate servers. Per-user OAuth, authorized from your dashboard." />
  <link rel="canonical" href="https://glassmkr.com/docs/mcp" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/mcp" />
  <meta property="og:title" content="Glassmkr MCP server" />
  <meta property="og:description" content="MCP access to your fleet for compatible AI clients: query it, and with consent manage it. Authorized through your browser." />
  <meta property="og:image" content="https://glassmkr.com/og/mcp.png?v=20260826" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr MCP server" />
  <meta name="twitter:description" content="MCP access to your fleet for compatible AI clients: query it, and with consent manage it. Authorized through your browser." />
  <meta name="twitter:image" content="https://glassmkr.com/og/mcp.png?v=20260826" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs" class="sidebar-section">&larr; Back to docs</a>
      <a href="#what" class="sidebar-link">What it is</a>
      <a href="#connect" class="sidebar-link">Connect a client</a>
      <a href="#tools" class="sidebar-link">What it exposes</a>
      <a href="#confirm" class="sidebar-link">Changing things safely</a>
      <a href="#trust" class="sidebar-link">Trust boundary</a>
      <a href="#security" class="sidebar-link">Security</a>
      <a href="#endpoint" class="sidebar-link">Endpoint</a>
      <a href="#troubleshooting" class="sidebar-link">Troubleshooting</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / MCP SERVER</p>
      <h1>MCP server</h1>
      <p class="docs-subtitle">Glassmkr runs a Model Context Protocol (MCP) server, so a compatible AI client can look at your fleet and, when you grant it, act on it. Access is per-user, authorized through your browser from the dashboard, tiered into read, write, and administrative scopes, and revocable at any time. For scripted automation without an AI client, use the <a href="/docs/programmatic-api">programmatic API</a>.</p>
    </header>

    <section id="what">
      <h2><a href="#what" class="anchor-link">#</a>What it is</h2>
      <p>MCP is an open protocol for connecting AI clients to external tools and data. The Glassmkr MCP server lets a client you trust (for example, a desktop AI assistant) work with your account at the level you authorize:</p>
      <ul>
        <li><strong>Read</strong> (<code>glassmkr:read</code>): list servers, read a server's latest health snapshot and active alerts, pull bounded resource-usage history, and read the fleet summary.</li>
        <li><strong>Write</strong> (<code>glassmkr:write</code>): acknowledge alerts, and resolve the forensic alert types that do not auto-clear (most alerts auto-resolve when their condition clears; those are acknowledged, not resolved). Reversible.</li>
        <li><strong>Administrative</strong> (<code>glassmkr:admin</code>): enroll a server, rotate a collector key, or move a server to trash. Each of these runs a two-step confirmation (see below).</li>
      </ul>
      <p>Each scope is granted separately on the approval screen, and a client only ever has what you approved.</p>
    </section>

    <section id="connect">
      <h2><a href="#connect" class="anchor-link">#</a>Connect a client</h2>
      <p>Add the Glassmkr MCP endpoint to your client and complete the browser sign-in it prompts for:</p>
      <ol>
        <li>In your client, add a new MCP server with the URL <code>https://app.glassmkr.com/mcp</code>.</li>
        <li>The client sends you to Glassmkr to sign in and review a consent screen that names the client and the exact scopes it requests (read, and optionally write or administrative).</li>
        <li>Approve, and the client receives a per-user token scoped to your account. The connection appears under <strong>Settings, MCP connections</strong> in the dashboard.</li>
      </ol>
      <p>Authorization uses OAuth 2.1 (authorization code with PKCE); the client discovers the endpoints automatically from the standard metadata documents. You never paste a Glassmkr password or key into the client.</p>
      <p>Let your client run this flow. A compatible MCP client performs the registration, PKCE, browser redirect, and token exchange for you: point it at the endpoint and approve the consent screen. You should not build the OAuth flow by hand, run your own loopback listener, or call the token endpoint yourself. In Claude Code, for example, that means <code>claude mcp add --transport http glassmkr https://app.glassmkr.com/mcp</code> and then authorizing the server (the <code>/mcp</code> command), not scripting the exchange.</p>
    </section>

    <section id="tools">
      <h2><a href="#tools" class="anchor-link">#</a>What it exposes</h2>
      <p>Read tools are annotated read-only and idempotent; write and administrative tools are annotated so your client flags them for approval.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Scope</th><th>Does</th></tr></thead>
          <tbody>
            <tr><td><code>glassmkr.fleet.list_servers</code></td><td>read</td><td>List servers in the account, paginated, filterable by tag.</td></tr>
            <tr><td><code>glassmkr.servers.get</code></td><td>read</td><td>Management-plane detail for one server.</td></tr>
            <tr><td><code>glassmkr.servers.get_health</code></td><td>read</td><td>Latest bounded health snapshot and active alerts.</td></tr>
            <tr><td><code>glassmkr.servers.get_history</code></td><td>read</td><td>Bounded CPU, memory, swap, and load history.</td></tr>
            <tr><td><code>glassmkr.host_profiles.list</code></td><td>read</td><td>Host profiles and their suppressed rules.</td></tr>
            <tr><td><code>glassmkr.alerts.acknowledge</code></td><td>write</td><td>Acknowledge an alert. Reversible.</td></tr>
            <tr><td><code>glassmkr.alerts.resolve</code></td><td>write</td><td>Resolve a forensic alert. Reversible.</td></tr>
            <tr><td><code>glassmkr.admin.prepare</code></td><td>admin</td><td>Preview an administrative action and get a confirmation token.</td></tr>
            <tr><td><code>glassmkr.admin.enroll_server</code></td><td>admin</td><td>Create a server and mint its one-time collector key.</td></tr>
            <tr><td><code>glassmkr.admin.rotate_key</code></td><td>admin</td><td>Rotate a server's collector key.</td></tr>
            <tr><td><code>glassmkr.admin.delete_server</code></td><td>admin</td><td>Move a server to trash (restorable from the dashboard).</td></tr>
            <tr><td><code>glassmkr://fleet/summary</code></td><td>read</td><td>Server and active-alert totals (resource).</td></tr>
            <tr><td><code>glassmkr://servers/&#123;server_id&#125;/snapshot/latest</code></td><td>read</td><td>Latest bounded telemetry for one owned server (resource).</td></tr>
            <tr><td><code>triage_my_fleet</code>, <code>explain_alert</code></td><td>read</td><td>Read-only workflows with the trust boundary built in (prompts).</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="confirm">
      <h2><a href="#confirm" class="anchor-link">#</a>Changing things safely</h2>
      <p>Administrative actions are protected by a stack of independent controls, because the AI model itself drives the client: the human-in-the-loop is your MCP client's own tool-approval prompt, not anything the model types. The controls:</p>
      <ul>
        <li><strong>A scope you granted.</strong> Admin tools require the <code>glassmkr:admin</code> scope, which you approved by name on the consent screen; read or write connections cannot reach them.</li>
        <li><strong>A signed, single-use, two-step token.</strong> The client first calls <code>glassmkr.admin.prepare</code>, which returns a short-lived token bound to that exact account, action, and target, and to the target's state at that moment; the action requires the token back and the target's name echoed. The token authorises one action only: a second call carrying it is refused. It also stops verifying if the target is renamed, suspended, trashed, or has its key rotated in between, so a commit can never land against a resource that changed after it was previewed. The model supplies both halves, so this is not itself a human check: it forces a deliberate two step and binds the action to one specific, unchanged target, so a stray or injected single call cannot act on the wrong server. It does not bind the user, the client, or the granted scope: two clients authorized on the same account are not told apart by it, and that boundary is the scope check on every call plus your client's approval step.</li>
        <li><strong>Your client's approval prompt.</strong> This is the actual human gate: a person approves the tool call in the client before it runs.</li>
        <li><strong>A soft delete.</strong> <code>glassmkr.admin.delete_server</code> moves a server to trash, restorable from the dashboard. It never destroys data.</li>
          <li><strong>And every other interface agrees.</strong> <code>DELETE /api/v1/servers/&#123;id&#125;</code> in the REST API and the dashboard's delete button do the same thing. Until 2026-08-28 the REST endpoint destroyed the row instead, so an agent that learned the restorable behaviour here lost data using that. Permanent removal is now a separate operation, <code>DELETE /api/v1/trashed-servers/&#123;id&#125;</code>, which requires the server to already be in the trash, a recent re-authentication, and an opt-in <code>servers:purge</code> capability that admin scope does not grant. It is not exposed over MCP at all: an agent has no path to permanent destruction.</li>
        <li><strong>Bounded and logged.</strong> Every call is tenant-scoped to your account, mutations respect the same per-action rate limits as the REST API, and each call is written to your audit log.</li>
      </ul>
    </section>

    <section id="trust">
      <h2><a href="#trust" class="anchor-link">#</a>Trust boundary</h2>
      <p>Telemetry comes from your monitored hosts, so hostnames, IPs, collector versions, alert text, and other host-derived strings are treated as untrusted data. Every tool result carries a trust classification and lists the exact fields that are host-derived, and the server instructs the client never to follow instructions found in those fields. This keeps a compromised or mislabeled host from steering the AI client through your telemetry.</p>
    </section>

    <section id="security">
      <h2><a href="#security" class="anchor-link">#</a>Security</h2>
      <ul>
        <li><strong>Per-user, scoped tokens.</strong> A connection is bound to your user and account and carries only the scopes you approved (read, write, or admin).</li>
        <li><strong>Tenant isolation.</strong> Every call is checked against your account; a token can never reach another account's servers.</li>
        <li><strong>Revocable.</strong> Revoke any connection from <strong>Settings, MCP connections</strong>; revocation and a password reset both cut off existing tokens immediately.</li>
        <li><strong>Rate-limited and audited.</strong> Requests are rate-limited per token and per account, and every tool call is written to your <a href="/docs/programmatic-api#audit">audit log</a>.</li>
      </ul>
    </section>

    <section id="endpoint">
      <h2><a href="#endpoint" class="anchor-link">#</a>Endpoint</h2>
      <p>The server speaks MCP over streamable HTTP at <code>https://app.glassmkr.com/mcp</code>. Point a compatible client at that URL and complete the browser authorization; there is nothing to install on your servers beyond the <a href="/docs/getting-started">Crucible agent</a> you already run.</p>
      <p>MCP is available on every plan; access is bounded by the same node quota and per-action rate limits as the <a href="/docs/programmatic-api">programmatic API</a>.</p>
    </section>

    <section id="troubleshooting">
      <h2><a href="#troubleshooting" class="anchor-link">#</a>Troubleshooting</h2>
      <p>If a connection does not complete, let your client run the OAuth flow end to end: a compatible client discovers the endpoints from the metadata documents and handles the browser sign-in itself, so you should not hand-configure endpoints or build the flow yourself. After you approve, the connection appears under <strong>Settings, MCP connections</strong> in the dashboard. To reset a client that is stuck on authorization, revoke it there and authorize again.</p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 960px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 180px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: color 0.15s, border-color 0.15s; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.6; }
  section { margin-bottom: 3rem; scroll-margin-top: 80px; }
  h2 { font-size: 1.4rem; color: var(--text-primary); margin-bottom: 0.75rem; position: relative; }
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.25rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.5rem; }
  ol { color: var(--text-secondary); line-height: 1.7; padding-left: 1.25rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; margin: 0.5rem 0 0.75rem; }
  pre code { font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.6; color: var(--text-primary); background: transparent; padding: 0; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; font-size: 0.875rem; }
  thead th { text-align: left; padding: 8px 12px; color: var(--text-tertiary); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--surface-border); }
  tbody td { padding: 7px 12px; color: var(--text-secondary); border-bottom: 1px solid rgba(61, 54, 48, 0.4); vertical-align: top; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    table, thead th, tbody td { font-size: 12px; }
    code { font-size: 12px; }
  }
</style>
