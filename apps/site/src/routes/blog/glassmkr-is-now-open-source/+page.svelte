<script lang="ts">
  import rules from "$lib/data/rules.json";
  import facts from "$lib/data/product-facts.json";

  // Launch post. The rule count and the node cap come from their generated and
  // configured sources (ground-truth.yaml: rule_count, hosted_node_cap), never
  // typed in. PUBLISH_DATE is set on the day the PR merges; the visible meta
  // line shows only the month.
  const PUBLISH_DATE = "2026-09-08";
  const ruleCount = rules.length;
  const cap = facts.hostedNodeCap;

  const TITLE = "Glassmkr is now open source";
  const SLUG = "glassmkr-is-now-open-source";
  const URL = `https://glassmkr.com/blog/${SLUG}`;
  const OG = `https://glassmkr.com/og/${SLUG}.png`;
  const DESC =
    "The Glassmkr dashboard, alert rules, trend engine and remediation library are now AGPL-3.0-only, alongside the Crucible agent. One compose file self-hosts the whole stack.";
</script>

<svelte:head>
  <title>{TITLE} - Glassmkr Blog</title>
  <meta name="description" content={DESC} />

  <meta property="og:type" content="article" />
  <meta property="og:url" content={URL} />
  <meta property="og:title" content={TITLE} />
  <meta property="og:description" content={DESC} />
  <meta property="og:image" content={OG} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={TITLE} />
  <meta name="twitter:description" content={DESC} />
  <meta name="twitter:image" content={OG} />
  <link rel="canonical" href={URL} />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: TITLE,
    description: DESC,
    image: OG,
    datePublished: PUBLISH_DATE,
    dateModified: PUBLISH_DATE,
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: OG } },
    mainEntityOfPage: URL,
    articleSection: "Launch"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: TITLE, item: URL }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
    <header class="post-header">
      <p class="post-meta">September 2026 · Launch · 7 min read</p>
      <h1>{TITLE}</h1>
      <p class="lede">
        Glassmkr watches the parts of a server that fail quietly: SMART attributes, IPMI sensors, ECC counters, RAID and
        ZFS state, network interface errors. The Crucible agent has been open source from the start. As of today the rest
        is open too: the dashboard, the backend, the alert rules, the trend engine, and the remediation library are
        AGPL-3.0-only.
      </p>
    </header>

    <ul>
      <li>Dashboard and backend: <a href="https://github.com/glassmkr/glassmkr">github.com/glassmkr/glassmkr</a> (AGPL-3.0-only)</li>
      <li>Agent: <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a> (AGPL-3.0-only)</li>
      <li>Live demo, no signup: <a href="https://app.glassmkr.com/demo">app.glassmkr.com/demo</a></li>
    </ul>

    <p>
      It is the same codebase either way. Self-hosted removes the one gate the hosted service has, the {cap}-node cap:
      no license key, no plan tiers, nothing held back.
    </p>

    <h2>Why</h2>
    <p>
      Monitoring software that reads your hardware sits in an awkward position. To tell you a drive is failing, an agent
      needs to read SMART. To tell you a fan has stopped, it needs the BMC. On most systems it needs at least a narrow
      slice of root to do either. That is a lot of reach into a machine you care about, and the honest response to
      someone asking "what is this thing actually doing on my box?" is to let them read it, patch it, and run it
      themselves.
    </p>
    <p>
      Open source enables that inspection. It does not, by itself, prove the code is correct or safe, and this post is
      not going to pretend otherwise. What the license removes is the obstacle to checking. What you can actually check:
    </p>
    <ul>
      <li>
        The agent runs as an unprivileged <code>glassmkr</code> user. The handful of privileged reads go through one
        root-owned wrapper with a fixed argument list and an allowlisted set of actions, so the boundary is a file you
        can read rather than a claim you have to take.
      </li>
      <li>It opens no inbound ports.</li>
      <li>
        Its own outbound connections go to the dashboard URL you configured, and to Slack or Telegram if you enabled them
        in the agent's config. Email is handed to the local mail system. One more, which we would rather you heard from
        us than found in a packet capture: the security-patch check shells out to your package manager, so
        <code>dnf</code> or <code>apt</code> contacts whatever mirrors that host is already configured to use. Nothing
        goes to us except the dashboard you named.
      </li>
      <li>What it collects is inventoried at <a href="/trust">glassmkr.com/trust</a>.</li>
      <li>The remediation content is data, not hidden logic: rule definitions are YAML in the repository.</li>
    </ul>
    <p>
      Those remediation workflows are instructions for you, not actions we take. Glassmkr does not execute repairs on
      your machines: it shows you the command, how to check it worked, and how to undo it.
    </p>
    <p>
      I have spent about a decade working with dedicated servers, and the thing that stuck with me is how few of the
      failures were hard problems. Most of them were ordinary faults that nobody was watching for: a drive working
      through its reserve, a fan that had stopped, correctable errors climbing on one DIMM. Meanwhile the tooling to run
      an app on your own hardware has gotten very good, and AI is making it better, so there are more people than ever
      with something real running on a machine whose disks and sensors nobody is reading. The alert rules here are the
      faults I kept seeing, and what they usually meant.
    </p>

    <h2>What is in the box</h2>
    <p>
      <strong>Crucible, the agent.</strong> AGPL-3.0-only, on npm and as single-file binaries for x64 and arm64, so a
      host with no Node installed can still run it. It collects SMART, RAID, ZFS, IPMI sensors and SEL, ECC and
      machine-check counters, network including bonds, GPU state, and kernel and patch state, on a roughly five-minute
      cadence, and pushes snapshots to a dashboard you choose. From 1.0.1 the config and enroll surface are a semver
      promise.
    </p>
    <p>
      <strong>The dashboard.</strong> AGPL-3.0-only. It evaluates {ruleCount} alert rules written for bare-metal failure
      modes, and every rule carries a distro-aware remediation workflow: prerequisites, the command, how to validate it
      worked, how to roll it back. Not just a threshold. Alongside that: the statistical trend engine, cross-snapshot
      correlation, and a full read and write API. An MCP server ships in the repository, so an AI tool can query your
      fleet directly; self-hosting it needs TLS in front and a few environment variables, which the
      <a href="/docs/self-hosting">self-hosting guide</a> covers.
    </p>
    <p>
      Point <code>LLM_API_URL</code> at any OpenAI-compatible endpoint, local or remote, and you get AI analysis. Leave it
      empty and everything else works exactly as it did.
    </p>
    <p>
      Snapshots are kept for 90 days and alert history for a year. Both are ClickHouse table TTLs you can change on your
      own database; the guide shows how.
    </p>

    <h2>The evidence</h2>
    <p>
      The write-ups on this blog came from this stack. A drive on our own fleet accumulated 477 reallocated sectors while
      its own SMART self-assessment reported PASSED in all 140 readings we have of it, and it is still serving reads;
      the counters and the raw data are in
      <a href="/blog/smart-said-passed">SMART said PASSED</a>. A 20-box GPU fleet went from 88 alerts to 11 without
      suppressing anything real, in <a href="/blog/20-box-gpu-fleet-88-to-11-alerts">88 alerts to 11</a>. We test the
      remediation text by giving open models a read-only key and root on a broken box and grading the fix, in
      <a href="/blog/open-model-ladder-blind-remediation">the blind-remediation ladder</a>. Each post carries its own
      data, which is the part you can check: the public repository starts from a squashed tree, so it shows you the
      current source rather than the commit history behind those experiments.
    </p>

    <h2>Why this license</h2>
    <p>
      Everything is AGPL-3.0-only: if someone modifies this stack and runs it as a service, their users deserve the same
      source access you are getting today. The agent started under MIT, and its published versions through 1.0.1 remain
      MIT, because a granted license is not withdrawn; from v1.1.0 it carries the same license as the server, so there is
      one license to review instead of two.
    </p>

    <h2>Running it</h2>
    <p>The server stack is one compose file:</p>
    <pre><code>git clone https://github.com/glassmkr/glassmkr.git
