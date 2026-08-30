<script lang="ts">
  // /vs/collectd, PROMOTED to launch-gating by the round-2 decisions
  // (2026-08-24). Generated from the parity audit in the crucible repo
  // (docs/COLLECTD_PARITY.md); minimal and accurate beats elaborate. Status
  // wording is factual only (versions and dates, RE-VERIFY AT PUBLISH from
  // the GitHub releases page); never "stalled" or "dormant" as editorial.
  // The migration guide is fast-follow; this page notes it as coming.
  import "$lib/components/vs/comparison.css";
  import ComparisonFooter from "$lib/components/vs/ComparisonFooter.svelte";
  import VsCta from "$lib/components/vs/VsCta.svelte";
  import VsHead from "$lib/components/vs/VsHead.svelte";
  import rules from "$lib/data/rules.json";

  const ruleCount = rules.length;
</script>

<VsHead
  title="Glassmkr vs collectd: a monitoring product vs a collection daemon"
  description="Glassmkr (open-source bare-metal monitoring with alert rules and remediation) vs collectd (the veteran C statistics collection daemon). Different layers, honestly compared. Last verified 2026-08-25."
  headline="Glassmkr vs collectd: a monitoring product vs a collection daemon"
  articleDescription="Honest comparison: Glassmkr (AGPL-3.0-only end to end, alert rules with remediation) vs collectd (MIT daemon with per-plugin licenses, statistics collection). Last verified 2026-08-25."
  slug="collectd"
  competitorName="collectd"
  competitorUrl="https://collectd.org"
  ogTitle="Glassmkr vs collectd"
  dateModified="2026-08-25"
/>

