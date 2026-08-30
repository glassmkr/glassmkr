<script lang="ts">
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Programmatic API", item: "https://glassmkr.com/docs/programmatic-api" },
    ],
  });
</script>

<svelte:head>
  <title>Programmatic API and account keys: Glassmkr documentation</title>
  <meta name="description" content="Provision servers, rotate keys, query the audit log from Ansible / Terraform / any HTTP client via Glassmkr's account API keys (gmk_acct_live_*). Full read+write API on every account." />
  <link rel="canonical" href="https://glassmkr.com/docs/programmatic-api" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/programmatic-api" />
  <meta property="og:title" content="Programmatic API + account API keys" />
  <meta property="og:description" content="Account API keys, scopes, idempotency, rate limits, audit log." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Programmatic API + account API keys" />
  <meta name="twitter:description" content="Account API keys, scopes, idempotency, rate limits, audit log." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / PROGRAMMATIC API</p>
      <h1>Programmatic API + account API keys</h1>
      <p class="docs-subtitle">For the full endpoint reference see the <a href="/docs/api">API reference</a>; for tier gating see <a href="/docs/api/tier-gating">/docs/api/tier-gating</a>. The full read+write programmatic API is on every account, bounded only by the hosted 10-node cap and the rate limits (self-hosted instances have no node limits). For fleet access from a compatible AI client (query, and with your consent manage), see the <a href="/docs/mcp">MCP server</a>.</p>
    </header>

    <section id="keys">
      <h2><a href="#keys" class="anchor-link">#</a>The two key types</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key type</th><th>Prefix</th><th>Used for</th><th>Created via</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Account API key</strong></td>
              <td><code>gmk_acct_live_</code></td>
              <td>Management endpoints: list servers, create servers, rotate keys, query audit log.</td>
              <td><code>POST /api/v1/account/keys</code> via curl / Ansible / Terraform after recent re-authentication via <code>POST /api/v1/account/verify-password</code>. Available on every account.</td>
            </tr>
            <tr>
              <td><strong>Collector key</strong></td>
              <td><code>gmk_cru_live_</code></td>
              <td>Telemetry ingestion only. Scoped to one server. Cannot list other servers or read account settings.</td>
              <td>Returned by <code>POST /api/v1/servers</code>. Rotate via <code>POST /api/v1/servers/&#123;id&#125;/rotate-key</code>.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Older agents may still have <code>col_*</code> collector keys. Both formats authenticate against <code>/api/v1/ingest</code>; you can rotate at your own pace.</p>
    </section>

    <section id="quickstart">
      <h2><a href="#quickstart" class="anchor-link">#</a>Quickstart: provision 50 servers in two minutes</h2>

      <h3>1. Create an account API key</h3>
      <p>Two calls. Use a logged-in browser session (cookie jar). Account-key creation cannot use another account key.</p>
      <pre><code># 1. Re-authenticate (opens a 5-minute step-up window).
curl -sS -X POST https://app.glassmkr.com/api/v1/account/verify-password \
  -b session.cookie \
  -H "Content-Type: application/json" \
  -d '&#123;"password":"your-dashboard-password"&#125;'

# 2. Create the key (returned in plaintext exactly once; save it).
#    scope must be "write" to create servers ("write" is the default).
curl -sS -X POST https://app.glassmkr.com/api/v1/account/keys \
  -b session.cookie \
  -H "Content-Type: application/json" \
  -d '&#123;"name":"ansible-prod","scope":"write"&#125;'</code></pre>
      <p class="note">On the hosted service, server creation is capped at the 10-node per-account cap, so a 50-server run assumes a self-hosted instance (no node limits). That is why the script below takes <code>BASE_URL</code> rather than hardcoding <code>app.glassmkr.com</code>: an example that tells you to self-host and then posts to the hosted service cannot be run as written.</p>

      <h3>2. Create the servers via curl</h3>
      <pre><code># Your dashboard. Leave as-is for the hosted service; set it to your own
# instance when self-hosting, e.g. BASE_URL="https://glassmkr.internal".
BASE_URL="&#36;&#123;BASE_URL:-https://app.glassmkr.com&#125;"
API_KEY="gmk_acct_live_..."

