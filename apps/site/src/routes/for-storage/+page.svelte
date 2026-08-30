<script lang="ts">
  // /for-storage. Use-case page, replacing the audience-shaped verticals: what you
  // run determines which rules matter, and an SRE and a self-hoster with the same
  // array need the same alerts.
  import type { PageData } from "./$types";
  // Counts come from the catalogue, never from a word typed into a heading.
  import { ruleCountFor, inWords, inWordsCapitalized, totalRuleCount } from "$lib/vertical-rules";
  import "$lib/components/vertical.css";
  let { data }: { data: PageData } = $props();

  const serviceLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Monitoring for storage servers",
    provider: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    areaServed: { "@type": "Place", name: "Worldwide" },
    description:
      "Drive-failure early warning for storage servers. SMART attributes read over time, ZFS pool health, hardware RAID passthrough, and disk-fill projection.",
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
  <title>Glassmkr for storage servers: drive failure warning that does not wait for SMART to say FAILED</title>
  <meta
    name="description"
    content="A drive can report PASSED with hundreds of dead sectors. Glassmkr reads the raw SMART attributes over time, plus ZFS pool health, hardware RAID passthrough and disk-fill projection."
  />
  <link rel="canonical" href="https://glassmkr.com/for-storage" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/for-storage" />
  <meta property="og:title" content="Glassmkr for storage servers" />
  <meta
    property="og:description"
    content="A drive can report PASSED with hundreds of dead sectors. We read the raw attributes over time, not the one-bit verdict."
  />
  <meta property="og:image" content="https://glassmkr.com/og/smart-said-passed.png?v=20260830" />

  {@html `<script type="application/ld+json">${serviceLd}</` + `script>`}
</svelte:head>

