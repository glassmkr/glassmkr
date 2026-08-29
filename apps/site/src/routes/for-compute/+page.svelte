<script lang="ts">
  // /for-compute. Use-case page for general CPU compute: the broad middle of a
  // bare-metal fleet, where the distinguishing signals are the ones you only get
  // because you own the hardware.
  import type { PageData } from "./$types";
  // Counts come from the catalogue, never from a word typed into a heading.
  import { ruleCountFor, inWords, inWordsCapitalized, totalRuleCount } from "$lib/vertical-rules";
  import "$lib/components/vertical.css";
  let { data }: { data: PageData } = $props();

  const serviceLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Monitoring for bare-metal compute servers",
    provider: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    areaServed: { "@type": "Place", name: "Worldwide" },
    description:
      "Hardware-aware monitoring for bare-metal compute: ECC and machine-check errors, BMC sensors, PSU redundancy, bonded links, kernel and patch state.",
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
          description: "AGPL-3.0-only, free forever, no node limits. The whole stack runs on your hardware with Docker Compose.",
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
  <title>Glassmkr for bare-metal compute: the signals you only get because you own the hardware</title>
  <meta
    name="description"
    content="ECC and machine-check errors, BMC sensors, PSU redundancy, fan failure, bonded link state, kernel and patch drift. The layer cloud monitoring never had to have."
  />
  <link rel="canonical" href="https://glassmkr.com/for-compute" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/for-compute" />
  <meta property="og:title" content="Glassmkr for bare-metal compute" />
  <meta
    property="og:description"
    content="ECC, machine checks, BMC sensors, PSU redundancy, bonded links, patch drift. The layer cloud monitoring never had to have."
  />
  <meta property="og:image" content="https://glassmkr.com/og/introducing-glassmkr.png?v=20260826" />

  {@html `<script type="application/ld+json">${serviceLd}</` + `script>`}
</svelte:head>

