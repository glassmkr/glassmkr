<script lang="ts">
  // /for-providers per CC_SPEC_PROVIDER_MARKETING (2026-07-15). Audience:
  // dedicated-server / bare-metal hosting providers (the channel) and,
  // bottom-up, their end customers. Positioning reconciled from the
  // 2026-07-15 provider-market research: true-today claims only, no
  // partner-programme or white-label promises; pilot CTA over terms.
  import type { PageData } from "./$types";
  import ShowcaseServerDetail from "$lib/components/showcase/ShowcaseServerDetail.svelte";
  import rules from "$lib/data/rules.json";
  import "$lib/components/vertical.css";
  let { data }: { data: PageData } = $props();

  const serviceLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Hardware health monitoring for hosting providers and dedicated-server customers",
    provider: {
      "@type": "Organization",
      name: "Glassmkr",
      url: "https://glassmkr.com",
    },
    areaServed: { "@type": "Place", name: "Worldwide" },
    description:
      "The in-OS hardware-health layer for dedicated servers: SMART trends, ECC errors, PSU redundancy, GPU health. Enrollment, alert channels and alert reads over one API.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: "0",
      offerCount: 2,
      offers: [
        {
          "@type": "Offer",
          name: "Self-hosted",
          price: "0",
          priceCurrency: "USD",
          description: "AGPL-3.0-only, free forever, no node limits. The whole stack runs on your infrastructure with Docker Compose.",
        },
        {
          "@type": "Offer",
          name: "Hosted",
          price: "0",
          priceCurrency: "USD",
          description: "The maintained instance at app.glassmkr.com. Free, signups open, 10-node per-account cap.",
        },
      ],
    },
  });
</script>

<svelte:head>
  <title>Glassmkr for hosting providers: hardware-failure warnings before the ticket lands</title>
  <meta
    name="description"
    content="Give dedicated-server customers the in-OS hardware-health layer: SMART trends, ECC, PSU redundancy, GPU health. Enrollment, alert channels and alert reads over one API, hosted or self-hosted."
  />
  <link rel="canonical" href="https://glassmkr.com/for-providers" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/for-providers" />
  <meta property="og:title" content="Glassmkr for hosting providers" />
  <meta
    property="og:description"
    content="Hardware-failure warnings before the ticket lands. In-OS health for dedicated servers, automatable end to end over one API."
  />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260830" />

  {@html `<script type="application/ld+json">${serviceLd}</` + `script>`}
</svelte:head>

<article class="vertical">
  <section class="hero">
    <p class="eyebrow">FOR HOSTING PROVIDERS</p>
    <h1>Hardware-failure warnings before the ticket lands.</h1>
    <p class="subhead">
      The in-OS health layer for the dedicated servers you rent out: SMART trends, ECC errors, PSU redundancy, GPU health. Your customers, or your platform, wire it in over one API.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install in 2 minutes</a>
      <a href="https://github.com/glassmkr/crucible" class="btn btn-ghost btn-lg">View Crucible on GitHub<span class="mit-badge">AGPL-3.0-only</span></a>
    </div>
    <p class="cta-caption">Free hosted or self-hosted. Prove it on boxes you run yourself before offering it to customers.</p>

    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
      <p class="install-version">Crucible v{data.crucibleVersion} on npm</p>
    </div>
    <p class="cta-caption">
      Baking it into provisioning? Drop <code>glassmkr-crucible enroll</code> into your post-install or cloud-init: one account key, every host self-registers by machine ID. See <a href="/docs/automated-onboarding">automated fleet onboarding</a>.
    </p>
  </section>

  <section class="section">
    <h2>The problem</h2>
    <p>
      When a disk dies inside a customer’s dedicated server, the failure becomes your ticket: the emergency migration, the RMA, the customer who found out from an outage. Most of those failures gave notice first. Reallocated sectors climbing for weeks, correctable ECC errors trending up, a PSU quietly dropping out of redundancy.
    </p>
    <p>
      Provider tooling covers the out-of-band half well. IPMI and KVM access, power control, traffic graphs: table stakes, and most panels do them fine. What the customer doesn’t get is the in-OS half: SMART trend analysis, ECC counters, NVMe wear, RAID state, GPU reliability, kernel and security warnings, with alerting their team can route somewhere they’ll actually see it.
    </p>
    <p>
      So customers self-assemble that layer, or run without it and open a ticket when the box misbehaves. Glassmkr is that layer as a product: per-server, curated for bare metal, and automatable end to end, so it rides along with your provisioning instead of becoming one more platform to operate.
    </p>
  </section>

  <section class="section">
    <h2>How Glassmkr fits</h2>

    <div class="fit-grid">
      <div class="fit-item">
        <h3>The in-OS half of hardware health.</h3>
        <p>
          Your out-of-band tooling reads the BMC. Crucible reads the OS: SMART attributes and trends, ECC and MCE counters, NVMe wear, RAID and ZFS state, GPU XID/ECC/thermals, kernel and security signals. The rules are tuned for bare-metal failure modes, not cloud workloads.
        </p>
      </div>

      <div class="fit-item">
        <h3>Every step is an API call, including alert channels.</h3>
        <p>
          Enroll hosts during provisioning with one account key. Create, update, test and delete notification channels (Slack, Discord, PagerDuty, Telegram, email, generic webhook) over the API. Read alerts and trend warnings back into your own panel. No dashboard clicks anywhere in the loop, hosted or self-hosted.
        </p>
      </div>

      <div class="fit-item">
        <h3>Tickets that never get opened.</h3>
        <p>
          A customer who sees “reallocated sectors rising on disk 3” a week early schedules the swap in a window they choose. The other version of that story is a 3 a.m. outage, an emergency migration and an RMA under pressure: work your support team absorbs.
        </p>
      </div>

      <div class="fit-item">
        <h3>An agent your customers can audit.</h3>
        <p>
          Recommending third-party software inside customers’ machines is a trust decision. Crucible is open source (AGPL-3.0-only), published on npm, source on GitHub, runs as a non-root user, and sends telemetry and alert state, never bulk logs or command output. Every alert rule has a public catalog page, so customers can see exactly what it watches before installing anything.
        </p>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>What your customers see</h2>
    <p style="max-width:680px">Per-server health at a glance: the firing alert with a suggested fix first, then CPU, memory, network errors and IPMI sensors. This is the page a customer opens before they open a ticket.</p>
    <div style="margin-top:24px"><ShowcaseServerDetail crucibleVersion={data.crucibleVersion} /></div>
  </section>

  <section class="section">
    <h2>The whole lifecycle is an API</h2>
    <p>
      Monitoring that rides along with provisioning only works if every step is scriptable. Every step is. One write-scoped account key (<code>gmk_acct_live_</code>) drives the loop; the per-server collector keys it returns can only push that server’s telemetry.
    </p>
    <div class="api-steps">
      <pre><code># 1. Register the server at provision time; its collector key returns once.
