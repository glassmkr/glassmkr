<script lang="ts">
  // /vs/datadog: comparison page per CONTENT_TRANCHE_2 spec
  // (2026-06-25). Content matches the reference implementation
  // drafted in the spec verbatim, adjusted only for Svelte template
  // markup and shared component imports.
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs Datadog: bare-metal monitoring without the per-host scaling problem"
  description="Honest comparison: Glassmkr (open-source bare-metal monitoring, free self-hosted or hosted) vs Datadog (full observability platform, per-host per-product pricing). Last verified 2026-08-25."
  articleDescription="Honest comparison of Glassmkr (open-source bare-metal monitoring, free to self-host) and Datadog (full observability platform, per-host per-product pricing). Updated 2026-08-25."
  slug="datadog"
  competitorName="Datadog"
  competitorUrl="https://www.datadoghq.com"
  ogTitle="Glassmkr vs Datadog"
  ogDescription="Free, self-hostable bare-metal monitoring vs Datadog's per-host per-product pricing."
  orgUrl="https://glassmkr.com"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS DATADOG</p>
    <h1>Glassmkr vs Datadog: bare-metal monitoring without the per-host scaling problem.</h1>
    <p class="vs-subhead">Both detect what’s wrong with your infrastructure. Only one is free, open source, and self-hostable end to end.</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with Datadog.</p>

    <div class="vs-tldr">
      <p>
        Datadog is a full observability platform built for cloud workloads, with per-host pricing that scales from $15/host/month (Infrastructure Pro, annual billing) up to $41/host/month (DevSecOps Enterprise, on-demand) <sup><a href="#fn1">1</a></sup>. Glassmkr is a focused open-source bare-metal monitoring tool, free in both deployment forms: self-hosted (AGPL-3.0-only, no node limits) or the hosted instance at app.glassmkr.com (10-node per-account cap) <sup><a href="#fn-glassmkr">G</a></sup>.
      </p>
      <p>
        If you run bare-metal infrastructure and don’t need APM, RUM, log management, or security posture monitoring, the monitoring line item disappears entirely: Glassmkr costs nothing, whichever way you run it.
      </p>
      <p>
        If you need a unified observability platform across cloud workloads, containers, applications, and security, Datadog covers more ground.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>What’s the same</h2>
    <p>
      Both products do infrastructure monitoring at their core. Both ship agents that run on your servers. Both detect failure conditions and route alerts to notification channels. Both have dashboards, alert rules, and integrations with the tools your team already uses.
    </p>
    <p>
      Both can monitor Linux servers running on bare metal. Both support multi-channel alerting (Slack, email, PagerDuty, webhooks).
    </p>
    <p>If you only need monitoring, either product can do the job.</p>
  </section>

  <section class="vs-section">
    <h2>What’s different</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="Datadog comparison, scrolls horizontally"><table class="vs-table">
      <thead>
        <tr><th>Dimension</th><th>Datadog</th><th>Glassmkr</th></tr>
      </thead>
      <tbody>
        <tr><td>Pricing model</td><td>Per host, per product module</td><td>Free; no per-host pricing at all</td></tr>
        <tr><td>Price</td><td>From $15/host/month (Pro, annual) <sup><a href="#fn1">1</a></sup></td><td>Free (self-hosted, AGPL-3.0-only) / Free (hosted, 10-node cap) <sup><a href="#fn-glassmkr">G</a></sup></td></tr>
        <tr><td>Free tier</td><td>5 hosts, 1-day retention <sup><a href="#fn1">1</a></sup></td><td>Everything: all {ruleCount} rules + all channels; self-hosted has no node limits</td></tr>
        <tr><td>Agent license</td><td>Apache 2.0 <sup><a href="#fn2">2</a></sup></td><td>AGPL-3.0-only <sup><a href="#fn3">3</a></sup></td></tr>
        <tr><td>Backend / dashboard</td><td>Proprietary SaaS; no self-host option</td><td>AGPL-3.0-only, self-hostable end to end</td></tr>
        <tr><td>Pricing scope</td><td>Infrastructure monitoring is one of 30+ product modules; each priced separately</td><td>Single product, no price</td></tr>
        <tr><td>Custom metrics included</td><td>100/host (Pro) or 200/host (Enterprise) <sup><a href="#fn1">1</a></sup></td><td>Included; nothing is metered</td></tr>
        <tr><td>Container monitoring included</td><td>5/host (Pro) or 10/host (Enterprise); $0.002/container/hour beyond <sup><a href="#fn1">1</a></sup></td><td>All containers included</td></tr>
        <tr><td>Optimized for</td><td>Cloud workloads, ephemeral containers, microservices</td><td>Bare-metal servers, opinionated thresholds</td></tr>
        <tr><td>Bare-metal-specific signals</td><td>Available as integrations</td><td>Built-in ({ruleCount} rules covering IPMI, RAID, ZFS, SMART, BMC)</td></tr>
        <tr><td>Hidden costs</td><td>Documented on Datadog's own pricing page <sup><a href="#fn1">1</a></sup>: log retention, span ingestion, container scaling, custom events beyond allotment</td><td>None; there is no bill in either deployment form</td></tr>
      </tbody>
    </table>
    </div>

    <h3>The pricing model question</h3>
    <p>
      Datadog’s pricing is per host, per product. If you want infrastructure monitoring with logs, APM, and security posture, you stack three independent per-host charges. A single Datadog host running Infrastructure Pro + APM + Log Management (annual) is $15 + $31 + log volume costs <sup><a href="#fn1">1</a></sup>.
    </p>
    <p>
      This works fine for cloud workloads where teams pay per usage and the value is high enough to absorb the cost. For bare-metal fleets where you’re monitoring stable hardware that doesn’t generate much application telemetry, the per-host model means you pay for product modules you don’t fundamentally need.
    </p>
    <p>
      Glassmkr is one product with no price attached. Self-hosted (AGPL-3.0-only) is free with no node limits; the hosted instance at app.glassmkr.com is free up to 10 nodes per account. There is no tier and no module stacking because there is no bill.
    </p>
  </section>

  <section class="vs-section">
    <h2>Pricing comparison</h2>

    <h3>Datadog (Infrastructure Pro, annual billing)</h3>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Datadog pricing comparison, scrolls horizontally"><table class="vs-table vs-pricing-table">
      <thead>
        <tr><th>Hosts</th><th>Datadog Monthly</th><th>Glassmkr Monthly</th><th>Difference</th></tr>
      </thead>
      <tbody>
        <tr><td>5</td><td>Free <sup><a href="#fn1">1</a></sup></td><td>Free</td><td>$0</td></tr>
        <tr><td>10</td><td>$150</td><td>Free</td><td>$150/mo</td></tr>
        <tr><td>25</td><td>$375</td><td>Free (self-hosted)</td><td>$375/mo</td></tr>
        <tr><td>50</td><td>$750</td><td>Free (self-hosted)</td><td>$750/mo</td></tr>
        <tr><td>100</td><td>$1,500</td><td>Free (self-hosted)</td><td>$1,500/mo</td></tr>
        <tr><td>200</td><td>$3,000</td><td>Free (self-hosted)</td><td>$3,000/mo</td></tr>
      </tbody>
    </table>
    </div>
    <p>
      Datadog rate: $15/host/month, annual billing, Infrastructure Pro tier, no add-ons <sup><a href="#fn1">1</a></sup>.<br />
      Glassmkr rate: free in both deployment forms; self-hosted (AGPL-3.0-only) has no node limits, hosted at app.glassmkr.com is free with a 10-node per-account cap <sup><a href="#fn-glassmkr">G</a></sup>.
    </p>

    <h3>Add-on cost considerations</h3>
    <p>
      Datadog’s Infrastructure Pro at $15/host includes basic infrastructure monitoring. Adding APM is +$31/host/month (annual) <sup><a href="#fn1">1</a></sup>. Adding Log Management is $0.10/GB ingested plus indexing fees at $1.70/million events (annual, 15-day retention) <sup><a href="#fn1">1</a></sup>. Custom metrics beyond the 100/host allotment are billed separately <sup><a href="#fn1">1</a></sup>.
    </p>
    <p>Glassmkr includes the full product in both free deployment forms. There are no add-ons because there’s only one product, and no bill for them to land on.</p>
  </section>

  <section class="vs-section">
    <h2>When Datadog is the right choice</h2>
    <p>We’re honest about cases where Datadog fits better:</p>

    <h3>You need APM, RUM, or log management alongside monitoring.</h3>
    <p>Glassmkr does monitoring. Datadog is an observability platform. If you have applications generating traces and logs and you want one tool that correlates them with infrastructure metrics, Datadog covers that ground.</p>

    <h3>Your infrastructure is primarily cloud workloads.</h3>
    <p>Datadog’s strength is monitoring ephemeral containers, AWS/GCP/Azure services, Kubernetes clusters, and microservices. Their integrations for cloud-native infrastructure are extensive.</p>

    <h3>You have a security team using Cloud Security Posture Management.</h3>
    <p>Datadog’s DevSecOps SKUs combine infrastructure monitoring with CSPM, CIEM, and workload protection. If you need these in the same tool, Datadog ships them.</p>

    <h3>You have a Datadog enterprise contract already in place.</h3>
    <p>If your organization already pays for Datadog and has it deployed, the marginal cost of adding bare-metal hosts is just per-host pricing. Glassmkr’s savings show up most clearly when you’d otherwise be paying full per-host pricing from scratch.</p>
  </section>

  <section class="vs-section">
    <h2>When Glassmkr is the right choice</h2>

    <h3>You run bare-metal infrastructure and want the monitoring line item to be zero.</h3>
    <p>Free self-hosted with no node limits, or free hosted up to 10 nodes. Nothing to forecast for finance, nothing to justify for procurement.</p>

    <h3>You want monitoring without becoming a Datadog expert.</h3>
    <p>Datadog has 30+ product modules and a learning curve. Glassmkr has one product with {ruleCount} alert rules that work out of the box.</p>

    <h3>You care about reading the agent that runs on your servers.</h3>
    <p>Crucible is AGPL-3.0-only; ~150-line installer; runs as non-root user. The Datadog Agent is Apache 2.0 <sup><a href="#fn2">2</a></sup> (also open source, and the more permissive license of the two) but the install footprint and operational complexity are different orders of magnitude.</p>

    <h3>You don’t need APM, log management, RUM, or SIEM.</h3>
    <p>If your monitoring needs are infrastructure-focused, you’re paying for products you don’t use with Datadog.</p>

    <h3>You operate in Europe and care about data residency.</h3>
    <p>Glassmkr's servers are in the Netherlands and its data controller is registered in the Czech Republic; the network operator's legal entity is UK-registered, which the <a href="/trust">trust page</a> spells out rather than rounding all three to "EU". Datadog has EU regions but the company is US-based. And if residency rules are strict, you can self-host Glassmkr so the data never leaves your racks at all.</p>
  </section>

  <section class="vs-section">
    <h2>Self-hosting</h2>
    <p>
      This is a category difference, not a feature difference. Datadog cannot be self-hosted: the agent is open source, but it is useless without the closed backend, and your telemetry lives on their infrastructure. Glassmkr is self-hostable end to end: the dashboard and the Crucible agent are AGPL-3.0-only, and the whole stack runs from a single docker-compose file. No data leaves your infrastructure unless you choose the hosted instance.
    </p>
    <p><a href="/docs/self-hosting">Self-host in 10 minutes</a>.</p>
  </section>

  <VsCta variant="mid" />

  <section class="vs-section">
    <h2>Migration: switching from Datadog to Glassmkr</h2>
    <p>If you’re moving from Datadog to Glassmkr, here’s the conceptual mapping:</p>

    <p><strong>Datadog Host → Glassmkr Node.</strong> Same unit of accounting. One server is one node.</p>

    <p><strong>Datadog Monitors → Glassmkr Alert Rules.</strong> Datadog requires you to author monitors. Glassmkr ships {ruleCount} rules enabled by default. You’ll likely want to disable some that don’t apply to your fleet (e.g. ZFS rules on Btrfs systems).</p>

    <p><strong>Datadog Dashboards → Glassmkr Server Detail Pages.</strong> Per-server, with metrics charts, alert state, and remediation guidance on each alert. Custom dashboards aren’t a Glassmkr feature (yet); if you have custom Datadog dashboards you depend on, evaluate whether Glassmkr’s per-server view covers your use case before migrating.</p>

    <p><strong>Datadog Integrations → N/A in scope.</strong> Glassmkr doesn’t ingest from AWS/GCP/Azure APIs, application traces, or external SaaS. It monitors what its agent observes on the server. If you depend on Datadog’s cloud integrations for half your visibility, Glassmkr doesn’t replace that part.</p>

    <p><strong>Datadog Notification Channels → Glassmkr Notification Channels.</strong> Telegram, Slack, Discord, PagerDuty, email, webhooks. Migration is reconfiguring routing once.</p>

    <h3>Operational migration steps</h3>
    <ol>
      <li>Install Crucible on a few servers (free, whichever deployment form you pick). Verify alerts fire as expected on hardware that Glassmkr already covers.</li>
      <li>Verify the remediation guidance on each alert matches what your runbooks describe. Tune any thresholds that fire too sensitively for your environment.</li>
      <li>Confirm notification channels deliver to the right places.</li>
      <li>Expand fleet-wide. Run both products in parallel for 30 days to compare alert coverage.</li>
      <li>Decommission Datadog Infrastructure Pro on bare-metal hosts (keep on hosts where you genuinely use it).</li>
    </ol>

    <p>Email <a href="mailto:simon@glassmkr.com">simon@glassmkr.com</a> if you want help with the migration. Glassmkr is one operator; you’ll get a real reply from the person who wrote the code.</p>
  </section>

  <div class="vs-footer-note">
    Last verified: 2026-08-25. Sources cited inline. Glassmkr is not affiliated with Datadog. Pricing and features change frequently; verify directly with Datadog before making purchasing decisions.
  </div>

  <div class="vs-footnotes">
    <ol>
      <li id="fn1">Datadog pricing page, <a href="https://www.datadoghq.com/pricing/">www.datadoghq.com/pricing</a> (verified 2026-08-25). All cited prices reference Infrastructure Pro tier with annual billing unless otherwise noted.</li>
      <li id="fn2">Datadog Agent license, <a href="https://github.com/DataDog/datadog-agent/blob/main/LICENSE">github.com/DataDog/datadog-agent/blob/main/LICENSE</a> (verified 2026-08-25). Apache License 2.0.</li>
      <li id="fn3">Crucible license, <a href="https://github.com/glassmkr/crucible/blob/main/LICENSE">github.com/glassmkr/crucible/blob/main/LICENSE</a> (verified 2026-08-29). AGPL-3.0-only.</li>
      <li id="fn-glassmkr">Glassmkr pricing page, <a href="https://glassmkr.com/pricing">glassmkr.com/pricing</a> (verified 2026-08-23). Free self-hosted (AGPL-3.0-only, no node limits); hosted free with a 10-node per-account cap.</li>
    </ol>
  </div>

  <VsCta variant="bottom" competitor="Datadog" />

  <ComparisonFooter current="datadog" />
</article>