<article class="vertical">
  <section class="hero">
    <p class="eyebrow">FOR BARE-METAL COMPUTE</p>
    <h1>Cloud monitoring never needed to know the fan had failed.</h1>
    <p class="subhead">
      On someone else's hardware a dying host just disappears and a new one arrives. On yours, the fan, the DIMM, the
      power supply and the bonded link are all yours to notice first.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install in 2 minutes</a>
      <a href="https://github.com/glassmkr/crucible" class="btn btn-ghost btn-lg">View Crucible on GitHub<span class="mit-badge">AGPL-3.0-only</span></a>
    </div>
    <p class="cta-caption">Free hosted or self-hosted. No agent config to write.</p>

    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
      <p class="install-version">Crucible v{data.crucibleVersion} on npm</p>
    </div>
  </section>

  <section class="section">
    <h2>The problem</h2>
    <p>
      Most monitoring grew up on instances. It is very good at CPU, memory and request rates, because on rented
      capacity that is genuinely the whole surface: if the hardware underneath fails, the provider replaces it and you
      never learn that it happened.
    </p>
    <p>
      Bare metal puts that layer back in your hands, and it is a layer with its own vocabulary. Correctable ECC errors
      climbing on one DIMM. A machine check the kernel logged and nobody read. One of two power supplies quietly
      dropping redundancy so the next feed event takes the box down. A bond that is still up because exactly one slave
      is carrying it. None of that appears in a CPU graph, and all of it is knowable well before it becomes an outage.
    </p>
    <p>
      You can assemble it yourself from ipmitool, mcelog, ethtool and a pile of exporters. Most teams have better uses
      for that week.
    </p>
  </section>

  <section class="section">
    <h2>How Glassmkr fits</h2>

    <div class="fit-grid">
      <div class="fit-item">
        <h3>{inWordsCapitalized(ruleCountFor("compute"))} rules apply to an ordinary compute box.</h3>
        <p>
          Nine for memory and CPU pressure, ten for the network path, ten from the BMC, six for services and time,
          ten for kernel and patch state. Every one arrives with the remediation attached, because an alert that tells
          you a number without telling you what to do is just a louder dashboard.
        </p>
      </div>

      <div class="fit-item">
        <h3>The BMC is a first-class source, not an afterthought.</h3>
        <p>
          Fan failure, CPU temperature, PSU redundancy loss, CMOS battery, and critical entries in the system event
          log. These are read through a narrow root-owned wrapper with a fixed argument list, because reading a BMC
          needs privilege and we would rather hand you an auditable one-line wrapper than ask you to run the whole
          agent as root.
        </p>
      </div>

      <div class="fit-item">
        <h3>Memory faults, in the two places they show up.</h3>
        <p>
          Correctable ECC counted per DIMM so you can tell a rising module from background noise, and uncorrected
          machine-check exceptions from the kernel. We also flag a chassis whose channels are underpopulated, which is
          not a fault at all but quietly costs you bandwidth you paid for.
        </p>
      </div>

      <div class="fit-item">
        <h3>Bare-metal networking, not just "is the interface up".</h3>
        <p>
          Bond slave down, LACP partner lost, link negotiated below its expected speed, conntrack table exhaustion,
          softnet drops, listen-queue overflow. A bonded pair running on one leg looks perfectly healthy from above
          and has no redundancy left at all.
        </p>
      </div>

      <div class="fit-item">
        <h3>Patch and kernel state, because it is a fleet property.</h3>
        <p>
          Pending security updates, a kernel that needs a reboot to take effect, known vulnerabilities in the running
          kernel, an OS past end of life, SSH accepting root passwords, no firewall. Boring, unglamorous, and the
          thing an auditor asks about first.
        </p>
      </div>

      <div class="fit-item">
        <h3>We alert when the monitoring itself goes blind.</h3>
        <p>
          If IPMI stops answering, that is its own alert rather than a quiet gap where hardware alerts used to be. A
          monitoring tool that goes silent looks exactly like a healthy fleet, and that is the failure mode we are
          most afraid of.
        </p>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>We tune these against our own fleet</h2>
    <p>
      Every rule here runs on the twenty-one bare-metal boxes we operate, which is how the false positives get found.
      A recent example: a sandbox setting in our own agent made a normal filesystem look read-only, and nineteen of
      twenty-one hosts carried a permanent critical alert that meant nothing. We found it, fixed it, and verified it
      went to zero of twenty-one while a genuinely read-only mount still fired.
    </p>
    <p>
      That is the work nobody sees. An alert set that pages you for benign conditions gets muted within a week, and a
      muted alert set is worth nothing at all.
    </p>
  </section>

  <section class="section">
    <h2>The agent you can read</h2>
    <p>
      Crucible is AGPL-3.0-only and public. It runs unprivileged, and the handful of privileged reads go through a
      root-owned wrapper with one fixed command per permitted action: no shell, no caller-supplied arguments. Install
      is one command and there is no configuration file to write before it works.
    </p>
    <p>
      <a href="/trust">What we collect and what we do not</a> is documented separately, in detail.
    </p>
  </section>

  <section class="pricing-reminder">
    <h2>Pricing reminder</h2>
    <p>Free both ways: self-hosted under AGPL-3.0-only with no node limits, or the free hosted instance with a 10-node per-account cap. Never per metric, per check or per host-hour.</p>
    <p class="pricing-examples">A 40-core dual-socket box counts the same as a small VPS: one node.</p>
  </section>

  <section class="cta-section">
    <h2>Try it on a few boxes.</h2>
    <p>
      Both deployment forms are free with no time limit, which is enough to see whether it tells you anything you did
      not already know about hardware you own.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Get started free</a>
      <a href="/docs" class="btn btn-ghost btn-lg">Read the docs</a>
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
  </section>
</article>

<style>
  /* Page-specific: the "Or self-host it" block in the closing CTA.
     Shared structural rules live in $lib/components/vertical.css. */
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