curl -sS -X POST https://app.glassmkr.com/api/v1/servers \
  -H "Authorization: Bearer $ACCT_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-cust4211-web01" \
  -d '&#123;"hostname":"cust4211-web01.example.net","tags":["cust-4211"]&#125;'

# 2. Install the agent on the host with that key. Or skip step 1 entirely:
#    glassmkr-crucible enroll --account-key ... self-registers the host.
curl -sf https://glassmkr.com/install.sh | sudo GLASSMKR_API_KEY="$COLLECTOR_KEY" bash

# 3. Route alerts where the customer's team works, then prove delivery.
curl -sS -X POST https://app.glassmkr.com/api/v1/channels \
  -H "Authorization: Bearer $ACCT_KEY" \
  -H "Content-Type: application/json" \
  -d '&#123;"channel_type":"slack","name":"cust-4211","config":&#123;"webhook_url":"https://hooks.slack.com/services/..."&#125;&#125;'

#    The test endpoint returns 200 with &#123;"success":false&#125; when delivery fails,
#    so assert on .success to make a broken channel fail the pipeline.
curl -sS -X POST "https://app.glassmkr.com/api/v1/channels/$CHANNEL_ID/test" \
  -H "Authorization: Bearer $ACCT_KEY" | jq -e '.success' >/dev/null \
  || &#123; echo "channel test failed: notification did not deliver"; exit 1; &#125;