<article class="vertical">
  <section class="hero">
    <p class="eyebrow">FOR STORAGE SERVERS</p>
    <h1>Your drive says it is healthy. That is not the same as being healthy.</h1>
    <p class="subhead">
      Every drive carries a one-bit self-assessment, and it is the field most monitoring checks. We measured how far
      that bit can sit from reality: 477 dead sectors, and it still read PASSED.
    </p>
    <div class="cta-row">
      <a href="https://app.glassmkr.com/register" class="btn btn-primary btn-lg">Install in 2 minutes</a>
      <a href="https://github.com/glassmkr/crucible" class="btn btn-ghost btn-lg">View Crucible on GitHub<span class="mit-badge">AGPL-3.0-only</span></a>
    </div>
    <p class="cta-caption">Free hosted or self-hosted. Point it at one storage box before deploying fleet-wide.</p>

    <div class="install-block">
      <code>curl -fsSL https://glassmkr.com/install.sh | sudo bash</code>
      <p class="install-version">Crucible v{data.crucibleVersion} on npm</p>
    </div>
  </section>

  <section class="section">
    <h2>The problem</h2>
    <p>
      The SMART overall-health verdict is a pass or fail against normalized attribute values, not against the raw
      counts an operator reads. The manufacturer sets those thresholds where it expects warranty-relevant death. A
      drive can work through most of its spare sector pool and still sit comfortably inside them.
    </p>
    <p>
      We ran a drive-health campaign across thirteen boxes to find out how wide that gap gets. One 4 TB drive was
      carrying <strong>477 reallocated sectors</strong> and reported its own health as <strong>PASSED in all 140
      readings</strong> we logged. A full destructive write-and-verify pass over that same drive came back clean, zero
      errors, because reallocation exists precisely to hide the damage from the host. The only place it was visible was
      the raw attribute counter, and only to something watching that counter over time.
    </p>
    <p>
      That is the whole job. Not reading the verdict; reading what is underneath it, on a schedule, and knowing which
      of those numbers mean something.
    </p>
    <p>
      <a href="/blog/smart-said-passed">Read the full write-up, with the data</a>.
    </p>
  </section>

  <section class="section">
    <h2>How Glassmkr fits</h2>

    <div class="fit-grid">
      <div class="fit-item">
        <h3>{inWordsCapitalized(ruleCountFor("storage"))} rules for the storage layer alone.</h3>
        <p>
          Seven for drives and controllers, three for ZFS, six for filesystem and capacity. They run on every
          collection cycle against every drive the box can see, and they carry the remediation with them rather than
          leaving you to work out what a raw attribute number means.
        </p>
      </div>

      <div class="fit-item">
        <h3>We alert on the counters that latch, and not on the ones that flap.</h3>
        <p>
          Reallocated sectors only ever go up, so they are safe to page on. Pending sectors oscillate by design: on
          that same drive ours swung between 0 and 96 while the actual damage never moved. An alert keyed on pending
          would have fired and self-cleared three times in under a day. We considered it and the data talked us out of
          it.
        </p>
      </div>

      <div class="fit-item">
        <h3>Drives behind a hardware RAID controller are still drives.</h3>
        <p>
          A controller that presents one logical volume hides the physical disks from most tooling. Crucible
          enumerates them through the controller and reads each one's SMART directly, so a failing member is visible
          before the array degrades rather than after.
        </p>
      </div>

      <div class="fit-item">
        <h3>ZFS gets its own rules, not a generic disk check.</h3>
        <p>
          Pool health, scrub errors and a faulted SLOG are three different problems with three different responses.
          Treating them as one "disk problem" is how a degraded pool sits unnoticed while somebody investigates
          capacity.
        </p>
      </div>

      <div class="fit-item">
        <h3>Capacity is a trend, not a threshold.</h3>
        <p>
          A disk at 71 percent that has been at 71 percent for a year is fine. A disk at 71 percent climbing steadily
          is a scheduled outage. We project the fill rather than waiting for a percentage line to be crossed at 3am.
        </p>
      </div>

      <div class="fit-item">
        <h3>An unreadable drive is reported, not skipped.</h3>
        <p>
          If SMART cannot be read for a disk, whether the controller does not support it or the tooling is missing,
          that is stated as its own condition. A drive we cannot see is not a drive that is fine, and it should never
          silently disappear from a health summary.
        </p>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>What we do not claim</h2>
    <p>
      We found one failing drive in that campaign and we found it already at 477, so we never watched it climb from
      zero. That means we cannot tell you what count is dangerous. Is a drive at 3 reallocated sectors in trouble, or
      fine for another four years? Our data cannot answer that, and any threshold we published from a single drive
      would be an invention with a number attached.
    </p>
    <p>
      So reallocated sectors stay critical rather than being tiered by size, because the two ways of being wrong are
      not equally expensive: telling you to investigate a drive that is actually dying costs you data, and paging you
      about one that turns out to be stable costs you a ticket.
    </p>
  </section>

  <section class="section">
    <h2>The agent you can read</h2>
    <p>
      Crucible is AGPL-3.0-only and the repository is public. It runs as an unprivileged user, and the few commands
      that need root go through a narrow root-owned wrapper with a fixed argument list per action: no shell, no
      caller-supplied arguments. You can read exactly what it collects and exactly what leaves the box.
    </p>
    <p>
      <a href="/trust">What we collect and what we do not</a> is documented separately, in detail.
    </p>
  </section>

  <section class="pricing-reminder">
    <h2>Pricing reminder</h2>
    <p>Free both ways: self-hosted under AGPL-3.0-only with no node limits, or the free hosted instance with a 10-node per-account cap. No per-drive or per-metric charge in either form.</p>
    <p class="pricing-examples">A 60-bay JBOD counts the same as a single-disk server: one node.</p>
  </section>

  <section class="cta-section">
    <h2>Point it at one storage box first.</h2>
    <p>
      Install takes two minutes and both deployment forms are free, so you can see what it says about hardware you
      already know the history of before you trust it with the rest.
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