for i in $(seq 1 50); do
  RESPONSE=$(curl -sS -X POST "$BASE_URL/api/v1/servers" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: bootstrap-$(date +%s)-$i" \
    -d '&#123;"name":"web-'$i'","hostname":"web-'$i'.prod.example.com","tags":["prod","web"]&#125;')

  COLLECTOR_KEY=$(echo "$RESPONSE" | jq -r '.server.api_key')
  echo "web-$i  =>  $COLLECTOR_KEY"
done</code></pre>

      <h3>3. Provision the agent on each host</h3>
      <pre><code># Self-hosted: add --ingest-url so the agent reports to YOUR dashboard,
# not to app.glassmkr.com.
curl -sf https://glassmkr.com/install.sh | sudo GLASSMKR_API_KEY=$COLLECTOR_KEY bash -s -- \
  --ingest-url "$BASE_URL/api/v1/ingest"</code></pre>
        <p class="note">Drop the <code>--ingest-url</code> flag on the hosted service, where it is the default. The installer supports Ubuntu and Debian; other distributions use the single-file binary or npm, both covered in <a href="/docs/getting-started">Getting started</a>.</p>
    </section>

    <section id="channels">
      <h2><a href="#channels" class="anchor-link">#</a>Route alerts in the same run</h2>
      <p>Notification channels are managed by the same account key: create, update, test and delete over the API. Six types: <code>slack</code>, <code>discord</code>, <code>pagerduty</code>, <code>telegram</code>, <code>email</code>, <code>webhook</code>. A provisioning pipeline can register a server and wire its alerts to the right destination in the same script:</p>
      <pre><code># Create the channel (write scope). Slack and Discord take a webhook_url;
# PagerDuty takes a routing_key; email takes an email address; generic webhook takes a webhook_url.
curl -sS -X POST https://app.glassmkr.com/api/v1/channels \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '&#123;"channel_type":"slack","name":"prod-alerts","config":&#123;"webhook_url":"https://hooks.slack.com/services/..."&#125;&#125;'
# -> the new channel id comes back in .channel.id

# Prove delivery end to end before you rely on it. The test endpoint returns
# 200 with &#123;"success":false&#125; when delivery fails, so assert on .success.
curl -sS -X POST "https://app.glassmkr.com/api/v1/channels/$CHANNEL_ID/test" \
  -H "Authorization: Bearer $API_KEY" | jq -e '.success' >/dev/null \
  || &#123; echo "channel test failed"; exit 1; &#125;</code></pre>
      <p>Channels apply account-wide and can be filtered per channel by alert priority (<code>P0</code> to <code>P4</code>). A channel created without an explicit list receives <code>P0</code> to <code>P3</code>; <code>P4</code> is the informational tier and is off unless you ask for it. Full lifecycle reference (including <code>PUT</code> and <code>DELETE</code>): <a href="/docs/api#channels">API reference: channels</a>.</p>
    </section>

    <section id="rate-limits">
      <h2><a href="#rate-limits" class="anchor-link">#</a>Rate limits</h2>
      <p>Three default tiers (per-IP, per-key, per-account) plus per-endpoint sub-limits for the high-risk operations:</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Tier</th><th>Capacity</th><th>Refill</th></tr></thead>
          <tbody>
            <tr><td>Per-IP</td><td>100 burst</td><td>10/sec</td></tr>
            <tr><td>Per-key</td><td>1000 burst</td><td>100/sec</td></tr>
            <tr><td>Per-account</td><td>5000 burst</td><td>500/sec</td></tr>
            <tr><td><code>POST /servers</code></td><td>100 / hour / account</td><td>n/a</td></tr>
            <tr><td><code>DELETE /servers/&#123;id&#125;</code></td><td>100 / hour / account</td><td>n/a</td></tr>
            <tr><td><code>POST /servers/&#123;id&#125;/rotate-key</code></td><td>10 / hour / account</td><td>n/a</td></tr>
            <tr><td><code>POST /account/keys</code></td><td>10 / hour / account</td><td>n/a</td></tr>
            <tr><td><code>POST /account/keys/&#123;id&#125;/rotate</code></td><td>10 / hour / account</td><td>n/a</td></tr>
          </tbody>
        </table>
      </div>
      <p>On 429, the response body includes <code>tier</code> and <code>retry_after_seconds</code>; the <code>Retry-After</code> header is set.</p>
    </section>

    <section id="idempotency">
      <h2><a href="#idempotency" class="anchor-link">#</a>Idempotency</h2>
      <p><code>POST /api/v1/servers</code> accepts an <code>Idempotency-Key</code> header (Stripe-style). Retries within 24h with the same key return the cached response (status + body). Use one for every retried server-creation operation in your automation.</p>
    </section>

    <section id="stepup">
      <h2><a href="#stepup" class="anchor-link">#</a>Step-up authentication</h2>
      <p>API key creation and rotation require recent password re-verification. POST your current password to <code>/api/v1/account/verify-password</code> (session auth, not bearer-token) to stamp <code>last_password_verified_at</code>. After that, sensitive operations succeed for 5 minutes.</p>
      <p>This protects against session-stealing attacks: an attacker with a leaked cookie cannot mint a long-lived API key without also knowing the password.</p>
    </section>

    <section id="audit">
      <h2><a href="#audit" class="anchor-link">#</a>Audit log</h2>
      <p>Every API call writes one row to the audit log. Read it via <code>GET /api/v1/account/audit</code>:</p>
      <ul>
        <li>Paginated by ts cursor (<code>?limit=50&amp;cursor=...</code>)</li>
        <li>Filterable by <code>key_id</code>, <code>resource_type</code>, <code>resource_id</code>, <code>action</code>, <code>result</code></li>
        <li>Retention: 365 days of alert history in both deployment forms (a ClickHouse table TTL; self-hosted operators can change it)</li>
        <li>Append-only: we cannot edit history server-side</li>
      </ul>
    </section>

    <section id="securing">
      <h2><a href="#securing" class="anchor-link">#</a>Securing your keys</h2>
      <ul>
        <li>Store in your secret manager (1Password, Vault, AWS Secrets Manager, Doppler). Never in <code>.env</code> committed to git.</li>
        <li>Use a separate key per integration (Ansible, CI, Terraform). Revoking one does not disrupt the others.</li>
        <li>Set an <code>expires_at</code> on short-lived CI keys.</li>
        <li>If a key leaks: revoke immediately at <code>DELETE /api/v1/account/keys/&#123;id&#125;</code> or via the dashboard.</li>
        <li>GitHub secret-scanning partner registration for <code>gmk_acct_live_</code> and <code>gmk_cru_live_</code> prefixes is queued; once active, accidentally-committed keys auto-revoke.</li>
      </ul>
    </section>

    <section id="errors">
      <h2><a href="#errors" class="anchor-link">#</a>Errors</h2>
      <p>Errors that carry a machine-readable code, which today means plan and quota refusals, rate limiting, and idempotency conflicts, return this envelope:</p>
      <pre><code>&#123;
  "error": "machine_readable_code",
  "message": "Human-readable explanation",
  "documentation_url": "https://glassmkr.com/docs/programmatic-api#rate-limits"
&#125;</code></pre>
      <p>Not every error looks like this, and code that parses our responses should not assume it does. An authentication failure returns <code>&#123;"message": "Authentication failed"&#125;</code> with no code. A method mismatch returns plain text. A path that does not exist returns an HTML error page rather than JSON. Branch on the HTTP status first and treat the body as a best-effort explanation.</p>
      <p>Every response carries an <code>x-request-id</code> header. Quote that value when contacting <a href="mailto:support@glassmkr.com">support</a>; we correlate it against the audit log and application logs. It is a header, not a body field.</p>
      <p class="note">Last verified: 2026-08-27 against the live API, by requesting each shape rather than by reading the handler.</p>
    </section>
  </article>

<style>
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.25rem; margin-bottom: 0.5rem; }
  /* 0.875rem, not 0.85rem, because `code` inside a note is 0.88em and the two
     compound: 13.6 x 0.88 = 11.97px, under this project's own 12px floor. At
     14px the inline code lands at 12.3px and the note still reads as secondary. */
  .note { font-size: 0.875rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; font-size: 0.875rem; }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
