<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let copied = $state(false);
  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(data.endpoint);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copied = false;
    }
  }

  function formatDate(value: Date | string | null): string {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
  }

  const SCOPE_LABEL: Record<string, string> = {
    "glassmkr:read": "read",
    "glassmkr:write": "write",
    "glassmkr:admin": "admin",
  };
  function scopeClass(scope: string): string {
    if (scope === "glassmkr:admin") return "scope scope-admin";
    if (scope === "glassmkr:write") return "scope scope-write";
    return "scope scope-read";
  }
</script>

<svelte:head>
  <title>MCP connections | Dashboard Settings</title>
</svelte:head>

<div class="container">
  <a class="back-link" href="/settings">&larr; Settings</a>
  <h1 class="page-title">MCP connections</h1>
  <p class="page-desc">
    Connect a compatible AI client to this account over the Model Context Protocol.
    Access is per-user and tiered: a client only holds the scopes you approve in the
    browser, and you can revoke any connection here.
    <a href="https://glassmkr.com/docs/mcp" target="_blank" rel="noopener">MCP guide</a>.
  </p>

  <section class="section card endpoint">
    <div class="endpoint-text">
      <h2>Server endpoint</h2>
      <p class="desc">Add this URL when a client asks for the Glassmkr MCP server; it handles the browser sign-in.</p>
    </div>
    <div class="endpoint-value">
      <code class="mono">{data.endpoint}</code>
      <button class="btn btn-small" type="button" onclick={copyEndpoint}>{copied ? "Copied" : "Copy"}</button>
    </div>
  </section>

  {#if !data.enabled}
    <section class="section card">
      <h2>Not enabled for this environment</h2>
      <p class="desc">MCP access is behind a server-side rollout flag. No connections can be authorized here yet.</p>
    </section>
  {:else}
    <section class="section card">
      <div class="section-header">
        <h2>Authorized clients</h2>
        <span class="count">{data.grants.length}</span>
      </div>
      {#if data.grants.length === 0}
        <p class="desc empty">No AI clients are connected to this account yet.</p>
      {:else}
        <div class="grant-list">
          {#each data.grants as grant (grant.id)}
            <div class="grant-row" class:revoked={Boolean(grant.revokedAt)}>
              <div class="grant-id">
                <span class="cell-name">{grant.clientName}</span>
                <div class="scopes">
                  {#each grant.scopes as scope}
                    <span class={scopeClass(scope)}>{SCOPE_LABEL[scope] ?? scope}</span>
                  {/each}
                </div>
              </div>
              <div class="grant-meta">
                {#if grant.revokedAt}
                  <span class="badge badge-revoked">Revoked</span>
                {:else}
                  <span class="badge badge-active">Active</span>
                {/if}
                <span class="muted">Last used {formatDate(grant.lastUsedAt)}</span>
                <span class="muted">Expires {formatDate(grant.expiresAt)}</span>
              </div>
              <div class="grant-actions">
                {#if !grant.revokedAt}
                  <form method="POST" action="?/revoke">
                    <input type="hidden" name="grant_id" value={grant.id} />
                    <button class="btn btn-small btn-danger" type="submit">Revoke</button>
                  </form>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <section class="section card">
    <h2>How access is bounded</h2>
    <ul class="bounds">
      <li>A connection can only reach your own servers, never another account's.</li>
      <li>Read queries your fleet; write acknowledges and resolves alerts; admin can enroll a server, rotate a key, or move one to trash. Each tier is granted separately.</li>
      <li>Access tokens expire after 15 minutes and refresh tokens rotate on use; a revoke or a password reset cuts off existing tokens on the next request.</li>
      <li>Destructive actions take a two-step confirmation, and a delete is a soft delete: the server moves to trash and is restorable, not wiped.</li>
      <li>Host telemetry and alert text are labeled untrusted data, so a client never treats them as instructions.</li>
    </ul>
  </section>
</div>

<style>
  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .back-link { font-size: 12px; color: var(--text-tertiary); text-decoration: none; display: inline-block; margin-bottom: 12px; }
  .page-title { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .page-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; max-width: 760px; line-height: 1.55; }
  .page-desc a { color: var(--accent); text-decoration: none; }
  .section { margin-bottom: 20px; padding: 24px; }
  /* Section headings are h2, not h3. Every one of these pages went h1 straight
     to h3 with no h2 anywhere, which is a real navigation problem rather than a
     pedantic one: a screen-reader user listing headings sees a level that never
     opens, and cannot tell whether they have missed a section. The tag changed;
     the selectors below changed with it, so nothing moves visually. */
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  .desc { font-size: 13px; color: var(--text-secondary); margin: 4px 0 0; line-height: 1.5; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .count { font-size: 12px; color: var(--text-tertiary); }

  .endpoint { display: flex; gap: 20px; align-items: center; justify-content: space-between; }
  .endpoint-value { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  /* The URL box and the Copy button are one control row and must read as the
     same size. They did not: code.mono has 8px vertical padding and inherits
     the 1.6 body line-height, while .btn-small has 4px and is an inline-flex
     box that collapses to its content, so the two measured 37px and 25px.

     The button STRETCHES to the URL box rather than both being pinned to a
     number. A shared min-height cannot work: the URL box needs about 37px for
     its own content, so a 30px floor does nothing to it and only the button
     moves. Pinning both to a fixed height would clip a long self-hosted origin
     once word-break wraps it onto a second line. Stretching keeps the URL box
     the one that decides, and the button follows it to whatever that is. */
  .endpoint-value { align-items: stretch; }
  .endpoint-value .btn { align-self: stretch; }
  .mono { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }
  code.mono { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; padding: 8px 10px; color: var(--text-primary); word-break: break-all; }

  .empty { padding: 8px 0 2px; }
  .grant-list { display: flex; flex-direction: column; }
  .grant-row { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.6fr) 120px; gap: 12px; padding: 12px 8px; border-bottom: 1px solid var(--surface-border); align-items: center; font-size: 13px; }
  .grant-row:last-child { border-bottom: none; }
  .grant-row.revoked { opacity: 0.6; }
  .grant-id { min-width: 0; }
  .cell-name { font-weight: 500; color: var(--text-primary); }
  .scopes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .grant-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
  .grant-actions { display: flex; justify-content: flex-end; }

  .scope { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .scope-read { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
  .scope-write { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .scope-admin { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-active { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
  .badge-revoked { background: rgba(255, 255, 255, 0.06); color: #f87171; }
  .muted { color: var(--text-tertiary); font-size: 12px; }

  .bounds { margin: 10px 0 0; padding-left: 20px; }
  .bounds li { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 6px; }

  @media (max-width: 760px) {
    .endpoint { flex-direction: column; align-items: stretch; }
    .grant-row { grid-template-columns: 1fr; gap: 8px; }
    .grant-actions { justify-content: flex-start; }
  }
</style>
