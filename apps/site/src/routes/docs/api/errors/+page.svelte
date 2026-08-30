<script lang="ts">
  // Every error the API returns links here, at
  // https://glassmkr.com/docs/api/errors#<code>. The table is generated from
  // api-error-codes.json, and scripts/check-openapi-drift.mjs asserts that file
  // lists exactly the codes the server can emit, so this page cannot quietly
  // stop matching the running service.
  import errorCodes from "$lib/data/api-error-codes.json";

  const codes = errorCodes.codes;
  const retryable = codes.filter((c) => c.retryable);

  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "API", item: "https://glassmkr.com/docs/api" },
      { "@type": "ListItem", position: 3, name: "Errors", item: "https://glassmkr.com/docs/api/errors" },
    ],
  });
</script>

<svelte:head>
  <title>API errors: Glassmkr documentation</title>
  <meta
    name="description"
    content="Every Glassmkr API response with a status of 400 or above returns the same JSON envelope: a stable machine code, a request id, and an explicit retryable flag. Full code reference with retry guidance."
  />
  <link rel="canonical" href="https://glassmkr.com/docs/api/errors" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/api/errors" />
  <meta property="og:title" content="Glassmkr API errors" />
  <meta
    property="og:description"
    content="One JSON error envelope for the whole API namespace, with stable machine codes and explicit retry guidance."
  />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr API errors" />
  <meta
    name="twitter:description"
    content="One JSON error envelope for the whole API, with stable machine codes and explicit retry guidance."
  />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs/api" class="sidebar-section">&larr; API reference</a>
      <a href="#envelope" class="sidebar-link">The envelope</a>
      <a href="#deciding" class="sidebar-link">Deciding what to do</a>
      <a href="#codes" class="sidebar-link">Code reference</a>
      <a href="#oauth" class="sidebar-link">OAuth is different</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / API / ERRORS</p>
      <h1>API errors</h1>
      <p class="docs-subtitle">
        Every response under <code>/api/</code> with a status of 400 or above returns the same JSON
        object. Branch on <code>error</code>. Never parse <code>message</code>.
      </p>
    </header>

    <section id="envelope">
      <h2><a href="#envelope" class="anchor-link">#</a>The envelope</h2>
      <pre><code>{`{
  "error": "method_not_allowed",
  "message": "GET is not supported on this endpoint. Allowed: POST.",
  "request_id": "d22e3678-8a18-4aa3-ab86-bfd374080269",
  "documentation_url": "https://glassmkr.com/docs/api/errors#method_not_allowed",
  "retryable": false,
  "retry_after_seconds": null,
  "details": [{ "allowed_methods": ["POST"] }]
}`}</code></pre>
      <ul>
        <li><strong>error</strong> is a stable machine code. It is the only field you should make decisions from. Codes are added over time; an unrecognised one should be treated by its HTTP status.</li>
        <li><strong>message</strong> is for humans and logs. The wording can change in any release.</li>
        <li><strong>request_id</strong> matches the <code>X-Request-Id</code> response header. Quote it when reporting a problem.</li>
        <li><strong>retryable</strong> says whether an identical retry could plausibly succeed. A client mistake is never retryable, because retrying it unchanged only burns quota.</li>
        <li><strong>retry_after_seconds</strong> is set when the server can say how long to wait. The <code>Retry-After</code> header carries the same value.</li>
        <li><strong>details</strong> is a list of structured extras, empty when there are none.</li>
      </ul>
      <p>
        This holds for the whole namespace, including a 404 for an unknown path and a 405 for the
        wrong verb. Those two used to return the HTML app shell and untyped plain text respectively,
        which is exactly the shape an autonomous client cannot recover from.
      </p>
    </section>

    <section id="deciding">
      <h2><a href="#deciding" class="anchor-link">#</a>Deciding what to do</h2>
      <p>The envelope is designed so a client can decide without reading prose:</p>
      <ul>
        <li><code>retryable: true</code> and a <code>retry_after_seconds</code>: wait that long, then retry the same request.</li>
        <li><code>retryable: true</code> without a delay: retry with your own backoff.</li>
        <li><code>retryable: false</code> on a 401: get a different credential. The same one will fail identically.</li>
        <li><code>retryable: false</code> on a 403: stop. This credential is not permitted the operation, and repeating it will not change that.</li>
        <li><code>retryable: false</code> on a 400 or 422: fix the request from <code>details</code> before sending anything again.</li>
        <li><code>retryable: false</code> on a 409: re-read the current state before deciding, because yours is stale.</li>
      </ul>
    </section>

    <section id="codes">
      <h2><a href="#codes" class="anchor-link">#</a>Code reference</h2>
      <p>
        {codes.length} codes, {retryable.length} of them retryable. Each anchor here is what
        <code>documentation_url</code> points at.
      </p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="API error codes, scrolls horizontally">
        <table>
          <thead>
            <tr><th>Code</th><th>Status</th><th>Retryable</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            {#each codes as c (c.code)}
              <tr id={c.code}>
                <td><code>{c.code}</code></td>
                <td>{c.status ?? "4xx"}</td>
                <td>{c.retryable ? "yes" : "no"}</td>
                <td>{c.meaning}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section id="oauth">
      <h2><a href="#oauth" class="anchor-link">#</a>OAuth is deliberately different</h2>
      <p>
        The MCP authorization endpoints under <code>/oauth/</code> return the shape RFC 6749
        mandates, <code>{"{ error, error_description }"}</code>, not the envelope above. An OAuth
        client is entitled to expect the standard shape, so those routes are excluded on purpose
        rather than by oversight.
      </p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 980px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 180px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { font-size: 1.05rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 2.5rem; }
  section { margin-bottom: 2.5rem; }
  h2 { font-size: 1.35rem; color: var(--text-primary); margin: 0 0 0.75rem; }
  .anchor-link { color: var(--text-tertiary); text-decoration: none; margin-right: 8px; }
  p, li { color: var(--text-secondary); line-height: 1.7; }
  ul { padding-left: 20px; margin-bottom: 1rem; }
  li { margin-bottom: 6px; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; margin: 0.5rem 0 1rem; }
  pre code { font-family: var(--font-mono); font-size: 13px; line-height: 1.55; color: var(--text-primary); background: transparent; padding: 0; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; font-size: 0.875rem; min-width: 40rem; }
  thead th { text-align: left; padding: 8px 12px; color: var(--text-tertiary); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--surface-border); }
  tbody td { padding: 8px 12px; color: var(--text-secondary); border-bottom: 1px solid rgba(61, 54, 48, 0.4); vertical-align: top; }
  tbody tr:target { background: rgba(255, 107, 53, 0.06); }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }
</style>