# 4. Read health and alerts back into your own panel or ticketing.
curl -sS "https://app.glassmkr.com/api/v1/servers/$SERVER_ID/alerts?status=active" \
  -H "Authorization: Bearer $ACCT_KEY"</code></pre>
    </div>
    <p>
      Channels are created, updated, tested and deleted over the same API: six types, each filterable by alert priority. All of it works on the hosted instance and self-hosted alike. Reference: <a href="/docs/api#channels">channels API</a>; guides: <a href="/docs/programmatic-api">programmatic API</a> and <a href="/docs/automated-onboarding">automated onboarding</a>.
    </p>
  </section>

  <section class="section">
    <h2>The failures it catches early</h2>
    <p>The rules a hosting fleet cares about most:</p>

    <ul class="rule-categories">
      <li><strong>Disk pre-failure</strong>: SMART reallocated and pending sectors trending, NVMe wear bands, NVMe Critical Warning; the signals that often precede a disk RMA by days or weeks</li>
      <li><strong>Memory pre-failure</strong>: correctable ECC error rate trending up, MCE events; the classic leading indicator of a DIMM swap</li>
      <li><strong>Power and cooling</strong>: PSU redundancy loss on multi-PSU chassis, fan failures, temperature thresholds, SEL critical entries from the BMC</li>
      <li><strong>Arrays and filesystems</strong>: degraded RAID, ZFS pool state, capacity projection (“this volume fills in 9 days”), read-only remounts</li>
      <li><strong>GPU fleets</strong>: XID events, GPU ECC, thermal throttling, PCIe link degradation, vBIOS drift between same-model cards in a host</li>
      <li><strong>Network</strong>: interface CRC and frame errors (usually a failing cable or SFP), link-speed drops, bond degradation</li>
      <li><strong>Security posture</strong>: SSH root login enabled, no firewall configured, pending kernel vulnerabilities; the state customers blame the provider for after an incident</li>
    </ul>

    <p class="rule-footer">
      {rules.length} rules total, each with a public catalog entry at <a href="/docs/rules">/docs/rules</a>. Full documentation at <a href="/docs">/docs</a>.
    </p>
  </section>

  <section class="section">
    <h2>The agent you can read</h2>
    <p>
      Anything a provider recommends installing inside a customer’s OS gets scrutiny, and it should. Crucible is AGPL-3.0-only and on npm; the source is at <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a> and the installer is ~150 lines of bash you can read first. The agent runs as the <code>glassmkr</code> user, never root, communicates over HTTPS only, and ships metrics and alert state, plus small bounded diagnostic excerpts around a failure (for example the last journal lines of a failed service, or a matched kernel dmesg event): no bulk log streaming, no command output, no arbitrary file contents.
    </p>
    <p>
      Keys are scoped to match. The collector key on each box can only push that one server’s telemetry, and with <code>enroll</code> the account key is used for a single registration call and never written to disk. What we hold and how we run it is on the <a href="/trust">trust page</a>.
    </p>
  </section>

  <section class="section">
    <h2>Or run the whole stack in your own racks</h2>
    <p>
      The dashboard is open source under AGPL-3.0-only (<a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a>) and the whole stack self-hosts with one docker compose file: dashboard, API, Postgres, ClickHouse. For a provider that changes the shape of the offer. Monitoring becomes something you run on your own infrastructure and hand to customers as part of the product, with no third party in the data path: their SMART trends, ECC counters and journal excerpts travel from their server to a dashboard you operate, and stop there.
    </p>
    <p>
      The lifecycle above is the same codebase either way, so provisioning automation written against the hosted API works unchanged against your own instance: same enrollment, same channels, same alert reads back into your panel. And when a customer asks where their telemetry goes, the answer is one sentence: it never leaves your network.
    </p>
    <p>
      <a href="/docs/self-hosting">Self-host in 10 minutes</a>. The hosted instance at app.glassmkr.com stays available if you would rather prove the value before running it yourself.
    </p>
  </section>

  <section class="section pricing-reminder">
    <h2>Pricing reminder</h2>
    <p>Free both ways: self-hosted under AGPL-3.0-only with no node limits, or the free hosted instance with a 10-node per-account cap. No card required to install.</p>
    <p class="pricing-note">
      Node counting is per server, not per GPU and not per gigabyte of telemetry.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install now</a>
      <a href="mailto:simon@glassmkr.com" class="btn btn-ghost btn-lg">Talk to us about a pilot</a>
    </div>
  </section>

  <section class="section cta-section">
    <h2>Prove it on your own fleet first.</h2>
    <p>
      Install on a few boxes you operate yourself and watch what fires before you put it in front of customers. The default rules need no configuration.
    </p>
    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
    </div>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Sign up free</a>
    </div>
    <div class="selfhost-block">
      <h3>Or self-host it</h3>
      <p>
        The whole stack is open source under AGPL-3.0-only and runs on your own hardware with one docker compose file;
        nothing leaves your network.
      </p>
      <pre><code>curl -fsSL https://glassmkr.com/install.sh | sudo bash -s -- \
  --api-key "gmk_cru_live_..." \
  --ingest-url "http://your-dashboard-host:3000/api/v1/ingest"</code></pre>
      <p><a href="/docs/self-hosting">Self-host in 10 minutes</a></p>
    </div>
    <p class="contact">
      Building this into a hosting platform, or interested in a design-partner pilot? Email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a> directly. Glassmkr is built and run by one operator who works directly with the people who run the infrastructure.
    </p>
  </section>
</article>

<style>
  /* Page-specific overrides; shared rules live in
     $lib/components/vertical.css. The .api-steps block styles the
     multi-line lifecycle snippet (the shared css only covers the
     one-line .install-block), matching the docs-page pre look. */
  .api-steps pre {
    background: #0d0d0d;
    border: 1px solid var(--surface-border);
    border-left: 3px solid rgba(255, 107, 53, 0.35);
    border-radius: var(--radius-md);
    padding: 18px 22px;
    overflow-x: auto;
    margin: 24px 0;
  }
  .api-steps pre code {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--text-primary);
    background: transparent;
    padding: 0;
    display: block;
  }
  .pricing-note {
    font-size: 14px; color: var(--text-tertiary);
    margin: 0 0 28px; font-style: italic;
  }
  /* The "Or self-host it" block in the closing CTA. */
  .selfhost-block {
    margin-top: 40px;
  }
  .selfhost-block h3 {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px;
  }
  .selfhost-block p {
    font-size: 14.5px;
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }
  .selfhost-block p:last-child {
    margin-bottom: 0;
  }
  .selfhost-block pre {
    background: #0d0d0d;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 18px 22px;
    overflow-x: auto;
    margin: 0 0 14px;
  }
  .selfhost-block pre code {
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--accent);
    background: transparent;
    padding: 0;
    display: block;
  }
  .selfhost-block a {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
</style>