cd glassmkr
cp env.selfhost.example .env
./scripts/selfhost-setup.sh     # generates the secrets
docker compose up -d</code></pre>
    <p>
      That brings up the dashboard, Postgres, and ClickHouse, and applies migrations on boot. The agent installs
      separately on each machine you want to watch, with the dashboard address as a flag. The full guide, including
      backups, upgrades, and retention, is at <a href="/docs/self-hosting">glassmkr.com/docs/self-hosting</a>.
    </p>
    <p>
      Self-hosted has no node limit and no license key. Nothing reports back to us. Two third parties are contacted by
      default and you should know which: the dashboard reads the endoflife.date dataset to judge OS support windows, and
      asks the npm registry which agent version is current. Both are lookups, neither sends your data anywhere, and both
      are in the source.
    </p>

    <h2>The hosted service</h2>
    <p>
      app.glassmkr.com is for people who would rather not operate the stack. It is free, capped at {cap} nodes per
      account, it doubles as the live demo, and I run it because I use it daily for my own machines. There is no paid
      tier: the cap is the only difference between hosted and self-hosted, and the way past it is to self-host.
    </p>
    <p>
      About the hosted service I will only say what I can keep: it is free today, I run it, and if that ever has to
      change, self-hosting is unaffected and your data exports.
    </p>

    <h2>Maintenance, plainly</h2>
    <p>
      I maintain this. There is a SECURITY.md in both repositories with a private disclosure channel, issue templates in
      the agent repository that ask for the details that actually reproduce hardware bugs, and a
      <a href="https://github.com/glassmkr/crucible/blob/main/SUPPORT.md">tested-support matrix</a> that lists where the
      agent has been exercised rather than where it ought to work.
    </p>
    <p>
      Releases follow semver. Each release publishes SHA256SUMS alongside the binaries, and each binary carries a
      build-provenance attestation that ties its exact bytes to the workflow, repository, and commit that built it. You
      can check one without a GitHub account. The npm package is published from CI with no long-lived credentials, using
      Trusted Publishing, and carries its own provenance attestation.
    </p>

    <h2>If you already run collectd</h2>
    <p>
      collectd has done the collection half of this job for about twenty years, and this is not an argument that it is
      finished. We audited its host and hardware plugins against ours row by row and published the whole matrix. Of 63
      rows, Crucible covers 21, partially covers 16, and does not read 26: collectd reads more distinct things than we
      do. What Crucible adds is on top of collection: alert evaluation tuned for hardware failure modes, trend behavior
      across snapshots, and a remediation workflow attached to every rule. The comparison, with the footprint trade
      stated plainly, is at <a href="/vs/collectd">glassmkr.com/vs/collectd</a>.
    </p>

    <h2>Current limits</h2>
    <p>
      It is a young project maintained by one person. There is no support contract. The tested-support matrix lists
      where the agent has actually been exercised, which is narrower than where it should work, and it stays narrow
      until a real run widens it. The release cadence is when there is something to release, with security fixes first.
    </p>
    <p>
      The agent is heavier than a C daemon: 77 to 82 MB resident on a two-disk Rocky host, with a high-water mark of
      103 MB across four collection cycles. Those are measured numbers, not estimates, and the trade is set out at
      <a href="/vs/collectd">glassmkr.com/vs/collectd</a> so you can decide whether it earns its place on your hosts.
    </p>
    <p>Issues and pull requests are welcome. Contributions are DCO, not a CLA.</p>
  </article>
</div>

<style>
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
  .post pre code {
    background: none;
    padding: 0;
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
