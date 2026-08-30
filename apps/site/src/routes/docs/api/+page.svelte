<script lang="ts">
  // Examples show the current agent version rather than whatever was current
  // when the example was written. They read 0.13.3 while npm was on 1.0.1.
  import { FALLBACK_CRUCIBLE_VERSION } from "$lib/crucible-version";
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "API", item: "https://glassmkr.com/docs/api" },
    ],
  });

  const apiLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Glassmkr REST API",
    documentation: "https://glassmkr.com/docs/api",
    provider: {
      "@type": "Organization",
      name: "Glassmkr",
      url: "https://glassmkr.com",
    },
    termsOfService: "https://glassmkr.com/trust",
    audience: "Developers integrating Glassmkr telemetry, automation, and alerting",
  });
</script>

<svelte:head>
  <title>API reference: Glassmkr documentation</title>
  <meta name="description" content="Glassmkr REST API reference: auth, servers, ingest, health, channels, alerts, billing, version. Bearer-token authentication, JSON over HTTPS, rate limits." />
  <link rel="canonical" href="https://glassmkr.com/docs/api" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/api" />
  <meta property="og:title" content="Glassmkr API reference" />
  <meta property="og:description" content="Auth, servers, ingest, health, channels, alerts, billing, version. Bearer-token + JSON over HTTPS." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr API reference" />
  <meta name="twitter:description" content="Auth, servers, ingest, health, channels, alerts, billing, version." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
  {@html `<script type="application/ld+json">${apiLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs" class="sidebar-section">&larr; Back to docs</a>
      <a href="#auth" class="sidebar-link">Authentication</a>
      <a href="#servers" class="sidebar-link">Servers</a>
      <a href="#ingest" class="sidebar-link">Ingest</a>
      <a href="#health" class="sidebar-link">Health</a>
      <a href="#channels" class="sidebar-link">Channels</a>
      <a href="#alerts" class="sidebar-link">Alerts</a>
      <a href="#billing" class="sidebar-link">Billing</a>
      <a href="#meta" class="sidebar-link">Meta</a>
      <a href="#rate-limits" class="sidebar-link">Rate limits</a>
      <a href="#pagination" class="sidebar-link">Pagination</a>
      <a href="#idempotency" class="sidebar-link">Idempotency</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / API</p>
      <h1>API reference</h1>
      <p class="docs-subtitle">Base URL: <code>https://app.glassmkr.com/api/v1</code>. All requests and responses use JSON over HTTPS.</p>
    </header>

    <section id="intro">
      <p>Authenticated endpoints require a Bearer token:</p>
      <pre><code>Authorization: Bearer YOUR_API_TOKEN</code></pre>
      <p>Every response with a status of 400 or above returns the same envelope:</p>
      <pre><code>&#123;
  "error": "stable_machine_code",
  "message": "Human explanation. Do not parse this.",
  "request_id": "matches the X-Request-Id header",
  "documentation_url": "https://glassmkr.com/docs/api/errors#stable_machine_code",
  "retryable": false,
  "retry_after_seconds": null,
  "details": []
&#125;</code></pre>
      <p>
        Branch on <code>error</code>, never on <code>message</code>. This holds for the whole
        <code>/api/</code> namespace, including a 404 for an unknown path and a 405 for the wrong
        verb. The full code list with retry guidance is at <a href="/docs/api/errors">API errors</a>.
      </p>
      <p>For programmatic-API specifics (account keys, scopes, audit log) see the <a href="/docs/programmatic-api">Programmatic API</a> page. Nothing in the API is tier-gated; the <a href="/docs/api/tier-gating">Tier gating</a> page records what changed and when.</p>
    </section>

    <section id="auth">
      <h2><a href="#auth" class="anchor-link">#</a>Authentication</h2>

      <div class="endpoint">
        <h3>Register</h3>
        <div class="method-path">
          <span class="method method-post">POST</span>
          <code>/auth/register</code>
          <span class="auth-badge">Public</span>
        </div>
        <p>Create a new Glassmkr account.</p>
        <p><strong>Request body:</strong></p>
        <pre><code>&#123;
  "email": "user@example.com",
  "password": "&lt;at least 12 characters&gt;",
  "name": "Jane Doe"
&#125;</code></pre>
        <p><strong>Response (201):</strong></p>
        <pre><code>&#123;
  "user": &#123;
    "id": "usr_a1b2c3d4",
    "email": "user@example.com",
    "name": "Jane Doe",
    "verified": false,
    "created_at": "2026-04-05T10:00:00Z"
  &#125;,
  "token": "&lt;session JWT&gt;"
&#125;</code></pre>
        <p>A verification email is sent automatically. The account is fully functional before verification, but some features (team invites) require a verified email.</p>
      </div>

      <div class="endpoint">
        <h3>Login</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/auth/login</code> <span class="auth-badge">Public</span></div>
        <p>Authenticate and receive a session token.</p>
        <pre><code>&#123;
  "email": "user@example.com",
  "password": "&lt;at least 12 characters&gt;"
&#125;</code></pre>
        <p><strong>Response (200):</strong></p>
        <pre><code>&#123;
  "token": "&lt;session JWT&gt;",
  "expires_at": "2026-04-12T10:00:00Z"
&#125;</code></pre>
        <p>Session tokens are valid for 7 days. <strong>Error (401)</strong> on bad credentials: <code>&#123; "error": "invalid_credentials", "message": "Email or password is incorrect." &#125;</code>.</p>
      </div>

      <div class="endpoint">
        <h3>Logout</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/auth/logout</code> <span class="auth-badge">Authenticated</span></div>
        <p>Invalidate the current session token. Response (204) no content.</p>
      </div>

      <div class="endpoint">
        <h3>Get current user</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/auth/me</code> <span class="auth-badge">Authenticated</span></div>
        <p>Returns the authenticated user's profile.</p>
        <pre><code>&#123;
  "id": "usr_a1b2c3d4",
  "email": "user@example.com",
  "name": "Jane Doe",
  "verified": true,
  "role": "owner",
  "created_at": "2026-04-05T10:00:00Z",
  "servers_count": 6,
  "plan": "pro"
&#125;</code></pre>
      </div>

      <div class="endpoint">
        <h3>Verify email</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/auth/verify</code> <span class="auth-badge">Public</span></div>
        <p>Confirm an email address using the token from the verification email.</p>
        <pre><code>&#123; "token": "&lt;verification token&gt;" &#125;</code></pre>
      </div>
    </section>

    <section id="servers">
      <h2><a href="#servers" class="anchor-link">#</a>Servers</h2>

      <div class="endpoint">
        <h3>Register server</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/servers</code> <span class="auth-badge">Authenticated</span></div>
        <p>Register a new server. Returns a fresh collector key.</p>
        <p><strong>Request body:</strong> <code>name</code>, <code>hostname</code>, <code>tags</code>, and <code>profile</code> are accepted. Hardware fields (OS, architecture, core count, RAM) are reported by the agent on each ingest, never on registration.</p>
        <pre><code>&#123;
  "name": "web-prod-01",
  "hostname": "web-prod-01.example.com",
  "tags": ["production", "web"]
&#125;</code></pre>
        <p><code>name</code> is required (1-100 chars). <code>hostname</code> defaults to <code>name</code> and must be a valid RFC 1035 hostname. <code>tags</code> is optional, max 20 strings of 1-50 chars each. <code>profile</code> is optional: a host-type profile that suppresses the alerts expected by design for that kind of host. The field is named <code>profile</code> (not <code>host_type</code>); accepted values are <code>null</code> (the default "General", no suppression) or <code>"marketplace_gpu"</code> (a rented marketplace GPU box, which silences <code>no_firewall</code>, <code>unattended_upgrades_disabled</code>, and <code>gpu_power_cap_throttling</code>). An unknown value returns <code>400 validation_failed</code> with <code>profile must be null or one of: ...</code>. Other fields are silently dropped (mass-assignment defense).</p>
        <p><strong>Response (201):</strong></p>
        <pre><code>&#123;
  "success": true,
  "server": &#123;
    "id": "srv_a1b2c3d4",
    "name": "web-prod-01",
    "hostname": "web-prod-01.example.com",
    "tags": ["production", "web"],
    "api_key": "gmk_cru_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_aBcD"
  &#125;,
  "ingest_url": "https://app.glassmkr.com/api/v1/ingest",
  "message": "Save your collector key. It will not be shown again."
&#125;</code></pre>
        <p>The collector key is shown <strong>once</strong>. Configure it on the agent before the dashboard tile leaves "pending first snapshot". The <code>Idempotency-Key</code> header is supported (24h replay window).</p>
      </div>

      <div class="endpoint">
        <h3>List servers</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers</code> <span class="auth-badge">Authenticated</span></div>
        <p>List all servers in the account.</p>
        <p><strong>Query parameters:</strong></p>
        <div class="table-scroll"><table>
          <thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>tag</code></td><td>string</td><td>Filter by tag. Repeat for multiple tags (AND logic).</td></tr>
            <tr><td><code>limit</code></td><td>int</td><td>Page size, 1-100 (default 100).</td></tr>
            <tr><td><code>cursor</code></td><td>string</td><td>Opaque pagination cursor returned as <code>next_cursor</code> on the previous page.</td></tr>
          </tbody>
        </table></div>
        <p><strong>Response (200):</strong></p>
        <pre><code>&#123;
  "servers": [
    &#123;
      "id": "srv_a1b2c3d4",
      "name": "web-prod-01",
      "hostname": "web-prod-01.example.com",
      "ip": "10.0.1.42",
      "os_type": "ubuntu",
      "os_version": "24.04 LTS",
      "status": "active",
      "suspended_at": null,
      "suspended_reason": null,
      "last_seen_at": "2026-05-09T07:00:00Z",
      "collector_version": "{FALLBACK_CRUCIBLE_VERSION}",
      "active_alerts": 0,
      "disk_health_rollup": "healthy",
      "created_at": "2026-04-05T10:00:00Z",
      "tags": ["production", "web"],
      "dmi_vendor": "GIGABYTE",
      "dmi_product": "R292-4S1-00",
      "ipmi_sensors_count": 106
    &#125;
  ],
  "next_cursor": null
&#125;</code></pre>
        <p>Per-snapshot metrics (CPU usage, RAM usage, disk usage) are not on the list endpoint. Use <code>GET /servers/:id/health</code> for the latest snapshot from a specific server.</p>
        <p><code>status</code> is <code>active</code> for normal operation, <code>suspended</code> when the server is disabled (a historical billing state; see <a href="#billing">Billing</a>). <code>disk_health_rollup</code> is the worst per-drive state across all SMART-monitored drives: <code>healthy</code>, <code>declining</code>, <code>failing</code>, or <code>broken</code>.</p>
      </div>

      <div class="endpoint">
        <h3>Get server</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers/:server_id</code> <span class="auth-badge">Authenticated</span></div>
        <p>Get full details for a single server. Same shape as the list endpoint plus a few read-only fields (<code>config_overrides</code>, <code>free_analysis_used</code>).</p>
      </div>

      <div class="endpoint">
        <h3>Update server</h3>
        <div class="method-path"><span class="method method-put">PATCH</span> <code>/servers/:server_id</code> <span class="auth-badge">Authenticated</span></div>
        <p>Update <code>name</code>, <code>tags</code>, or <code>profile</code> (same values as on registration; send <code>"profile": null</code> to clear it). <code>hostname</code> is intentionally not updatable so ops can find a box by hostname after a rename.</p>
        <pre><code>&#123;
  "name": "web-prod-renamed",
  "tags": ["production", "web", "fra1"]
&#125;</code></pre>
      </div>

      <div class="endpoint">
        <h3>Delete server</h3>
        <div class="method-path"><span class="method method-delete">DELETE</span> <code>/servers/:server_id?confirm=true</code> <span class="auth-badge">Authenticated</span></div>
        <p>
          Move a server to trash. It stops collecting and drops out of your node count, and you
          restore it with <code>POST /servers/&#123;id&#125;/restore</code>.
          <code>?confirm=true</code> is required; a bare DELETE returns 400. The response states
          <code>permanent: false</code> and <code>restorable: true</code> so a client does not
          have to infer the behaviour from the verb.
        </p>
        <p>
          <strong>Every interface agrees.</strong> The MCP tool
          <code>glassmkr.admin.delete_server</code> and the dashboard's delete button do exactly
          this. Until 2026-08-28 this endpoint destroyed the row while the MCP tool moved it to
          trash, which meant an agent that learned the restorable behaviour from one lost data
          using the other. Permanent removal is now a separate operation, below.
        </p>
        <div class="endpoint">
        <h3>Purge a trashed server</h3>
        <div class="method-path"><span class="method method-delete">DELETE</span> <code>/trashed-servers/&#123;id&#125;</code> <span class="auth-badge">Account key</span></div>
        <p>
          <strong>Permanent and irreversible.</strong> Destroys the server row and its stored
          metrics. Four conditions, all required:
        </p>
        <ul>
          <li>The server must <strong>already be in the trash</strong>. You cannot purge a live server in one call; a still-active server returns 409 <code>not_trashed</code>.</li>
          <li><code>?confirm=true</code>.</li>
          <li>Recent re-authentication via <code>POST /account/verify-password</code>, so a leaked key alone is not enough.</li>
          <li>An account key holding the <code>servers:purge</code> capability. It is opt-in at key creation and is <strong>not</strong> granted by admin scope, so no key that existed before this shipped can purge. Without it: 403 <code>missing_capability</code>.</li>
        </ul>
        <p>
          Deliberately absent from MCP. An agent has no path to permanent destruction at all.
        </p>
      </div>
        <p>Per-endpoint sub-limit: 100 deletes/hour/account.</p>
      </div>

      <div class="endpoint">
        <h3>Rotate collector key</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/servers/:server_id/rotate-key</code> <span class="auth-badge">Authenticated</span></div>
        <p>Issue a fresh collector key for an existing server. The previous key stops working immediately. Update <code>/etc/glassmkr/crucible.yaml</code> (legacy installs: <code>/etc/glassmkr/collector.yaml</code>; the agent reads either) on the agent host and restart the service before the next ingest cycle to avoid a gap.</p>
        <pre><code>&#123;
  "success": true,
  "server": &#123; "id": "srv_a1b2c3d4" &#125;,
  "collector_key": "gmk_cru_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_aBcD",
  "rotated_at": "2026-05-09T07:30:00Z",
  "message": "Save this collector key. It will not be shown again."
&#125;</code></pre>
        <p>Rate-limited to 10/hour/account. Note: the field name on this endpoint is <code>collector_key</code>, not <code>api_key</code> as on POST /servers.</p>
      </div>

      <div class="endpoint">
        <h3>Restore server</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/servers/:server_id/restore</code> <span class="auth-badge">Authenticated</span></div>
        <p>Restore a single suspended server. Suspension for a missing payment method is a historical state (pre-August 2026, when Glassmkr still had a paid tier); restoring no longer requires a payment method.</p>
      </div>

      <div class="endpoint">
        <h3>Restore all suspended servers</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/servers/restore-all</code> <span class="auth-badge">Authenticated</span></div>
        <p>Bulk-restore every server suspended for <code>no_card_on_file</code> (a historical state). Used by the dashboard's Settings &rarr; Disabled servers &rarr; Restore all button.</p>
      </div>
    </section>

    <section id="ingest">
      <h2><a href="#ingest" class="anchor-link">#</a>Ingest</h2>

      <div class="endpoint">
        <h3>Push snapshot</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/ingest</code> <span class="auth-badge">Collector key</span></div>
        <p>Submit a Crucible snapshot. Called by the agent every collection interval (default 300 seconds). Authenticated by the collector key in the <code>Authorization: Bearer gmk_cru_live_...</code> header. Rate-limited to one ingest per server per 55 seconds; subsequent calls return 429.</p>
        <p><strong>Request body</strong> (abbreviated; the agent emits the full Snapshot type):</p>
        <pre><code>&#123;
  "system":   &#123; "hostname": "web-prod-01", "ip": "10.0.1.42",
                "os": "Ubuntu 24.04 LTS", "os_id": "ubuntu",
                "kernel": "6.8.0-31-generic", "uptime_seconds": 86400 &#125;,
  "cpu":      &#123; "user_percent": 15.2, "system_percent": 5.3,
                "iowait_percent": 1.1, "idle_percent": 78.4,
                "load_1m": 0.4, "load_5m": 0.6, "load_15m": 0.5,
                "cores": [&#123; "core": 0, "user_percent": 20.1, "system_percent": 4.2,
                            "iowait_percent": 0.5, "idle_percent": 75.2 &#125;] &#125;,
  "memory":   &#123; "total_mb": 65536, "used_mb": 44032,
                "available_mb": 21504, "swap_total_mb": 8192,
                "swap_used_mb": 0 &#125;,
  "disks":    [&#123; "device": "/dev/nvme0n1p2", "mount": "/",
                 "total_gb": 500, "used_gb": 225, "available_gb": 250,
                 "percent_used": 47, "fstype": "ext4",
                 "io_read_mb_s": 15.2, "io_write_mb_s": 3.8,
                 "latency_p99_ms": 0.4,
                 "inodes_total": 32768000, "inodes_used": 1245000 &#125;],
  "smart":    [&#123; "device": "/dev/nvme0n1", "model": "Samsung 990 Pro 2TB",
                 "health": "PASSED", "temperature_c": 38,
                 "percentage_used": 12, "power_on_hours": 8760 &#125;],
  "network":  [&#123; "interface": "eth0", "speed_mbps": 10000,
                 "rx_bytes_sec": 125000, "tx_bytes_sec": 42000,
                 "rx_errors": 0, "tx_errors": 0,
                 "rx_drops": 0, "tx_drops": 0 &#125;],
  "raid":     [],
  "ipmi":     &#123; "available": true, "sel_entries_count": 12,
                "ecc_errors": &#123; "correctable": 0, "uncorrectable": 0 &#125;,
                "sensors": [&#123; "name": "CPU1_TEMP", "value": 52, "unit": "C",
                              "status": "ok", "type": "temperature",
                              "upper_critical": 90 &#125;] &#125;,
  "os_alerts": &#123; "oom_kills_recent": 0, "zombie_processes": 0,
                 "time_drift_ms": 0 &#125;,
  "thermal":  &#123; "available": true, "source": "hwmon coretemp Package id 0",
                "max_cpu_celsius": 52,
                "cpu_readings": [&#123; "chip": "coretemp-isa-0000",
                                    "label": "Package id 0", "celsius": 52 &#125;] &#125;,
  "dmi":      &#123; "available": true, "vendor": "supermicro",
                "raw_vendor": "Supermicro Inc.",
                "product_name": "SYS-1029P-WTR",
                "bios_version": "3.4", "bios_date": "2023-01-12",
                "is_virtual": false &#125;,
  "gpu":      &#123; "available": true, "tier": "nvidia-smi",
                "devices": [&#123; "index": 0, "name": "NVIDIA L4",
                              "temperature_c": 48, "utilization_percent": 12,
                              "memory_used_mb": 4096, "memory_total_mb": 24564 &#125;] &#125;,
  "collector_version": "{FALLBACK_CRUCIBLE_VERSION}",
  "timestamp": "2026-05-22T07:00:00Z"
&#125;</code></pre>
        <p>Optional top-level blocks: <code>security</code>, <code>zfs</code>, <code>io_errors</code>, <code>io_latency</code>, <code>conntrack</code>, <code>systemd</code>, <code>ntp</code>, <code>file_descriptors</code>, <code>thermal</code>, <code>dmi</code>, <code>gpu</code>, <code>expected_reboot</code>. Unknown fields are accepted via <code>passthrough</code>; new collector versions can extend the schema without a coupled Dashboard release.</p>
        <p><strong>Response (200):</strong></p>
        <pre><code>&#123;
  "success": true,
  "received_at": "2026-05-22T07:00:00.123Z",
  "new_alerts": 0,
  "active_alerts": 0
&#125;</code></pre>
      </div>
    </section>

    <section id="health">
      <h2><a href="#health" class="anchor-link">#</a>Health</h2>

      <div class="endpoint">
        <h3>Get server health</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers/:server_id/health</code> <span class="auth-badge">Authenticated</span></div>
        <p>Current health status and latest metric values for a server.</p>
        <pre><code>&#123;
  "server_id": "srv_a1b2c3d4",
  "status": "healthy",
  "last_seen": "2026-04-05T10:05:00Z",
  "current": &#123;
    "cpu_percent": 21.6,
    "ram_percent": 67.2,
    "swap_used_mb": 0,
    "disk_max_percent": 45.0,
    "network_rx_mbps": 120.5,
    "network_tx_mbps": 40.2,
    "cpu_temp_c": 52,
    "active_alerts": 0
  &#125;
&#125;</code></pre>
      </div>

      <div class="endpoint">
        <h3>Get health history</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers/:server_id/health/history</code> <span class="auth-badge">Authenticated</span></div>
        <p>Time-series metric data.</p>
        <div class="table-scroll"><table>
          <thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>metric</code></td><td>string</td><td><code>cpu</code>, <code>memory</code>, <code>disk</code>, <code>network</code>, <code>temperature</code>.</td></tr>
            <tr><td><code>from</code></td><td>ISO 8601</td><td>Start time (default 1 hour ago).</td></tr>
            <tr><td><code>to</code></td><td>ISO 8601</td><td>End time (default now).</td></tr>
            <tr><td><code>resolution</code></td><td>string</td><td><code>1m</code>, <code>5m</code>, <code>1h</code>, <code>1d</code> (auto if omitted).</td></tr>
          </tbody>
        </table></div>
      </div>

      <div class="endpoint">
        <h3>Get server alerts</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers/:server_id/alerts</code> <span class="auth-badge">Authenticated</span></div>
        <p><strong>Defaults to <code>status=all</code>, which includes resolved history</strong>; pass <code>?status=active</code> for only the alerts currently firing. Query params: <code>status</code> (<code>active</code>, <code>resolved</code>, <code>all</code>; default <code>all</code>), <code>severity</code> (<code>critical</code>, <code>warning</code>, <code>info</code>), <code>from</code>, <code>to</code>, <code>page</code>.</p>
      </div>
    </section>

    <section id="channels">
      <h2><a href="#channels" class="anchor-link">#</a>Channels</h2>

      <div class="endpoint">
        <h3>Create channel</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/channels</code> <span class="auth-badge">Write scope</span></div>
        <p>Create a notification channel. Supported types: <code>email</code>, <code>telegram</code>, <code>slack</code>, <code>discord</code>, <code>pagerduty</code>, <code>webhook</code>.</p>
        <pre><code>&#123;
  "name": "ops-telegram",
  "channel_type": "telegram",
  "config": &#123;
    "bot_token": "7123456789:AAH1bGciOiJSUzI1NiIs",
    "chat_id": "-1001234567890"
  &#125;
&#125;</code></pre>
        <p>Email config takes <code>recipients</code>; Slack and Discord take <code>webhook_url</code>; PagerDuty takes <code>routing_key</code>; webhook takes <code>url</code> and optional <code>secret</code>.</p>
      </div>

      <div class="endpoint">
        <h3>List channels</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/channels</code> <span class="auth-badge">Authenticated</span></div>
      </div>

      <div class="endpoint">
        <h3>Get channel</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/channels/:channel_id</code> <span class="auth-badge">Authenticated</span></div>
        <p>Sensitive fields like bot tokens are partially masked in GET responses.</p>
      </div>

      <div class="endpoint">
        <h3>Update channel</h3>
        <div class="method-path"><span class="method method-put">PUT</span> <code>/channels/:channel_id</code> <span class="auth-badge">Write scope</span></div>
      </div>

      <div class="endpoint">
        <h3>Delete channel</h3>
        <div class="method-path"><span class="method method-delete">DELETE</span> <code>/channels/:channel_id</code> <span class="auth-badge">Write scope</span></div>
      </div>

      <div class="endpoint">
        <h3>Test channel</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/channels/:channel_id/test</code> <span class="auth-badge">Write scope</span></div>
        <p>
          Send a test notification through the channel. <strong>Always 200</strong>, with
          <code>{"{ success: boolean, error?: string }"}</code>. A delivery failure is a
          <em>result</em>, not an API error: the test ran, and what it found out was that the
          channel did not accept the message. Read <code>success</code>; when it is
          <code>false</code>, <code>error</code> carries the upstream reason. An earlier version of
          this page documented a 502 here, which the endpoint has never returned.
        </p>
      </div>
    </section>

    <section id="alerts">
      <h2><a href="#alerts" class="anchor-link">#</a>Alerts</h2>

      <div class="endpoint">
        <h3>Acknowledge alert</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/alerts/:alert_id/acknowledge</code> <span class="auth-badge">Write scope</span></div>
        <p>Silence notifications for the current occurrence; does not disable the rule. Event-type alerts (e.g. <code>unexpected_reboot</code>) auto-clear acknowledgement when a new occurrence stacks onto the card.</p>
      </div>

      <div class="endpoint">
        <h3>Resolve alert</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/alerts/:alert_id/resolve</code> <span class="auth-badge">Write scope</span></div>
        <p>Manually resolve an alert without waiting for the underlying condition to clear. Mostly used for event-type alerts (24-hour TTL otherwise) and for force-clearing stuck state alerts.</p>
      </div>

      <div class="endpoint">
        <h3>List muted rules</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/servers/:server_id/mutes</code> <span class="auth-badge">Authenticated</span></div>
      </div>

      <div class="endpoint">
        <h3>Mute a rule</h3>
        <div class="method-path"><span class="method method-post">POST</span> <code>/servers/:server_id/mutes</code> <span class="auth-badge">Write scope</span></div>
        <p>Mute one alert rule for this server, one rule per request. Any currently active alert of that type is resolved immediately. Returns the updated <code>muted_rules</code> list.</p>
        <pre><code>&#123; "alert_type": "disk_space_high" &#125;</code></pre>
      </div>

      <div class="endpoint">
        <h3>Unmute a rule</h3>
        <div class="method-path"><span class="method method-delete">DELETE</span> <code>/servers/:server_id/mutes</code> <span class="auth-badge">Write scope</span></div>
        <p>Remove one rule from the muted list, one rule per request. Returns the updated <code>muted_rules</code> list.</p>
        <pre><code>&#123; "alert_type": "disk_space_high" &#125;</code></pre>
      </div>
    </section>

    <section id="billing">
      <h2><a href="#billing" class="anchor-link">#</a>Billing</h2>
      <p>Historical. As of August 2026 Glassmkr no longer charges for anything: both the hosted service and a self-hosted instance are free, and no server is suspended for payment reasons. The billing endpoints remain routable so existing integrations do not break, but no account carries a paid subscription. See the <a href="/billing-policy">billing policy</a>.</p>

      <div class="endpoint">
        <h3>Billing status</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/billing/status</code> <span class="auth-badge">Authenticated</span></div>
        <p>Returns the account's billing record: plan, billing-period bounds, payment-method state, and the count of servers disabled for a missing card. Since August 2026 these fields describe historical subscription state where one existed.</p>
      </div>

      <div class="endpoint">
        <h3>Other billing endpoints</h3>
        <p><code>POST /billing/checkout</code> is retired and answers 410 to every call: no new subscription can be created. <code>POST /billing/portal</code>, <code>POST /billing/resume</code> and <code>POST /billing/downgrade</code> remain for accounts with a residual legacy subscription to manage or cancel it.</p>
      </div>
    </section>

    <section id="meta">
      <h2><a href="#meta" class="anchor-link">#</a>Meta</h2>

      <div class="endpoint">
        <h3>Version</h3>
        <div class="method-path"><span class="method method-get">GET</span> <code>/version</code> <span class="auth-badge">Public</span></div>
        <p>Returns the latest published Crucible version and the minimum supported version.</p>
        <pre><code>&#123;
  "crucible": &#123;
    "latest": "0.13.3",
    "min_supported": "0.7.0",
    "changelog_url": "https://github.com/glassmkr/crucible/releases"
  &#125;,
  "dashboard": &#123; "version": "1.0.0" &#125;
&#125;</code></pre>
        <p>The <code>latest</code> value is sourced from the npm registry's <code>@glassmkr/crucible</code> <code>latest</code> dist-tag.</p>
      </div>
    </section>

    <section id="rate-limits">
      <h2><a href="#rate-limits" class="anchor-link">#</a>Rate limits</h2>
      <p>Token-bucket limiter applied as four overlapping tiers (first failure wins; failures still cost a token on the per-IP debit so brute-force probing burns budget):</p>
      <div class="table-scroll"><table>
        <thead><tr><th>Tier</th><th>Capacity</th><th>Refill</th><th>Applies to</th></tr></thead>
        <tbody>
          <tr><td>Per-IP</td><td>100</td><td>10/sec</td><td>Every request, including pre-auth.</td></tr>
          <tr><td>Per-key</td><td>1000</td><td>100/sec</td><td>Authenticated requests, scoped to one collector or account key.</td></tr>
          <tr><td>Per-account</td><td>5000</td><td>500/sec</td><td>All authenticated requests within one customer.</td></tr>
          <tr><td>POST /servers</td><td>100</td><td>100/hour</td><td>Server registration sub-limit.</td></tr>
          <tr><td>DELETE /servers/:id</td><td>100</td><td>100/hour</td><td>Deletion sub-limit.</td></tr>
          <tr><td>POST /servers/:id/rotate-key</td><td>10</td><td>10/hour</td><td>Key-rotation sub-limit.</td></tr>
        </tbody>
      </table></div>
      <p>The ingest endpoint enforces a per-server soft limit of one push per 55 seconds (returns 429, separate from the token-bucket layer). When token-bucket-rate-limited, the API returns <code>429 Too Many Requests</code> with a <code>Retry-After</code> header.</p>
    </section>

    <section id="pagination">
      <h2><a href="#pagination" class="anchor-link">#</a>Pagination</h2>
      <p>List endpoints (currently <code>GET /servers</code>) use opaque cursor pagination: pass <code>?limit=</code> (1-100, default 100) and the previous response's <code>next_cursor</code> as <code>?cursor=</code>. <code>next_cursor</code> is <code>null</code> on the final page.</p>
    </section>

    <section id="idempotency">
      <h2><a href="#idempotency" class="anchor-link">#</a>Idempotency</h2>
      <p><code>POST /servers</code> honors an <code>Idempotency-Key</code> header (1-255 printable ASCII). The first response (success or deterministic 4xx) is cached for 24 hours; replays return the cached response with an <code>Idempotency-Replayed: true</code> header. Concurrent retries with the same key while the original is still in flight return 409.</p>
      <p class="note">Last verified: 2026-05-22 against Crucible v0.13.3 and Dashboard v1.0. For tier-gating details see <a href="/docs/api/tier-gating">/docs/api/tier-gating</a>.</p>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 980px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
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
  h2 { font-size: 1.5rem; color: var(--text-primary); margin-bottom: 1rem; position: relative; }
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 0.5rem; margin-bottom: 0.5rem; }
  p { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.75rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(255, 107, 53, 0.35); border-radius: var(--radius-md); padding: 12px 14px; overflow-x: auto; margin: 0.5rem 0 1rem; }
  pre code { font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.55; color: var(--text-primary); background: transparent; padding: 0; white-space: pre; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  .note { font-size: 0.85rem; color: var(--text-tertiary); font-style: italic; margin-top: 1rem; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; font-size: 0.875rem; }
  thead th { text-align: left; padding: 8px 12px; color: var(--text-tertiary); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--surface-border); }
  tbody td { padding: 7px 12px; color: var(--text-secondary); border-bottom: 1px solid rgba(61, 54, 48, 0.4); vertical-align: top; }
  .endpoint { margin: 1.75rem 0; padding-bottom: 1.25rem; border-bottom: 1px solid var(--surface-border); }
  .endpoint:last-child { border-bottom: none; }
  .method-path { display: flex; align-items: center; gap: 0.6rem; margin: 0.4rem 0; flex-wrap: wrap; }
  .method { display: inline-block; padding: 0.18rem 0.55rem; border-radius: var(--radius-md); font-weight: 700; font-size: 0.78rem; font-family: var(--font-mono); }
  .method-get { background: rgba(74, 222, 128, 0.12); color: #4ade80; }
  .method-post { background: rgba(96, 165, 250, 0.12); color: #60a5fa; }
  .method-put { background: rgba(250, 204, 21, 0.12); color: #facc15; }
  .method-delete { background: rgba(248, 113, 113, 0.12); color: #f87171; }
  .auth-badge { font-size: 0.78rem; padding: 0.18rem 0.5rem; background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); color: var(--text-tertiary); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    table, thead th, tbody td { font-size: 12px; }
    code, pre code { font-size: 12px; }
  }
</style>
