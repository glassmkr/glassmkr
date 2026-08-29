<script lang="ts">
  // /vs/cloudwatch per CONTENT_TRANCHE_2 spec (2026-06-25).
  // Differentiator: Glassmkr is bare-metal hardware monitoring;
  // CloudWatch is AWS-only metric-streaming observability.
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs AWS CloudWatch: bare-metal hardware monitoring vs AWS-native observability"
  description="Glassmkr (free, open source, hardware-level SMART/IPMI/RAID/ECC) vs AWS CloudWatch ($0.30/custom metric/mo, deep AWS service integration, no hardware-level signals). Last verified 2026-08-25."
  articleDescription="Comparison of Glassmkr (free open-source monitoring, hardware-level signals) and AWS CloudWatch ($0.30/custom metric/month, deep AWS integration, no SMART/IPMI/RAID/ECC). Last verified 2026-08-25."
  slug="cloudwatch"
  competitorName="Amazon CloudWatch"
  competitorUrl="https://aws.amazon.com/cloudwatch/"
  ogTitle="Glassmkr vs AWS CloudWatch"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS AWS CLOUDWATCH</p>
    <h1>Glassmkr vs AWS CloudWatch: bare-metal hardware monitoring vs AWS-native observability.</h1>
    <p class="vs-subhead">Different scopes, different deployments. The comparison is more "different tool" than "alternative tool."</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with Amazon Web Services.</p>

    <div class="vs-tldr">
      <p>
        Amazon CloudWatch is AWS’s native observability service. Per-metric pricing ($0.30/custom metric/month for the first 10,000, scaling down to $0.05 above 250,000) <sup><a href="#fn1">1</a></sup>. Always-free tier covers 10 custom metrics + 10 alarms + 5 GB logs <sup><a href="#fn1">1</a></sup>. The CloudWatch Agent is MIT-licensed and open source <sup><a href="#fn3">3</a></sup>.
      </p>
      <p>
        Glassmkr is open-source bare-metal hardware monitoring, free in both deployment forms: self-hosted (AGPL-3.0-only, no node limits) or hosted at app.glassmkr.com (10-node per-account cap) <sup><a href="#fn-glassmkr">G</a></sup>. {ruleCount} alert rules tuned for hardware failure modes.
      </p>
      <p>
        The two tools have less overlap than they first appear. CloudWatch is the right answer when you’re fully on AWS. Glassmkr is the right answer when you run physical infrastructure (colo, on-prem, owned racks) and need hardware-level signals CloudWatch doesn’t expose.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>What’s the same</h2>
    <p>
      Both have agents that collect OS-level metrics (CPU, memory, disk, network). Both support alerting, dashboards, and log/metric retention. Both have free tiers. Both have programmatic APIs.
    </p>
  </section>

  <section class="vs-section">
    <h2>What’s different</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="CloudWatch comparison, scrolls horizontally"><table class="vs-table">
      <thead><tr><th>Dimension</th><th>AWS CloudWatch</th><th>Glassmkr</th></tr></thead>
      <tbody>
        <tr><td>Optimized for</td><td>AWS workloads (EC2, RDS, Lambda, ECS, EKS, ALB, S3, ...)</td><td>Bare-metal Linux servers (any host)</td></tr>
        <tr><td>Pricing: custom metrics</td><td>$0.30/metric/mo first 10k; $0.10 (10k-250k); $0.05 (250k+) <sup><a href="#fn1">1</a></sup></td><td>Included; Glassmkr is free <sup><a href="#fn-glassmkr">G</a></sup></td></tr>
        <tr><td>Pricing: alarms</td><td>$0.10 per standard-resolution alarm/mo <sup><a href="#fn1">1</a></sup></td><td>Included; nothing is metered</td></tr>
        <tr><td>Pricing: logs</td><td>$0.50/GB ingest, $0.03/GB/mo storage; Logs Insights queries billed per GB scanned <sup><a href="#fn1">1</a></sup></td><td>N/A (Glassmkr doesn’t ingest logs)</td></tr>
        <tr><td>Free tier</td><td>10 custom metrics, 10 alarms, 5 GB logs <sup><a href="#fn1">1</a></sup></td><td>Everything: all {ruleCount} rules + all channels; self-hosted has no node limits, hosted is capped at 10 nodes</td></tr>
        <tr><td>Self-hostable</td><td>No; CloudWatch is an AWS service, the backend cannot leave AWS</td><td>Yes; AGPL-3.0-only end to end, one docker-compose file</td></tr>
        <tr><td>Agent license</td><td>MIT <sup><a href="#fn3">3</a></sup></td><td>AGPL-3.0-only (Crucible)</td></tr>
        <tr><td>Agent platform support</td><td>Linux/Windows/macOS; collects OS metrics + logs + (v1.300025.0+) OpenTelemetry/X-Ray traces <sup><a href="#fn2">2</a></sup></td><td>Linux server</td></tr>
        <tr><td>SMART / IPMI / RAID / ECC</td><td>NOT collected: outside the agent’s data model <sup><a href="#fn2">2</a></sup></td><td>Built-in via Crucible agent</td></tr>
        <tr><td>AWS-service-native metrics</td><td>Deep: EC2, RDS, Lambda, etc. publish natively without an agent</td><td>None: Glassmkr observes only what its agent collects on the server</td></tr>
        <tr><td>Outside AWS</td><td>Agent runs on-prem; data flows to AWS; architecture assumes AWS control plane</td><td>Independent of any cloud provider</td></tr>
      </tbody>
    </table>
    </div>

    <h3>The agent question</h3>
    <p>
      The CloudWatch Agent is open source (MIT) and collects OS-level metrics: CPU times/usage, memory (<code>/proc/meminfo</code>-derived), disk, network, processes, swap, ethtool counters <sup><a href="#fn2">2</a></sup>. It also collects logs, StatsD/collectd, and (v1.300025.0+) OpenTelemetry/X-Ray traces. Metrics ship as custom metrics under the <code>CWAgent</code> namespace and bill accordingly <sup><a href="#fn1">1</a></sup>.
    </p>
    <p>
      Verified absent from the agent’s metric list <sup><a href="#fn2">2</a></sup>: SMART attributes, IPMI sensors, RAID array state, ECC corrected/uncorrectable counters, PSU/fan/thermal hardware sensors. Hardware-level visibility is not part of CloudWatch’s data model: even on EC2 bare-metal (<code>.metal</code>) instances <sup><a href="#fn4">4</a></sup> where the guest has direct hardware access.
    </p>

    <h3>Bare-metal EC2</h3>
    <p>
      EC2 <code>.metal</code> instances (Nitro System) give the guest OS direct hardware access with no hypervisor <sup><a href="#fn4">4</a></sup>. However, the CloudWatch Agent installed on those guests still collects only the OS-level metrics enumerated above. No SMART/IPMI/RAID/ECC metrics are surfaced by CloudWatch’s data model regardless of host. If you run EC2 <code>.metal</code> and want hardware-level visibility, Glassmkr fills the gap.
    </p>
  </section>

  <section class="vs-section">
    <h2>When CloudWatch is the right choice</h2>

    <h3>You’re fully on AWS.</h3>
    <p>One console spanning EC2 + RDS + Lambda + Logs + X-Ray traces. Native service metrics without an agent. IAM-tied access. If your stack is AWS, CloudWatch is the path of least resistance.</p>

    <h3>You want unified logs + metrics + traces.</h3>
    <p>CloudWatch Logs Insights, ServiceLens, Container Insights, X-Ray. Glassmkr doesn’t do logs or traces.</p>

    <h3>You have low custom-metric volume.</h3>
    <p>For ≤10 custom metrics + alarms per host, the always-free tier covers most of it <sup><a href="#fn1">1</a></sup>. If everything you monitor fits that free tier and lives on AWS, adding a second tool is overhead you don’t need.</p>

    <h3>You’re an AWS-shop, not a physical-infrastructure-shop.</h3>
    <p>If you don’t run any servers you can physically touch, CloudWatch’s scope matches your reality.</p>
  </section>

  <section class="vs-section">
    <h2>When Glassmkr is the right choice</h2>

    <h3>You run physical infrastructure.</h3>
    <p>Colo, on-prem, owned racks, bare-metal in datacenters. CloudWatch can monitor these hosts via the agent but doesn’t expose hardware-level signals.</p>

    <h3>You need SMART, IPMI, RAID, ECC visibility.</h3>
    <p>Hardware-level signals CloudWatch’s data model doesn’t cover, even on EC2 <code>.metal</code> instances <sup><a href="#fn2">2</a></sup>. Glassmkr exposes them natively.</p>

    <h3>You’re explicitly diversifying away from AWS-coupled tooling.</h3>
    <p>If "not AWS-locked" is a posture (multi-cloud, on-prem migration, vendor risk), Glassmkr is cloud-agnostic.</p>

    <h3>You don’t want a metered bill at all.</h3>
    <p>CloudWatch’s metric/alarm/log billing is granular and can surprise. Glassmkr has no metering: free self-hosted with no node limits, free hosted up to 10 nodes.</p>
  </section>

  <section class="vs-section">
    <h2>Self-hosting</h2>
    <p>
      CloudWatch cannot be self-hosted; it exists only as an AWS service, and your telemetry lives in your AWS account by definition. Glassmkr is self-hostable end to end: the dashboard and the Crucible agent are AGPL-3.0-only, and the whole stack runs from a single docker-compose file, on any infrastructure, with no data leaving it unless you choose the hosted instance.
    </p>
    <p><a href="/docs/self-hosting">Self-host in 10 minutes</a>.</p>
  </section>

  <VsCta variant="mid" />

  <section class="vs-section">
    <h2>Migration: switching from CloudWatch to Glassmkr</h2>

    <p><strong>CloudWatch custom metrics → Glassmkr per-node metrics.</strong> Same kind of OS-level visibility; Glassmkr adds the hardware-level signals CloudWatch doesn’t expose.</p>

    <p><strong>CloudWatch Alarms → Glassmkr alert rules.</strong> Glassmkr’s {ruleCount} rules cover bare-metal failure modes that CloudWatch alarms wouldn’t typically target (because CloudWatch can’t see the signals). Many CloudWatch alarms on EC2 hosts have no Glassmkr equivalent because they were monitoring AWS-service-native metrics (RDS IOPS, ALB target health, Lambda errors) that Glassmkr doesn’t observe.</p>

    <p><strong>CloudWatch Logs → not migrated.</strong> Glassmkr doesn’t ingest application logs. If your CloudWatch usage is dominated by logs + Logs Insights queries, Glassmkr doesn’t cover that workload.</p>

    <p><strong>X-Ray traces → not migrated.</strong> No equivalent. Glassmkr doesn’t do APM/tracing.</p>

    <p>Realistic migration scenario: keep CloudWatch for AWS-service-native metrics (RDS, Lambda, ALB) and logs/traces. Add Glassmkr for hardware-level visibility on EC2 <code>.metal</code> hosts or on-prem servers where CloudWatch’s agent misses the bare-metal signals.</p>
  </section>

  <div class="vs-footer-note">
    Last verified: 2026-08-25. Sources cited inline. Glassmkr is not affiliated with Amazon Web Services. Pricing and features change frequently; verify directly with AWS before making purchasing decisions.
  </div>

  <div class="vs-footnotes">
    <ol>
      <li id="fn1">Amazon CloudWatch Pricing, <a href="https://aws.amazon.com/cloudwatch/pricing/">aws.amazon.com/cloudwatch/pricing</a> (verified 2026-08-25). All prices reference us-east-1 pay-as-you-go.</li>
      <li id="fn2">CloudWatch Agent: metrics collected, <a href="https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-collected-by-CloudWatch-agent.html">docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-collected-by-CloudWatch-agent.html</a> (verified 2026-08-25). Verified absent: SMART, IPMI, RAID, ECC, PSU/fan/thermal hardware sensors.</li>
      <li id="fn3">amazon-cloudwatch-agent GitHub repository (MIT licensed), <a href="https://github.com/aws/amazon-cloudwatch-agent">github.com/aws/amazon-cloudwatch-agent</a> (verified 2026-08-25).</li>
      <li id="fn4">EC2 Bare Metal Instances announcement ("Direct Access to Hardware"), <a href="https://aws.amazon.com/blogs/aws/new-amazon-ec2-bare-metal-instances-with-direct-access-to-hardware/">aws.amazon.com/blogs/aws/new-amazon-ec2-bare-metal-instances-with-direct-access-to-hardware</a> (verified 2026-08-25). AWS Nitro System (bare metal instances let customers "bring their own hypervisor or have no hypervisor"), <a href="https://aws.amazon.com/ec2/nitro/">aws.amazon.com/ec2/nitro</a> (verified 2026-08-25).</li>
      <li id="fn-glassmkr">Glassmkr pricing page, <a href="https://glassmkr.com/pricing">glassmkr.com/pricing</a> (verified 2026-08-23). Free self-hosted (AGPL-3.0-only, no node limits); hosted free with a 10-node per-account cap.</li>
    </ol>
  </div>

  <VsCta variant="bottom" competitor="AWS CloudWatch" />

  <ComparisonFooter current="cloudwatch" />
</article>
