<script lang="ts">
  // /vs/checkmk per CONTENT_TRANCHE_2 spec (2026-06-25).
  // Differentiator: Glassmkr is opinionated and cloud-priced;
  // Checkmk is configurable and traditional-enterprise-priced.
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs Checkmk: opinionated open-source monitoring vs configurable enterprise platform"
  description={`Glassmkr (free, fully open source, ${ruleCount} opinionated bare-metal rules) vs Checkmk (2000+ integrations, free Community / paid Pro & Ultimate editions). Last verified 2026-08-25.`}
  articleDescription={`Comparison of Glassmkr (free open-source monitoring, ${ruleCount} opinionated bare-metal rules) and Checkmk (2000+ integrations, Community free / Pro EUR 190+/mo). Last verified 2026-08-25.`}
  slug="checkmk"
  competitorName="Checkmk"
  competitorUrl="https://checkmk.com"
  ogTitle="Glassmkr vs Checkmk"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS CHECKMK</p>
    <h1>Glassmkr vs Checkmk: opinionated open-source monitoring vs configurable enterprise platform.</h1>
    <p class="vs-subhead">Both monitor servers. They differ on breadth, edition models, and what an operator has to configure.</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with Checkmk GmbH.</p>

    <div class="vs-tldr">
      <p>
        Checkmk is a long-established enterprise monitoring platform (Munich-based, Nagios lineage). Editions as of 2026-03-17 are Community (free, self-hosted, ~100 hosts) <sup><a href="#fn1">1</a></sup>, Pro (from EUR 190/month annual), Ultimate (from EUR 275/month annual), Cloud SaaS (EUR 240/month), and Ultimate with Multi-Tenancy <sup><a href="#fn3">3</a></sup> <sup><a href="#fn4">4</a></sup>. Pricing is service-based (~30 services per host typical) <sup><a href="#fn1">1</a></sup>.
      </p>
      <p>
        Glassmkr is opinionated bare-metal monitoring, fully open source and free in both deployment forms: self-hosted (AGPL-3.0-only agent and dashboard, no node limits) or hosted at app.glassmkr.com (free, 10-node per-account cap) <sup><a href="#fn-glassmkr">G</a></sup>. {ruleCount} alert rules ship enabled and tuned, and there is no proprietary edition: every feature is in the open repo.
      </p>
      <p>
        Checkmk wins on breadth (2000+ official plugins <sup><a href="#fn8">8</a></sup>), distributed monitoring across regions, and enterprise features (RBAC, audit logs, LDAP/SAML). Glassmkr wins on time-to-value for focused bare-metal monitoring without the operational footprint.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>What’s the same</h2>
    <p>
      Both monitor Linux servers, route alerts, and have free tiers. Both cover SMART, IPMI, and common RAID controllers on bare metal. Both have multi-channel notifications.
    </p>
  </section>

  <section class="vs-section">
    <h2>What’s different</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="Checkmk comparison, scrolls horizontally"><table class="vs-table">
      <thead><tr><th>Dimension</th><th>Checkmk</th><th>Glassmkr</th></tr></thead>
      <tbody>
        <tr><td>Vendor</td><td>Checkmk GmbH (Munich, DE)</td><td>Glassmkr (Prague-based EU sole-trader)</td></tr>
        <tr><td>Editions (current)</td><td>Community / Pro / Ultimate / Cloud / Ultimate w/ Multi-Tenancy <sup><a href="#fn3">3</a></sup></td><td>One edition; every feature ships in the open repo</td></tr>
        <tr><td>Open-source license</td><td>Community edition (renamed from Raw) is GPL-2.0-only <sup><a href="#fn10">10</a></sup></td><td>AGPL-3.0-only (dashboard and agent)</td></tr>
        <tr><td>Proprietary edition</td><td>Yes: the Micro Core, agent bakery, and advanced reporting are commercial-only <sup><a href="#fn9">9</a></sup></td><td>None; there is no closed edition</td></tr>
        <tr><td>Pro pricing</td><td>From EUR 190/month annual; ~EUR 1.90/host equivalent at 100 hosts (about 3,000 services) <sup><a href="#fn1">1</a></sup></td><td>Free (self-hosted, AGPL-3.0-only) / Free (hosted, 10-node cap) <sup><a href="#fn-glassmkr">G</a></sup></td></tr>
        <tr><td>Cloud SaaS pricing</td><td>EUR 240/month base; ~EUR 7.20/host at 30 services <sup><a href="#fn1">1</a></sup></td><td>Hosted at app.glassmkr.com is free (10-node cap)</td></tr>
        <tr><td>Pricing unit</td><td>Service-based (~30 services per host typical) <sup><a href="#fn1">1</a></sup></td><td>Per node</td></tr>
        <tr><td>Plugin / integration count</td><td>2000+ <sup><a href="#fn8">8</a></sup></td><td>Bare-metal focused; ~10 integration surfaces</td></tr>
        <tr><td>Auto-discovery</td><td>Yes, services and network devices <sup><a href="#fn5">5</a></sup></td><td>Agent reports what it finds on the host</td></tr>
        <tr><td>Distributed monitoring</td><td>Central + hundreds of remote sites <sup><a href="#fn5">5</a></sup></td><td>Single dashboard; all agents report to it</td></tr>
        <tr><td>RBAC / audit / LDAP / SAML</td><td>RBAC in all editions; LDAP/AD from Pro; SAML SSO from Pro <sup><a href="#fn9">9</a></sup></td><td>Not currently surfaced as a feature</td></tr>
        <tr><td>SMART / IPMI</td><td>Built-in plugins (<code>smart</code>, <code>freeipmi</code>) <sup><a href="#fn6">6</a></sup> <sup><a href="#fn7">7</a></sup></td><td>Built-in via Crucible agent</td></tr>
        <tr><td>Opinionated bare-metal rules</td><td>No "best-practice rule pack"; thresholds operator-tuned</td><td>{ruleCount} rules tuned out of the box</td></tr>
      </tbody>
    </table>
    </div>

    <h3>Bare-metal coverage</h3>
    <p>
      Checkmk Community covers SMART (<code>smart</code> plugin via smartctl) and IPMI (via the <code>freeipmi</code>/<code>ipmi-sensors</code> integration), plus vendor-specific RAID controllers, PSU, and memory plugins <sup><a href="#fn6">6</a></sup> <sup><a href="#fn7">7</a></sup>. The coverage is broad but unopinionated: defaults are generic, and operators tune thresholds and rules to fit their fleet. ECC and ZFS specifics typically combine the generic Linux agent with hardware-vendor plugins or Checkmk Exchange contributions.
    </p>
    <p>
      Glassmkr ships {ruleCount} rules with pre-tuned thresholds and per-alert remediation guidance built into the dashboard. Coverage is narrower than Checkmk’s 2000+ plugins but tuned for "this is genuinely a problem worth waking someone up about."
    </p>

    <h3>Operational profile</h3>
    <p>
      Checkmk Community installs on Linux (RHEL/SLES/Debian/Ubuntu), as a virtual appliance, or in Docker. Setup is six steps per the docs <sup><a href="#fn2">2</a></sup>; an experienced operator can complete the install in under an hour. Real-world deployments add agent rollout, host inventory, rule tuning, and notification configuration on top. The SaaS Cloud edition removes server install but still requires agent deployment and rule configuration.
    </p>
    <p>
      Glassmkr’s hosted form removes all of the dashboard-side setup; the self-hosted form is one docker-compose file. Either way the rule-authoring work is gone ({ruleCount} rules ship enabled) and agent install is one bash command.
    </p>
  </section>

  <section class="vs-section">
    <h2>When Checkmk is the right choice</h2>

    <h3>You run a heterogeneous enterprise fleet.</h3>
    <p>Switches, storage arrays, hypervisors, network devices, application servers, databases. 2000+ plugins covers the vendor matrix Glassmkr doesn’t reach.</p>

    <h3>You need distributed monitoring across regions.</h3>
    <p>Checkmk supports central + hundreds of remote sites; basic distributed monitoring (Livestatus) is available in all editions including the free Raw edition, with the optimized Livestatus proxy commercial-only <sup><a href="#fn5">5</a></sup>. Glassmkr has a single dashboard model.</p>

    <h3>You have RBAC / audit / SSO requirements.</h3>
    <p>Compliance contexts that require role-based access, audit trails, LDAP/SAML integration. Checkmk ships role-based access in every edition, and LDAP/AD plus SAML SSO from Pro up <sup><a href="#fn9">9</a></sup>. Glassmkr doesn’t currently.</p>

    <h3>You prefer broad coverage over opinionated defaults.</h3>
    <p>If your monitoring philosophy is "monitor everything and tune from there," Checkmk’s breadth fits. Glassmkr’s philosophy is the opposite.</p>
  </section>

  <section class="vs-section">
    <h2>When Glassmkr is the right choice</h2>

    <h3>You want focused bare-metal monitoring without the operational footprint.</h3>
    <p>No Checkmk site to install, configure, version-upgrade, and TLS-secure. One agent, one hosted dashboard.</p>

    <h3>You don’t want an edition matrix.</h3>
    <p>Checkmk’s feature set fans out across Community, Pro, Ultimate, and Cloud, with the flagship pieces in the paid editions <sup><a href="#fn9">9</a></sup>. Glassmkr has one edition: everything it ships is in the open repo, free in both deployment forms.</p>

    <h3>You don’t need 2000+ plugins.</h3>
    <p>If your fleet is Linux bare-metal servers (not network devices, storage arrays, vSphere clusters), the breadth advantage doesn’t apply.</p>

    <h3>You want a modern UI without Nagios-era ergonomics.</h3>
    <p>Checkmk has modernized significantly but its lineage is visible. Glassmkr was built recently with no legacy.</p>
  </section>

  <section class="vs-section">
    <h2>Self-hosting</h2>
    <p>
      Both self-host, but the models differ. Checkmk is open-core: the Community edition (GPL-2.0-only) is real and free, while the flagship features (the Micro Core, agent bakery, advanced reporting) live in proprietary paid editions <sup><a href="#fn9">9</a></sup>. Glassmkr has no proprietary edition: the self-hosted deployment is the whole product, AGPL-3.0-only end to end, from a single docker-compose file.
    </p>
    <p><a href="/docs/self-hosting">Self-host in 10 minutes</a>.</p>
  </section>

  <VsCta variant="mid" />

  <section class="vs-section">
    <h2>Migration: switching from Checkmk to Glassmkr</h2>

    <p><strong>Checkmk Hosts → Glassmkr Nodes.</strong> Same unit. One server is one node.</p>

    <p><strong>Checkmk Services → individual alert-rule subjects.</strong> A Checkmk host’s ~30 services map to multiple Glassmkr alert rules (each with its own threshold). The mapping is many-to-many; not 1:1.</p>

    <p><strong>Checkmk Views / Dashboards → Glassmkr server detail pages.</strong> Per-server, with metrics and alert state.</p>

    <p><strong>Checkmk Notifications → Glassmkr notification channels.</strong> Reconfigure routing once.</p>

    <p><strong>Checkmk Host Groups → Glassmkr node tags (loosely).</strong> The grouping model differs; Glassmkr is per-node with tag-based labels rather than Checkmk’s hierarchical groups.</p>

    <p>The honest trade-off: you give up integration breadth, distributed monitoring across sites, and enterprise features (RBAC, audit, LDAP/SAML). You gain a simpler operational footprint and opinionated bare-metal defaults.</p>
  </section>

  <div class="vs-footer-note">
    Last verified: 2026-08-25. Sources cited inline. Glassmkr is not affiliated with Checkmk GmbH. Pricing and features change frequently; verify directly with Checkmk before making purchasing decisions.
  </div>

  <div class="vs-footnotes">
    <ol>
      <li id="fn1">Checkmk pricing page, <a href="https://checkmk.com/pricing">checkmk.com/pricing</a> (verified 2026-08-25).</li>
      <li id="fn2">Checkmk installation docs, <a href="https://docs.checkmk.com/latest/en/intro_setup.html">docs.checkmk.com/latest/en/intro_setup.html</a> (verified 2026-08-25).</li>
      <li id="fn3">"Meet the new Checkmk lineup" (2026-03-17), <a href="https://checkmk.com/blog/meet-new-checkmk-lineup">checkmk.com/blog/meet-new-checkmk-lineup</a> (verified 2026-08-25).</li>
      <li id="fn4">Werk #19391 Edition Renaming, <a href="https://checkmk.com/werk/19391">checkmk.com/werk/19391</a> (verified 2026-08-25). Edition titles change in 2.3 and 2.4; the internal identifiers change in 2.5.</li>
      <li id="fn5">Checkmk monitoring platform features, <a href="https://checkmk.com/product/features/monitoring-platform">checkmk.com/product/features/monitoring-platform</a>; distributed monitoring by edition (Livestatus in all editions, Livestatus proxy in the commercial editions), <a href="https://docs.checkmk.com/latest/en/distributed_monitoring.html">docs.checkmk.com/latest/en/distributed_monitoring.html</a> (verified 2026-08-25).</li>
      <li id="fn6">Checkmk IPMI integration, <a href="https://checkmk.com/integrations/ipmi_sensors">checkmk.com/integrations/ipmi_sensors</a> (verified 2026-08-25).</li>
      <li id="fn7">Checkmk Linux agent docs (SMART + IPMI plugins), <a href="https://docs.checkmk.com/latest/en/agent_linux.html">docs.checkmk.com/latest/en/agent_linux.html</a> (verified 2026-08-25).</li>
      <li id="fn8">Checkmk Community edition page ("2,000+ built-in integrations"), <a href="https://checkmk.com/product/checkmk-raw">checkmk.com/product/checkmk-raw</a> (verified 2026-08-25).</li>
      <li id="fn9">Checkmk editions comparison (LDAP/AD, SAML SSO, role management by edition), <a href="https://checkmk.com/product/editions">checkmk.com/product/editions</a>; Checkmk Micro Core ("The CMC is included as a component in the commercial editions"), <a href="https://docs.checkmk.com/latest/en/cmc.html">docs.checkmk.com/latest/en/cmc.html</a>; Agent Bakery glossary entry ("In the commercial editions, the Agent Bakery is used to individually package agents"), <a href="https://docs.checkmk.com/latest/en/glossar.html">docs.checkmk.com/latest/en/glossar.html</a> (verified 2026-08-25).</li>
      <li id="fn10">Checkmk COPYING (GPL-2.0), <a href="https://github.com/Checkmk/checkmk/blob/master/COPYING">github.com/Checkmk/checkmk/blob/master/COPYING</a> (verified 2026-08-25).</li>
      <li id="fn-glassmkr">Glassmkr pricing page, <a href="https://glassmkr.com/pricing">glassmkr.com/pricing</a> (verified 2026-08-23). Free self-hosted (AGPL-3.0-only, no node limits); hosted free with a 10-node per-account cap.</li>
    </ol>
  </div>

  <VsCta variant="bottom" competitor="Checkmk" />

  <ComparisonFooter current="checkmk" />
</article>