<article class="vs-page">
  <section class="vs-hero">
    <p class="vs-eyebrow">GLASSMKR VS COLLECTD</p>
    <h1>Glassmkr vs collectd: a monitoring product vs a collection daemon.</h1>
    <p class="vs-subhead">collectd collects system statistics; Glassmkr collects them, evaluates them, and tells you what to run. Different layers, compared honestly.</p>
    <p class="vs-verified">Last verified: 2026-08-25. Glassmkr is not affiliated with the collectd project.</p>

    <div class="vs-tldr">
      <p>
        collectd has collected system statistics on Unix machines for about twenty years. It is packaged in essentially every distribution, its plugin model became the default of its era, and an enormous amount of infrastructure has depended on it. Its daemon is MIT licensed, with plugins licensed individually (mostly MIT or GPL-2.0-only) <sup><a href="#fn1">1</a></sup>.
      </p>
      <p>
        Project status, stated factually: the last stable release is 5.12.0, published September 2020; a 6.0 series exists as release candidates (latest rc3, February 2024) described by the project as a preview with expected breaking changes <sup><a href="#fn2">2</a></sup>.
      </p>
      <p>
        Glassmkr is a monitoring product rather than a collection daemon: the AGPL-3.0-only Crucible agent collects hardware-level signals, and the dashboard (same license) evaluates {ruleCount} alert rules over them, each with a remediation command attached. Both deployment forms are free: self-hosted with no node limits, or hosted with a 10-node per-account cap.
      </p>
    </div>
  </section>

  <section class="vs-section">
    <h2>Signal coverage, honestly</h2>
    <p>
      We audited every collectd host- and hardware-relevant read plugin against Crucible's collectors, row by row, and published the full matrix in the agent repository <sup><a href="#fn3">3</a></sup>. Of 63 rows, Crucible covers 21, partially covers 16, and does not read 26 <sup><a href="#fn3">3</a></sup>. Read that plainly: collectd reads more distinct things than Crucible does. Where Crucible goes further is depth on the hardware-failure signals below, and what it does with them. The short version:
    </p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="collectd parity matrix, scrolls horizontally"><table class="vs-table">
      <thead><tr><th>Signal family</th><th>collectd</th><th>Glassmkr</th></tr></thead>
      <tbody>
        <tr><td>CPU, load, memory, swap, filesystems, disk I/O</td><td>Yes</td><td>Yes, plus per-signal alert rules</td></tr>
        <tr><td>SMART and NVMe health</td><td>Basic attributes</td><td>Attributes, self-test log, NVMe critical warnings, wear, hardware-RAID passthrough, trend evaluation</td></tr>
        <tr><td>RAID (mdadm), ZFS, hardware RAID CLIs</td><td>md plugin; ZFS ARC</td><td>mdadm incl. resync progress, ZFS pool + ARC, PERC/MegaRAID/SmartArray/Adaptec</td></tr>
        <tr><td>IPMI, thermal, fans, voltages</td><td>Sensors</td><td>Sensors, SEL events, chassis facts, PSU redundancy, hwmon fans and voltages</td></tr>
        <tr><td>ECC and machine-check</td><td>Via mcelog plugin</td><td>EDAC counters, IPMI ECC sensors and SEL correlation</td></tr>
        <tr><td>Network interfaces</td><td>Counters</td><td>Counters, error subtypes, link state, flap detection, bonding, conntrack, TCP health</td></tr>
        <tr><td>Open rows</td><td colspan="2">collectd reads some things Crucible does not (per-process aggregates, active ping probing, IB counters, and more). Every open row is listed in the public matrix rather than papered over <sup><a href="#fn3">3</a></sup>.</td></tr>
      </tbody>
    </table></div>
    <p>
      Cadence is a real difference: collectd samples at ten-second defaults; Crucible snapshots roughly every five minutes. Sub-interval transients can be missed by Glassmkr and caught by collectd. We do not claim high-frequency parity.
    </p>
  </section>

  <section class="vs-section">
    <h2>The footprint trade</h2>
    <p>
      Crucible is a Node agent shipped as a single binary; it uses more memory than a C daemon and we are not going to pretend otherwise. Measured rather than estimated: on a two-disk Supermicro running Rocky 9.8, 40 samples over 20 minutes spanning four collection cycles gave 77 to 82 MB resident, with a high-water mark of 103 MB that did not move across the run. Hosts with more disks and sensors to enumerate will sit higher, because the cost scales with what there is to walk. An earlier version of this page claimed a transient peak near 875 MB; that figure came from a single process instance we could not reproduce, and the corrected measurement is above. In exchange: it runs unprivileged, with the few root reads going through a narrow fixed-argv wrapper with an allowlisted action set, where collectd's hardware plugins typically want root or broad capabilities. Heavier runtime, smaller blast radius.
    </p>
  </section>

  <section class="vs-section">
    <h2>What Glassmkr adds above collection</h2>
    <p>
      collectd hands its statistics to whatever you wire behind it; the judgment layer is yours to build. Glassmkr ships it: {ruleCount} alert rules tuned on bare-metal failures, a remediation command and verification step on every alert, a trend engine over the latching counters with published evidence <sup><a href="#fn4">4</a></sup>, notification routing, an API, and MCP. If you already run collectd into a mature pipeline you trust, that stack works; this page exists for the people still assembling one.
    </p>
    <p>
      A migration guide (plugin-to-collector mapping, config translation) is coming; the mapping data is already public in the parity matrix <sup><a href="#fn3">3</a></sup>.
    </p>
  </section>

  <VsCta competitor="collectd" />

  <section class="vs-section vs-footnotes">
    <h2>Sources</h2>
    <ol>
      <li id="fn1">collectd licensing: COPYING in the collectd repository (daemon MIT; plugins licensed individually, mostly MIT or GPL-2.0-only). Verified 2026-08-25.</li>
      <li id="fn2">collectd releases page on GitHub: 5.12.0 (2020-09-03); 6.0.0-rc0 through rc3 (2024-01-23 to 2024-02-21). Verified 2026-08-25; re-verify at publish.</li>
      <li id="fn3">The full parity audit: docs/COLLECTD_PARITY.md in <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a>, including every open row and the honesty caveats this page summarizes.</li>
      <li id="fn4"><a href="/blog/smart-said-passed">The drive that failed while SMART said PASSED</a>: the trend-engine evidence.</li>
    </ol>
  </section>

  <ComparisonFooter current="collectd" />
</article>
