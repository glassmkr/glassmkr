<script lang="ts">
  // /vs/newrelic per CONTENT_TRANCHE_2 spec (2026-06-25).
  // Differentiator: Glassmkr is monitoring-focused; New Relic is
  // APM-focused observability platform.
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs New Relic: bare-metal hardware monitoring vs APM-first observability"
  description="Glassmkr (free, open source, bare-metal hardware signals) vs New Relic (data-ingest + user-based APM platform, 780+ integrations). Last verified 2026-08-25."
  headline="Glassmkr vs New Relic: bare-metal monitoring vs APM-first observability platform"
  articleDescription="Comparison of Glassmkr (free open-source bare-metal hardware monitoring) and New Relic (data-ingest + user-based APM platform). Last verified 2026-08-25."
  slug="newrelic"
  competitorName="New Relic"
  competitorUrl="https://newrelic.com"
  ogTitle="Glassmkr vs New Relic"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS NEW RELIC</p>
    <h1>Glassmkr vs New Relic: bare-metal monitoring vs APM-first observability platform.</h1>
    <p class="vs-subhead">Both can monitor servers. They differ on what they’re built around: hardware-level signals vs application telemetry.</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with New Relic.</p>

    <div class="vs-tldr">
      <p>
        New Relic uses a data-ingest + user-based pricing model: 100 GB/month free, $0.40/GB Original (or $0.60/GB Data Plus) beyond <sup><a href="#fn1">1</a></sup>. Free tier includes 1 full platform user; paid tiers (Standard up to 5 full users; Pro at ~$349/user/year; Enterprise custom) scale with users <sup><a href="#fn1">1</a></sup>. The platform is APM-first: agents for Java/Node/Python/Ruby/Go/.NET instrument application code <sup><a href="#fn4">4</a></sup>.
      </p>
      <p>
        Glassmkr is open-source bare-metal monitoring, free in both deployment forms: self-hosted (AGPL-3.0-only, no node limits) or hosted at app.glassmkr.com (10-node per-account cap) <sup><a href="#fn-glassmkr">G</a></sup>. {ruleCount} alert rules tuned for hardware failure modes.
      </p>
      <p>
        Different products for different problems. If APM is the primary need, New Relic. If bare-metal hardware monitoring is the primary need, Glassmkr.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>What’s the same</h2>
    <p>
      Both have infrastructure monitoring as a product. Both ship agents that collect Linux server metrics. Both have alerting, dashboards, and multi-channel notifications. Both have free tiers.
    </p>
  </section>

  <section class="vs-section">
    <h2>What’s different</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="New Relic comparison, scrolls horizontally"><table class="vs-table">
      <thead><tr><th>Dimension</th><th>New Relic</th><th>Glassmkr</th></tr></thead>
      <tbody>
        <tr><td>Primary product</td><td>APM-first observability platform; infrastructure is one of 50+ capabilities <sup><a href="#fn1">1</a></sup></td><td>Bare-metal monitoring; single focused product</td></tr>
        <tr><td>Pricing model</td><td>Data-ingest (GB) + user-based <sup><a href="#fn1">1</a></sup></td><td>Free (self-hosted, AGPL-3.0-only) / Free (hosted, 10-node cap) <sup><a href="#fn-glassmkr">G</a></sup></td></tr>
        <tr><td>Free tier</td><td>100 GB/mo ingest, 1 full user, 8-day default retention (minimum) <sup><a href="#fn1">1</a></sup></td><td>Everything: all {ruleCount} rules + all channels; self-hosted has no node limits</td></tr>
        <tr><td>Paid tiers</td><td>Standard (≤5 full users, ~$99/user/mo additional); Pro (~$349/user/yr); Enterprise custom <sup><a href="#fn1">1</a></sup></td><td>None; both deployment forms are free</td></tr>
        <tr><td>Self-hostable</td><td>No; SaaS backend only</td><td>Yes; AGPL-3.0-only end to end, one docker-compose file</td></tr>
        <tr><td>Data overage</td><td>$0.40/GB (Original) or $0.60/GB (Data Plus) <sup><a href="#fn1">1</a></sup></td><td>None</td></tr>
        <tr><td>APM agents</td><td>Java/Node/Python/Ruby/Go/.NET: instrument application code <sup><a href="#fn4">4</a></sup></td><td>None</td></tr>
        <tr><td>Browser + mobile + synthetic monitoring</td><td>Yes: Digital Experience Monitoring <sup><a href="#fn5">5</a></sup></td><td>No</td></tr>
        <tr><td>Query language</td><td>NRQL (SQL-like for all telemetry) <sup><a href="#fn3">3</a></sup></td><td>None: pre-built rules</td></tr>
        <tr><td>AIOps / applied intelligence</td><td>Yes: AI-recommended alerts, alert correlation, incident enrichment <sup><a href="#fn6">6</a></sup></td><td>Furnace (AI assist); remediation-focused</td></tr>
        <tr><td>Integrations</td><td>780+ <sup><a href="#fn1">1</a></sup></td><td>Bare-metal focused; ~10 integration surfaces</td></tr>
        <tr><td>SMART / IPMI / RAID / ECC</td><td>Not listed in Infrastructure Agent default metrics <sup><a href="#fn2">2</a></sup></td><td>Native via Crucible agent</td></tr>
      </tbody>
    </table>
    </div>

    <h3>The APM-first design</h3>
    <p>
      New Relic’s strength is application-performance monitoring. Agents for Java, Node, Python, Ruby, Go, and .NET instrument application code <sup><a href="#fn4">4</a></sup>. Traces, browser RUM, mobile, synthetic checks, and logs-in-context all integrate <sup><a href="#fn5">5</a></sup>. Infrastructure monitoring is one module among 50+ <sup><a href="#fn1">1</a></sup>.
    </p>
    <p>
      Glassmkr does not do APM. It doesn’t instrument application code, doesn’t collect traces, doesn’t monitor browsers or mobile apps. It collects bare-metal hardware signals and routes alerts on them. If your monitoring needs span application performance and infrastructure, New Relic covers more ground.
    </p>

    <h3>Bare-metal coverage</h3>
    <p>
      The New Relic Infrastructure Agent collects <code>SystemSample</code> (CPU, memory, disk, network), <code>ProcessSample</code>, <code>StorageSample</code> (filesystem capacity), <code>NetworkSample</code>, <code>ContainerSample</code>, and <code>InfrastructureEvent</code> <sup><a href="#fn2">2</a></sup>. The default-metrics documentation does not list SMART attributes, hardware RAID state, IPMI sensors, or ECC memory errors <sup><a href="#fn2">2</a></sup>.
    </p>
    <p>
      Glassmkr ships native coverage for SMART (with NVMe wear bands), IPMI sensors (fan, PSU redundancy, BMC SEL), RAID state, ZFS pool health, and ECC errors.
    </p>

    <h3>The pricing-model question</h3>
    <p>
      New Relic’s data-ingest + user pricing fits APM-heavy workloads where the telemetry is application traces (rich, variable volume). For bare-metal monitoring where the agent ships modest metric volume but many alert evaluations, the model creates uncertainty: a noisier deployment or a logs-heavy host can spike ingest unexpectedly. Glassmkr removes the variance entirely: there is no ingest meter and no bill, in either deployment form.
    </p>
  </section>

  <section class="vs-section">
    <h2>When New Relic is the right choice</h2>

    <h3>APM is the primary need.</h3>
    <p>You instrument application code. You need traces, browser RUM, mobile, synthetic, and infrastructure unified under one tool with NRQL across all of it <sup><a href="#fn3">3</a></sup>. Glassmkr doesn’t do APM.</p>

    <h3>The team is full-stack, not just infrastructure.</h3>
    <p>If developers and SREs share the monitoring tool, New Relic’s breadth matches the audience.</p>

    <h3>You have budget for per-user pricing.</h3>
    <p>$349/user/year on Pro is reasonable for full-stack teams but expensive for infrastructure-only fleets. Glassmkr charges neither per user nor per node.</p>

    <h3>You need FedRAMP / HIPAA-eligible monitoring.</h3>
    <p>New Relic offers FedRAMP Moderate and HIPAA eligibility, but only on the Enterprise edition with the Data Plus data option (not the standard Original data tier) <sup><a href="#fn1">1</a></sup>. Glassmkr doesn’t currently.</p>
  </section>

  <section class="vs-section">
    <h2>When Glassmkr is the right choice</h2>

    <h3>Monitoring is the primary need; APM is not.</h3>
    <p>If you don’t instrument application code (or your apps are off the shelf and don’t generate APM traces), you’re paying for capabilities you don’t use.</p>

    <h3>You need bare-metal hardware-level signals.</h3>
    <p>SMART, IPMI, RAID, ECC. New Relic’s Infrastructure Agent doesn’t list these in its default metric inventory <sup><a href="#fn2">2</a></sup>.</p>

    <h3>You want the monitoring line item gone.</h3>
    <p>Free self-hosted (AGPL-3.0-only, no node limits) or free hosted (10-node cap). No ingest-volume variance, no user-count scaling, no bill.</p>

    <h3>Your team is infrastructure-focused, not full-stack.</h3>
    <p>If only SREs / ops engineers use the tool, the user-count basis of New Relic Pro doesn’t fit. Glassmkr has no seats to count.</p>
  </section>

  <section class="vs-section">
    <h2>Self-hosting</h2>
    <p>
      New Relic exists only as a SaaS backend; its agents are open source but useless without it, and your telemetry lives on their infrastructure. Glassmkr is self-hostable end to end: the dashboard and the Crucible agent are AGPL-3.0-only, and the whole stack runs from a single docker-compose file. No data leaves your infrastructure unless you choose the hosted instance.
    </p>
    <p><a href="/docs/self-hosting">Self-host in 10 minutes</a>.</p>
  </section>

  <VsCta variant="mid" />

  <section class="vs-section">
    <h2>Migration: switching from New Relic to Glassmkr</h2>

    <p><strong>New Relic Hosts → Glassmkr Nodes.</strong> Same unit.</p>

    <p><strong>New Relic Alert Conditions → Glassmkr alert rules.</strong> Conditions targeting <code>SystemSample</code> metrics map naturally; conditions on APM transactions, error rates, browser monitors, or NRQL on application-trace data have no Glassmkr equivalent.</p>

    <p><strong>New Relic Workflows → Glassmkr notification channels.</strong> Reconfigure routing once.</p>

    <p><strong>New Relic APM data → not migrated.</strong> Glassmkr doesn’t do APM. If your New Relic usage is mostly application telemetry, Glassmkr replaces only the infrastructure-monitoring portion of your bill.</p>

    <p><strong>NRQL queries → not migrated.</strong> No query language. Glassmkr’s value proposition is "pre-built rules, don’t need queries"; if your team relies on ad-hoc NRQL, that’s a real workflow change.</p>

    <p>Realistic migration scenario: keep New Relic for APM and full-stack observability. Add Glassmkr for hardware-level bare-metal visibility, or migrate just the infrastructure-only hosts to remove user-tier and ingest pressure.</p>
  </section>

  <div class="vs-footer-note">
    Last verified: 2026-08-25. Sources cited inline. Glassmkr is not affiliated with New Relic. Pricing and features change frequently; verify directly with New Relic before making purchasing decisions.
  </div>

  <div class="vs-footnotes">
    <ol>
      <li id="fn1">New Relic pricing page, <a href="https://newrelic.com/pricing">newrelic.com/pricing</a> (verified 2026-08-25). Includes free tier (100 GB ingest + 1 full user), Standard / Pro / Enterprise tiers, data overage ($0.40 Original or $0.60 Data Plus).</li>
      <li id="fn2">New Relic Infrastructure default monitoring data, <a href="https://docs.newrelic.com/docs/infrastructure/manage-your-data/data-instrumentation/default-infrastructure-monitoring-data/">docs.newrelic.com/docs/infrastructure/manage-your-data/data-instrumentation/default-infrastructure-monitoring-data</a> (verified 2026-08-25). SMART, IPMI, RAID, ECC not listed.</li>
      <li id="fn3">NRQL introduction, <a href="https://docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/">docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language</a> (verified 2026-08-25).</li>
      <li id="fn4">New Relic APM agents (Java/Node/Python/Ruby/Go/.NET), <a href="https://docs.newrelic.com/docs/logs/logs-context/get-started-logs-context/">docs.newrelic.com/docs/logs/logs-context/get-started-logs-context</a> (verified 2026-08-25).</li>
      <li id="fn5">New Relic Platform overview (Digital Experience Monitoring: browser, mobile, synthetic), <a href="https://newrelic.com/platform">newrelic.com/platform</a> (verified 2026-08-25).</li>
      <li id="fn6">New Relic Applied Intelligence / AIOps, <a href="https://newrelic.com/platform/applied-intelligence">newrelic.com/platform/applied-intelligence</a> (verified 2026-08-25).</li>
      <li id="fn-glassmkr">Glassmkr pricing page, <a href="https://glassmkr.com/pricing">glassmkr.com/pricing</a> (verified 2026-08-23). Free self-hosted (AGPL-3.0-only, no node limits); hosted free with a 10-node per-account cap.</li>
    </ol>
  </div>

  <VsCta variant="bottom" competitor="New Relic" />

  <ComparisonFooter current="newrelic" />
</article>
