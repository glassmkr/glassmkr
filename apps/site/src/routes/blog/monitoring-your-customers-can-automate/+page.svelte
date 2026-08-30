<svelte:head>
  <title>Monitoring your customers can automate - Glassmkr Blog</title>
  <meta name="description" content="Dedicated servers ship with console access and traffic graphs; the layer that predicts hardware failure is usually the customer's problem to assemble. Every step of that layer, registering servers, installing the agent, routing and testing alert channels, is an API call, and that changes who can offer it." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/monitoring-your-customers-can-automate" />
  <meta property="og:title" content="Monitoring your customers can automate" />
  <meta property="og:description" content="The in-OS hardware-health layer for dedicated servers, provisioned like infrastructure: servers, agent, alert channels and delivery tests, all over one API." />
  <meta property="og:image" content="https://glassmkr.com/og/monitoring-your-customers-can-automate.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Monitoring your customers can automate" />
  <meta name="twitter:description" content="The in-OS hardware-health layer for dedicated servers, provisioned like infrastructure: servers, agent, alert channels and delivery tests, all over one API." />
  <meta name="twitter:image" content="https://glassmkr.com/og/monitoring-your-customers-can-automate.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/monitoring-your-customers-can-automate" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Monitoring your customers can automate",
    description: "Dedicated servers ship with console access and traffic graphs; the layer that predicts hardware failure is usually the customer's problem to assemble. Every step of that layer is an API call, and that changes who can offer it.",
    image: "https://glassmkr.com/og/monitoring-your-customers-can-automate.png?v=20260830",
    datePublished: "2026-07-16",
    dateModified: "2026-07-16",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/monitoring-your-customers-can-automate.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/monitoring-your-customers-can-automate",
    articleSection: "Product"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "Monitoring your customers can automate", item: "https://glassmkr.com/blog/monitoring-your-customers-can-automate" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">July 2026 · Product · 4 min read</p>
      <h1>Monitoring your customers can automate.</h1>
      <p class="lede">
        Dedicated servers come with console access and traffic graphs. The layer that predicts hardware failure is usually the customer’s problem to assemble. It doesn’t have to be: every step of that layer, including alert routing, is an API call.
      </p>
    </header>

    <h2>The boundary providers stop at</h2>

    <p>
      If you rent dedicated servers, your provider almost certainly gives you the out-of-band half of hardware visibility: IPMI or KVM access, power control, bandwidth graphs. That half is read from the BMC, outside your operating system, which is exactly why providers are comfortable offering it: nothing of theirs runs inside your machine.
    </p>

    <p>
      But the OS knows things the BMC never will. SMART attributes drifting on a disk that still reports PASSED. The correctable ECC error rate creeping up on one DIMM. NVMe wear percentage. A RAID member that quietly dropped. GPU XID events. Whether the kernel has a security update pending that needs a reboot. Most of the signal that <strong>predicts</strong> a failure, rather than reporting one, lives on the OS side of that boundary.
    </p>

    <p>
      So the in-OS half usually goes missing. The provider won’t install software inside your OS (correctly: it is your machine), and self-assembling that layer, node_exporter here, smartd there, an alertmanager config nobody wants to own, is the project everyone means to do after the outage.
    </p>

    <h2>What “automatable” has to mean</h2>

    <p>
      Glassmkr’s position is that this layer should be a product: install an agent, get curated bare-metal alert rules (68 of them, each with a <a href="/docs/rules">public catalog page</a>), route alerts where your team lives. For fleets, and especially for anyone offering monitoring as part of a platform, “product” has to mean automatable end to end. Not “has a metrics API”: every lifecycle step scriptable, including the one that usually hides behind dashboard clicks, alert-channel configuration.
    </p>

    <p>Here is the whole loop with one write-scoped account key:</p>

    <pre><code># 1. Register the server at provision time; its collector key returns once.
curl -sS -X POST https://app.glassmkr.com/api/v1/servers \
  -H "Authorization: Bearer $ACCT_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-cust4211-web01" \
  -d '&#123;"hostname":"cust4211-web01.example.net","tags":["cust-4211"]&#125;'

# 2. Install the agent on the host with that key.
curl -sf https://glassmkr.com/install.sh | sudo GLASSMKR_API_KEY="$COLLECTOR_KEY" bash

# 3. Route alerts where the team works, then prove delivery.
curl -sS -X POST https://app.glassmkr.com/api/v1/channels \
  -H "Authorization: Bearer $ACCT_KEY" \
  -H "Content-Type: application/json" \
  -d '&#123;"channel_type":"slack","name":"cust-4211","config":&#123;"webhook_url":"https://hooks.slack.com/services/..."&#125;&#125;'

