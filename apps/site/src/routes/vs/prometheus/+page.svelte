<script lang="ts">
  // /vs/prometheus per CONTENT_TRANCHE_2 spec (2026-06-25).
  // Differentiator: Glassmkr is opinionated and managed; Prometheus
  // is DIY and self-hosted. Honest about where Prometheus wins
  // (cloud-native, Kubernetes-heavy, PromQL flexibility).
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs Prometheus: finished bare-metal monitoring vs DIY observability stack"
  description={`Glassmkr's ${ruleCount} opinionated bare-metal rules vs Prometheus's DIY stack (server + Alertmanager + exporters + Grafana). Both open source. Last verified 2026-08-25.`}
  headline="Glassmkr vs Prometheus: opinionated bare-metal monitoring vs DIY observability stack"
  articleDescription="Comparison of Glassmkr (open-source finished bare-metal monitoring, opinionated defaults) and Prometheus (Apache 2.0 self-hosted observability with PromQL). Last verified 2026-08-25."
  slug="prometheus"
  competitorName="Prometheus"
  competitorUrl="https://prometheus.io"
  ogTitle="Glassmkr vs Prometheus"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS PROMETHEUS</p>
    <h1>Glassmkr vs Prometheus: finished bare-metal monitoring vs DIY observability stack.</h1>
    <p class="vs-subhead">Both are open source and free to self-host. Only one ships {ruleCount} opinionated rules out of the box.</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with the Prometheus project.</p>

    <div class="vs-tldr">
      <p>
        Prometheus is an Apache 2.0 open-source monitoring system <sup><a href="#fn1">1</a></sup>, free to self-host, with a pull-based scrape model, PromQL query language, and a separate Alertmanager component for routing <sup><a href="#fn4">4</a></sup>. It ships no opinionated default alert rules and no bundled dashboarding UI (a basic expression browser ships); you assemble the stack from Prometheus server, exporters, Alertmanager, and Grafana.
      </p>
      <p>
        Glassmkr is a finished bare-metal monitoring product, open source and free in both deployment forms: self-hosted (AGPL-3.0-only end to end, one docker-compose file) or hosted at app.glassmkr.com (free, 10-node per-account cap) <sup><a href="#fn-glassmkr">G</a></sup>. {ruleCount} alert rules ship tuned and enabled.
      </p>
      <p>
        Prometheus wins on DIY flexibility and Kubernetes-native deployments. Glassmkr wins when you don’t want to operate a five-component observability stack.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>What’s the same</h2>
    <p>
      Both are designed to monitor Linux servers and route alerts. Both are open source and free to self-host (Prometheus is Apache 2.0; Glassmkr is AGPL-3.0-only end to end). Both can monitor bare-metal hardware via the right exporters / collectors. Both integrate with Slack, PagerDuty, email, and webhooks for alert delivery.
    </p>
  </section>

  <section class="vs-section">
    <h2>What’s different</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="Prometheus comparison, scrolls horizontally"><table class="vs-table">
      <thead><tr><th>Dimension</th><th>Prometheus</th><th>Glassmkr</th></tr></thead>
      <tbody>
        <tr><td>Deployment model</td><td>Self-hosted; you assemble and operate the stack</td><td>Self-hosted (one docker-compose file) or free hosted instance; agent on each server</td></tr>
        <tr><td>Architecture</td><td>Pull-based scraping over HTTP <sup><a href="#fn1">1</a></sup></td><td>Push-based agent reports to dashboard</td></tr>
        <tr><td>Query language</td><td>PromQL <sup><a href="#fn1">1</a></sup></td><td>None (alerts are pre-authored rules)</td></tr>
        <tr><td>Default alert rules</td><td>None opinionated; rules are user-authored</td><td>{ruleCount} rules ship enabled and tuned</td></tr>
        <tr><td>Bare-metal SMART / IPMI / RAID / ECC</td><td>RAID (`mdadm`) and ECC (`edac`) native to node_exporter; SMART/IPMI via separate exporters (`smartctl_exporter`, `ipmi_exporter`) <sup><a href="#fn7">7</a> <a href="#fn8">8</a></sup>; no unified rule set</td><td>Built-in via the agent</td></tr>
        <tr><td>UI</td><td>Grafana (separate project) for dashboards</td><td>Built-in dashboard (self-hosted or at app.glassmkr.com)</td></tr>
        <tr><td>Storage</td><td>Built-in TSDB; default 15-day retention, configurable <sup><a href="#fn3">3</a></sup></td><td>Dashboard-side in ClickHouse; 90-day snapshot retention by default, set as a table TTL you can change on your own instance</td></tr>
        <tr><td>License (server / agent)</td><td>Apache 2.0 <sup><a href="#fn2">2</a></sup></td><td>AGPL-3.0-only (dashboard and agent)</td></tr>
        <tr><td>Pricing</td><td>Free to self-host; managed variants exist (see below)</td><td>Free (self-hosted, AGPL-3.0-only) / Free (hosted, 10-node cap) <sup><a href="#fn-glassmkr">G</a></sup></td></tr>
      </tbody>
    </table>
    </div>

    <h3>The operational stack</h3>
    <p>
      Running Prometheus yourself means operating multiple components together. A bare-metal deployment typically combines: Prometheus server (scraping + TSDB), Alertmanager (routing + grouping + silences) <sup><a href="#fn4">4</a></sup>, Grafana (dashboards, separate project), and one or more exporters per host (node_exporter for OS metrics; smartctl_exporter for SMART <sup><a href="#fn7">7</a></sup>; ipmi_exporter for BMC sensors <sup><a href="#fn8">8</a></sup>). You own version upgrades, TSDB sizing, scrape config and service discovery, PromQL alert-rule authoring, dashboard authoring, and HA if you need it.
    </p>
    <p>
      Pushgateway exists for short-lived batch jobs but the docs warn it becomes a single point of failure and doesn’t auto-expire series <sup><a href="#fn5">5</a></sup>, so for stable hosts the recommended path is still scrape-based.
    </p>

    <h3>Managed Prometheus variants</h3>
    <p>
      If you don’t want to self-host, the main commercial options as of 2026-08-25:
    </p>
    <ul>
      <li>Grafana Cloud Free: 10k active series, 14-day retention <sup><a href="#fn6">6</a></sup></li>
      <li>Grafana Cloud Pro: from $19/month platform fee + $6.50 / 1k series beyond the included allotment, 13-month retention <sup><a href="#fn6">6</a></sup></li>
      <li>Amazon Managed Service for Prometheus: $0.90 per 10M ingested samples (first 2B/mo), $0.03/GB storage, $0.10 per billion query samples; optional collector $0.04/hr <sup><a href="#fn9">9</a></sup></li>
    </ul>
    <p>
      These cover the Prometheus server + storage half of the stack; you still operate exporters, write rules, and configure dashboards/alerting on top.
    </p>
  </section>

  <section class="vs-section">
    <h2>Bare-metal coverage in detail</h2>
    <p>
      node_exporter ships ~50 default collectors covering CPU, memory, disk, network, filesystems, hwmon, thermal, uname, mdadm (RAID), and edac (ECC), but does not include SMART or IPMI collectors out of the box.
    </p>
    <p>
      SMART and IPMI are provided by separate prometheus-community projects: <a href="https://github.com/prometheus-community/smartctl_exporter">smartctl_exporter</a> <sup><a href="#fn7">7</a></sup> and <a href="https://github.com/prometheus-community/ipmi_exporter">ipmi_exporter</a> <sup><a href="#fn8">8</a></sup>, smartctl_exporter under Apache 2.0 and ipmi_exporter under MIT, each installed, configured, and upgraded independently. RAID and ECC metrics are exposed by node_exporter's default mdadm and edac collectors; what is DIY is the alerting, since no unified opinionated rule set ships for bare-metal hardware faults: operators write their own PromQL alert rules.
    </p>
  </section>

  <section class="vs-section">
    <h2>When Prometheus is the right choice</h2>

    <h3>You’re in a Kubernetes-heavy environment.</h3>
    <p>Prometheus’s service discovery for Kubernetes is excellent. The ecosystem (kube-state-metrics, kube-prometheus-stack Helm chart, ServiceMonitor CRDs) is built around it.</p>

    <h3>You want full DIY observability with PromQL.</h3>
    <p>PromQL is expressive and well-documented. If you’re comfortable writing queries and want full control over alert logic, Prometheus is the right tool.</p>

    <h3>You already operate a Prometheus stack.</h3>
    <p>Adding bare-metal hosts to an existing stack is cheaper than introducing a new vendor. Glassmkr’s value shows up most when you’d otherwise be building the stack from scratch.</p>

    <h3>You need very-long-term retention with downsampling.</h3>
    <p>Thanos or Cortex on top of Prometheus give you petabyte-scale, multi-year retention. Glassmkr keeps 90 days of snapshots by default, and self-hosted operators can raise that by editing the ClickHouse table TTL, but there is no downsampling story to match.</p>
  </section>

  <section class="vs-section">
    <h2>When Glassmkr is the right choice</h2>

    <h3>You don’t have time to operate a 5-component observability stack.</h3>
    <p>Prometheus + Alertmanager + Grafana + node_exporter + smartctl_exporter + ipmi_exporter is six things to install, configure, version-upgrade, and TLS-secure. Glassmkr is one agent and a hosted dashboard.</p>

    <h3>You want opinionated defaults that match real bare-metal failure modes.</h3>
    <p>{ruleCount} rules ship tuned for SMART degradation, RAID state, NVMe wear, ECC errors, IPMI sensors, ZFS health. You don’t write PromQL; you accept the defaults or tune the few that don’t fit.</p>

    <h3>Your fleet is small-to-medium bare-metal, not cloud-native.</h3>
    <p>If you’re running ~10-200 servers without Kubernetes, the Prometheus stack’s value-to-complexity ratio is much lower than for cloud-native deployments.</p>

    <h3>Free is now a tie; effort is not.</h3>
    <p>Self-hosted Prometheus is free in software but the operational cost (storage, ops time, on-call) is real. Glassmkr is free too, in both deployment forms; the difference you keep is one compose file and finished rules instead of a stack to assemble.</p>
  </section>

  <section class="vs-section">
    <h2>Self-hosting</h2>
    <p>
      No openness argument here: Prometheus is Apache 2.0, a more permissive license than Glassmkr’s AGPL-3.0-only stack, and it has been free to self-host since day one. What Glassmkr’s self-hosted form offers instead is a finished product: one docker-compose file brings up the dashboard, storage, and alerting with {ruleCount} remediation-attached rules already enabled, where the Prometheus route means assembling server, Alertmanager, Grafana, and per-host exporters yourself. The Crucible agent installs with one command.
    </p>
    <p><a href="/docs/self-hosting">Self-host in 10 minutes</a>.</p>
  </section>

  <VsCta variant="mid" />

  <section class="vs-section">
    <h2>Migration: switching from Prometheus to Glassmkr</h2>

    <p><strong>Prometheus scrape targets → Glassmkr nodes.</strong> Each target host becomes a Glassmkr node.</p>

    <p><strong>node_exporter + smartctl_exporter + ipmi_exporter → Glassmkr Crucible agent.</strong> Three (or more) exporters collapse into one agent that ships the same signals.</p>

    <p><strong>PromQL alerting rules → Glassmkr’s {ruleCount} built-in rules.</strong> No rule authoring required; tune the defaults that don’t fit. If you have organization-specific PromQL rules with no Glassmkr equivalent (e.g. application-level metrics), Glassmkr doesn’t cover that workload.</p>

    <p><strong>Alertmanager receivers / routes → Glassmkr notification channels.</strong> Telegram, Slack, Discord, PagerDuty, email, webhook. Migration is reconfiguring routing once.</p>

    <p><strong>Grafana dashboards → Glassmkr server detail pages.</strong> Per-server view with metrics charts and alert state. Custom-built Grafana dashboards (cross-fleet, complex visualizations) don’t have a Glassmkr equivalent yet.</p>

    <p>The honest trade-off: you give up PromQL’s general-purpose expressiveness and full DIY observability in exchange for opinionated bare-metal defaults that work without a stack to operate.</p>
  </section>

  <div class="vs-footer-note">
    Last verified: 2026-08-25. Sources cited inline. Glassmkr is not affiliated with the Prometheus project. Pricing and features change frequently; verify directly with Prometheus / Grafana / AWS before making purchasing decisions.
  </div>

  <div class="vs-footnotes">
    <ol>
      <li id="fn1">Prometheus Overview, <a href="https://prometheus.io/docs/introduction/overview/">prometheus.io/docs/introduction/overview</a> (verified 2026-08-25).</li>
      <li id="fn2">Prometheus LICENSE (Apache 2.0), <a href="https://github.com/prometheus/prometheus/blob/main/LICENSE">github.com/prometheus/prometheus/blob/main/LICENSE</a> (verified 2026-08-25).</li>
      <li id="fn3">Prometheus TSDB storage and retention, <a href="https://prometheus.io/docs/prometheus/latest/storage/">prometheus.io/docs/prometheus/latest/storage</a> (verified 2026-08-25).</li>
      <li id="fn4">Alertmanager documentation, <a href="https://prometheus.io/docs/alerting/latest/alertmanager/">prometheus.io/docs/alerting/latest/alertmanager</a> (verified 2026-08-25).</li>
      <li id="fn5">Pushgateway use cases / cautions, <a href="https://prometheus.io/docs/practices/pushing/">prometheus.io/docs/practices/pushing</a> (verified 2026-08-25).</li>
      <li id="fn6">Grafana Cloud pricing, <a href="https://grafana.com/pricing/">grafana.com/pricing</a> (verified 2026-08-25).</li>
      <li id="fn7">smartctl_exporter (prometheus-community), <a href="https://github.com/prometheus-community/smartctl_exporter">github.com/prometheus-community/smartctl_exporter</a> (verified 2026-08-25).</li>
      <li id="fn8">ipmi_exporter (prometheus-community), <a href="https://github.com/prometheus-community/ipmi_exporter">github.com/prometheus-community/ipmi_exporter</a> (verified 2026-08-25).</li>
      <li id="fn9">Amazon Managed Service for Prometheus pricing, <a href="https://aws.amazon.com/prometheus/pricing/">aws.amazon.com/prometheus/pricing</a> (verified 2026-08-25).</li>
      <li id="fn-glassmkr">Glassmkr pricing page, <a href="https://glassmkr.com/pricing">glassmkr.com/pricing</a> (verified 2026-08-23). Free self-hosted (AGPL-3.0-only, no node limits); hosted free with a 10-node per-account cap.</li>
    </ol>
  </div>

  <VsCta variant="bottom" competitor="Prometheus" />

  <ComparisonFooter current="prometheus" />
</article>