# The test endpoint returns 200 with &#123;"success":false&#125; on a delivery failure,
# so assert on .success or a dead channel passes silently.
curl -sS -X POST "https://app.glassmkr.com/api/v1/channels/$CHANNEL_ID/test" \
  -H "Authorization: Bearer $ACCT_KEY" | jq -e '.success' >/dev/null \
  || &#123; echo "channel test failed: notification did not deliver"; exit 1; &#125;

# 4. Read health and alerts back into your own panel or ticketing.
curl -sS "https://app.glassmkr.com/api/v1/servers/$SERVER_ID/alerts?status=active" \
  -H "Authorization: Bearer $ACCT_KEY"</code></pre>

    <p>
      Two notes on running that safely. The account key is powerful (it can create servers across your account), so keep it in a secret manager and out of shell history and CI logs; it travels as a request header here, and as an argument to <code>enroll</code> below, so it is also briefly visible to local process listing on whatever host makes the call. And step 2 pipes the installer straight into <code>sudo</code> for brevity: if you would rather audit before running anything as root, that installer is ~150 lines of bash you can download and read first (the <a href="https://github.com/glassmkr/crucible">source is on GitHub</a>), then run; it is the same script either way.
    </p>

    <p>
      Step 3 is the piece people don’t expect. Notification channels, Slack, Discord, PagerDuty, Telegram, email and generic webhook, are created, updated, tested and deleted over the <a href="/docs/api#channels">API</a>, and each channel filters by alert priority. Nothing in the loop touches a browser, and all of it works on every plan.
    </p>

    <h2>Test the channel like you test a backup</h2>

    <p>
      The test endpoint deserves a sentence on its own. It doesn’t validate the shape of your config; it sends a real notification through the channel, and if delivery fails it returns an error carrying the upstream failure message. A Slack webhook that was valid at setup and revoked eight months later is the classic way to discover, mid-incident, that your alerting was write-only. Pipelines should assert on the test call the way they assert on a restore, not a backup.
    </p>

    <h2>The shorter path for host-run automation</h2>

    <p>
      If your provisioning is Ansible or cloud-init rather than a control plane calling REST, there is a shorter path: <code>glassmkr-crucible enroll --account-key "$ACCT_KEY"</code> on the host itself registers the server, obtains its collector key and starts reporting: one command in a post-install script. Hosts self-register keyed by a stable machine ID, so re-running the automation, or re-imaging the box, maps back to the same server instead of duplicating it. <code>enroll</code> uses the account key for that one registration call and does not write it to disk; only the per-server collector key lands on the host (mode 0600). Keep the account key in your automation's secret store, not baked into a machine image. The full guide with Ansible and cloud-init examples is at <a href="/docs/automated-onboarding">automated fleet onboarding</a>.
    </p>

    <h2>The part that has to be boring</h2>

    <p>
      An agent inside the OS earns scrutiny, especially on rented hardware, where two parties care what runs there. We keep that part deliberately boring: Crucible is MIT licensed, the <a href="https://github.com/glassmkr/crucible">source is on GitHub</a>, the installer is ~150 lines of bash, it runs as its own non-root user, communicates over HTTPS only, and ships metrics and alert state, plus small bounded diagnostic excerpts around a failure (for example the last journal lines of a failed service, or a matched kernel dmesg event): no bulk log streaming, no command output, no arbitrary file contents. The collector key that stays on the box can push that one server’s telemetry and nothing else.

    </p>

    <p class="license-note">Editorial note, August 2026: Crucible versions through 1.0.1 were MIT licensed. Version 1.1.0 and later are AGPL-3.0-only.</p>

    <h2>Who this is for</h2>

    <p>
      If you rent dedicated servers: all of the above works today, on any plan, including the free tier’s 3 nodes. Your provider doesn’t need to participate.
    </p>

    <p>
      And if you are on the other side of the counter, running a hosting platform: this is the layer your customers keep rediscovering the hard way. A provisioning pipeline can hand every new server over already monitored, with alerts already routed to the customer’s channel of choice. We wrote up how we think about that at <a href="/for-providers">glassmkr.com/for-providers</a>, and if you’d like to pilot it with us, email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a>.
    </p>

    <footer class="post-footer">
      <p>Published July 16, 2026. By Simon Rybisar.</p>
      <p>
        <a href="/blog">&larr; All posts</a>
      </p>
    </footer>
  </article>
</div>

<style>
  .license-note { font-size: 13px; color: var(--text-tertiary); border-left: 2px solid var(--surface-border); padding-left: 12px; line-height: 1.6; }
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
  .post pre {
    margin: 18px 0;
    padding: 16px 20px;
    background: var(--surface-subtle);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
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
