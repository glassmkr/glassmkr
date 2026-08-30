<script lang="ts">
  import { DASHBOARD_REPO_PUBLIC } from "$lib/repo-state";
  // /trust: renamed from /security per CONTENT_TRANCHE_3 spec
  // (2026-05-17). Restructured with six anchor-linkable sections
  // (#agent, #data, #access, #disclosure, #provenance, #gaps).
  // The old /security route now 301-redirects here (see
  // routes/security/+page.server.ts).
  //
  // Lead with the agent: the single most-load-bearing trust signal.
  // Data handling + access + disclosure follow. Provenance closes
  // on what Glassmkr's own infrastructure looks like. The "what we
  // don't have yet" section is the honest-about-gaps close.

  // Two JSON-LD documents: WebPage (the page itself) + Organization
  // (Glassmkr the entity); the page describes the org's security
  // posture so both schemas help discovery.
  const webPageLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Trust at Glassmkr",
    description:
      "How Glassmkr handles trust: AGPL-3.0-only open-source Crucible agent and dashboard, servers in the Netherlands or full self-hosting, GDPR posture, and honest gaps. Updated 2026-08-24.",
    url: "https://glassmkr.com/trust",
    dateModified: "2026-08-24",
  });
  const orgLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Glassmkr",
    url: "https://glassmkr.com",
    email: "contact@glassmkr.com",
    sameAs: [
      "https://github.com/glassmkr",
      "https://www.npmjs.com/package/@glassmkr/crucible",
    ],
  });
</script>

<svelte:head>
  <title>Trust at Glassmkr: open-source stack, checkable infrastructure, honest gaps</title>
  <meta name="description" content="An open-source stack, AGPL-3.0-only end to end. Servers in the Netherlands, verifiable in the RIR record, or self-host so none of it reaches us. Honest answers to the security questions you'd ask any monitoring vendor." />
  <link rel="canonical" href="https://glassmkr.com/trust" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/trust" />
  <meta property="og:title" content="Trust at Glassmkr" />
  <meta property="og:description" content="How Glassmkr handles trust: AGPL-3.0-only agent and dashboard, servers in the Netherlands or fully self-hosted, honest gaps." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Trust at Glassmkr" />
  <meta name="twitter:description" content="AGPL-3.0-only agent and dashboard, servers in the Netherlands or self-hosted, honest gaps." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  {@html `<script type="application/ld+json">${webPageLd}</` + `script>`}
  {@html `<script type="application/ld+json">${orgLd}</` + `script>`}
</svelte:head>

<article class="trust">
  <header class="trust-hero">
    <h1>Trust at Glassmkr.</h1>
    <p class="lede">
      {#if DASHBOARD_REPO_PUBLIC}
        An open-source stack you can read end to end, AGPL-3.0-only
        throughout.
      {:else}
        An open-source stack, AGPL-3.0-only throughout: the Crucible agent is
        public today, and the dashboard repository opens shortly. Until it does,
        "read it end to end" is a promise rather than something you can
        exercise, so this page will not make it.
      {/if}
      Servers in the Netherlands, or self-hosted so none of it reaches us. A single operator
      you can email. Honest answers to the security questions you’d ask any
      monitoring vendor.
    </p>
    <nav class="trust-toc" aria-label="On this page">
      <a href="#agent">The code you can read</a>
      <a href="#data">Data handling</a>
      <a href="#access">Who can access your data</a>
      <a href="#disclosure">Security disclosure</a>
      <a href="#provenance">Infrastructure provenance</a>
      <a href="#gaps">What we don’t have yet</a>
    </nav>
  </header>

  <section class="trust-section" id="agent">
    <h2>The code you can read</h2>
    <p>
      The single most important thing we can do for your trust is let you read the code that runs on your servers, and the code it reports to. Both are open source.
    </p>
    <h3>Crucible, the agent, is AGPL-3.0-only.</h3>
    <p>
      Source at <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a>. You can audit every line before you install it. You can fork it. You can deploy your own modified version. The same AGPL-3.0-only license covers the agent and the dashboard, so there is one license to review, not two.
    </p>
    <h3>The dashboard is AGPL-3.0-only.</h3>
    {#if DASHBOARD_REPO_PUBLIC}
      <p>
        Source at <a href="https://github.com/glassmkr/glassmkr">github.com/glassmkr/glassmkr</a>. The server side is not a black box either: the ingest API, the alert evaluator, every rule and its thresholds, the storage schema and the retention logic are all in the open. "Read the source" now covers both ends of the wire.
      </p>
    {:else}
      <p>
        Its repository is not public yet. It opens at github.com/glassmkr/glassmkr as part of the launch, carrying the ingest API, the alert evaluator, every rule and its thresholds, the storage schema and the retention logic. Until that link resolves, the dashboard's openness is a commitment you cannot verify yet, and this page will not pretend otherwise.
      </p>
    {/if}
    <h3>Self-host it, and none of your data reaches us.</h3>
    <p>
      The whole stack runs on your own hardware with one docker compose file. No metric, no alert state and no diagnostic excerpt reaches Glassmkr: the agent reports to a dashboard you operate. <a href="/docs/self-hosting">Self-host in 10 minutes</a>.
    </p>
    <p>
      This page used to say "nothing leaves your network at all". That is not
      true, so here is the exception list. Three things reach the internet by
      default and none of them carry your data: the dashboard reads the public
      endoflife.date dataset to judge OS support windows, it asks the npm
      registry which agent version is current, and the agent's security-patch
      check shells out to your package manager, so <code>apt</code> or
      <code>dnf</code> talks to whatever mirrors that host already uses. All
      three are in the source. An air-gapped deployment loses those three
      features and nothing else.
    </p>
    <h3>The install script is about 130 lines of bash.</h3>
    <p>
      Read it at <a href="https://glassmkr.com/install.sh">install.sh</a> before piping it to bash. It installs Node from NodeSource if the host does not have it, installs <code>@glassmkr/crucible</code> from npm, installs smartmontools and (best effort) ipmitool so disk and chassis checks work, sets up a systemd service, and hands off to <code>init</code> to register the node. That is the whole script; read it and check.
    </p>
    <h3>Installation needs root once. The daemon that keeps running does not.</h3>
    <p>
      Installing is a root step, as any package install is: it adds a system
      user, writes a systemd unit, installs packages. After that Crucible runs
      as the unprivileged <code>glassmkr</code> user. It cannot read files
      outside its operational scope, cannot execute commands as other users,
      and writes one log file and one state file in its own directory.
    </p>
    <p>
      Some hardware reads do need privilege, and that is worth stating plainly
      rather than hiding behind "never root". Reading SMART attributes or BMC
      sensors is privileged on most systems. Those calls go through a single
      root-owned wrapper with a fixed argument list and an allowlisted set of
      actions, so the escalation boundary is one short file you can read rather
      than a claim you have to accept. The residual risk is worth naming too:
      anyone who can edit that wrapper, or who can already run as the
      <code>glassmkr</code> user and finds a flaw in how it handles arguments,
      gains whatever the allowlist permits. What limits that is the allowlist
      being short, fixed at install time, and reviewable in the agent
      repository.
    </p>
    <h3>Observed, not just asserted.</h3>
    <p>
      Everything above is a claim about source code, and source claims are the
      easy kind to make. So the destinations were also measured on a running
      host rather than read out of the repository: an iptables rule matching on
      <code>--uid-owner glassmkr</code> logged every outbound connection the
      agent's own user opened, across a full collection cycle including a
      security-patch check. What appeared was the configured dashboard and the
      host's existing package mirrors, and nothing else. The method is three
      lines, and you can run it on any host you trust less than you would like
      to:
    </p>
    <pre><code>sudo iptables -A OUTPUT -m owner --uid-owner glassmkr -j LOG --log-prefix "glassmkr-egress: "
sudo systemctl restart glassmkr-crucible
sudo journalctl -kf | grep glassmkr-egress</code></pre>
    <p>
      That measures the agent's own user. It does not measure the package
      manager, which runs as root when the patch check invokes it, and that is
      exactly why the mirrors are named separately above rather than folded
      into this result.
    </p>
    <h3>HTTPS only.</h3>
    <p>
      Crucible reports to the dashboard address you configured, over HTTPS. There is no analytics provider and no usage telemetry. Its own outbound connections go to that dashboard, to Slack or Telegram if you enable them in the agent's config, and to your package manager's existing mirrors when the security-patch check runs. Email is handed to the local mail system.
    </p>
    <h3>What leaves your server, and what does not.</h3>
    <p>
      Crucible ships metrics and alert state, plus small bounded diagnostic excerpts attached to a firing alert (for example the last journal lines of a failed service, or matched kernel dmesg events) so the alert is actionable without SSHing to the box. It does not stream logs in bulk, does not ship command output, and does not read or ship arbitrary file contents. A failed service's journal lines can contain sensitive strings, so treat that bounded evidence as in scope for your own secret hygiene. See the <a href="#data">Data handling</a> section for the full list.
    </p>
    <h3>Release integrity.</h3>
    <p>
      Every Crucible release from 1.0.1 onward carries a build-provenance attestation for each single-file binary, tying its exact bytes to the workflow, repository and commit that produced it. Releases also publish a <code>SHA256SUMS</code> file, and the npm package carries the provenance described below. There is no GPG key, deliberately. Attestation binds provenance to the build workflow itself, so there is no private key for one maintainer to hold, rotate, or lose. (An earlier version of this page argued that losing a signing key would invalidate past signatures. That was wrong: verification uses the public key, which survives. Losing the private key stops future signing, nothing more.)
    </p>
    <p>
      You can verify a download without a GitHub account. Every command below works logged out, which we checked on a clean machine rather than assuming:
    </p>
    <pre><code>curl -fsSLO https://github.com/glassmkr/crucible/releases/download/v1.0.1/glassmkr-crucible-linux-x64
  curl -fsSLO https://github.com/glassmkr/crucible/releases/download/v1.0.1/SHA256SUMS
  sha256sum --ignore-missing -c SHA256SUMS

  D=$(sha256sum glassmkr-crucible-linux-x64 | cut -d' ' -f1)
  curl -fsSL "https://api.github.com/repos/glassmkr/crucible/attestations/sha256:$D" \
    | jq -c '.attestations[0].bundle' &gt; bundle.jsonl

  gh attestation verify glassmkr-crucible-linux-x64 --repo glassmkr/crucible \
    --bundle bundle.jsonl</code></pre>
    <p>
      A successful verification is silent and exits 0. To see what was actually proved, add <code>--format json</code> and read <code>buildSignerURI</code>: it names the workflow and the tag that built those bytes. Note that <code>gh attestation verify</code> without <code>--bundle</code> asks GitHub for the attestation directly and requires you to be logged in, even for a public repository. The bundle route above avoids that, which is why it is the one we document.
    </p>
    <h3>npm provenance.</h3>
    <p>
      Crucible publishes to npm with Trusted Publishing. The npm registry shows provenance for every published version (which GitHub Actions run produced it, which git commit, which workflow). Verify at <a href="https://www.npmjs.com/package/@glassmkr/crucible">npmjs.com/package/@glassmkr/crucible</a>.
    </p>
  </section>

  <section class="trust-section" id="data">
    <h2>Data handling</h2>

    <h3>What data leaves your server</h3>
    <ul>
      <li><strong>Metrics</strong> (CPU, memory, disk, network) as numeric values.</li>
      <li><strong>Hardware sensor readings</strong> (SMART attributes, IPMI sensors, ECC counts, RAID/ZFS pool state) as structured values.</li>
      <li><strong>Software state</strong> (failed systemd unit names, kernel vulnerability status, count of pending package updates).</li>
      <li><strong>Server identification</strong> (hostname, IP address, distro, kernel version, DMI vendor/product where available).</li>
      <li><strong>Bounded diagnostic excerpts</strong> attached to a firing alert: the last few journal lines of a failed systemd unit, and matched kernel dmesg events. These can contain application strings, so they are in scope for your secret-hygiene review.</li>
      <li><strong>No bulk log streaming, no raw command output, no arbitrary file reads.</strong></li>
    </ul>

    <h3>Data storage</h3>
    <p>
      PostgreSQL + ClickHouse on a server in Amsterdam, Netherlands (verifiable in the RIR record; see infrastructure provenance below). Daily encrypted backups stored on a second server in the same datacenter.
    </p>

    <h3>GDPR posture</h3>
    <p>
      Operated from the EU under Czech sole-trader registration. EU GDPR rules apply to your data. The <a href="/privacy">Privacy Policy</a> describes data processing, your GDPR rights (access, correction, deletion, portability), and the DSAR process.
    </p>

    <h3>Data retention</h3>
    <p>
      Alert state and metrics for active customers are stored indefinitely while the account is active. On account deletion, all customer data is purged within 30 days (some derived aggregations may persist in backups for up to 90 days before backup rotation purges them). DSAR deletion requests are honoured within the GDPR-required timeframe.
    </p>
  </section>

  <section class="trust-section" id="access">
    <h2>Who can access your data</h2>
    <p>
      This section applies to the hosted instance at app.glassmkr.com. A self-hosted deployment is yours alone: we have no access to it, and nothing about your servers reaches us.
    </p>
    <p>
        Glassmkr is operated by one person, who has the technical access required
        to run the hosted service. Access is not proactive: customer data is read only when needed for support tickets, debugging reported issues, or investigating service incidents.
    </p>
    <h3>What we do to manage this responsibly</h3>
    <ul>
      <li>Operator access to production systems is logged and retained for 90 days.</li>
      <li>We don’t sell customer data.</li>
      <li>We don’t share customer data with third parties beyond what’s required to deliver the service (Stripe for billing, Resend for email, the LLM inference layer on our own infrastructure).</li>
      <li>We run a monitoring service. There is no advertising and no data business behind it.</li>
    </ul>
    <p>
      If your security requirements rule out any hosted service, you don’t have to ask for an exception: the whole stack is open source and <a href="/docs/self-hosting">self-hostable</a>, and a self-hosted deployment is one we cannot access at all.
    </p>
  </section>

  <section class="trust-section" id="disclosure">
    <h2>Security disclosure</h2>
    <p>
      If you’ve found a security issue in Crucible, the dashboard, or any Glassmkr infrastructure:
    </p>
    <h3>Email</h3>
    <p>
      <a href="mailto:security@glassmkr.com">security@glassmkr.com</a>. If you would rather not send details in plaintext, use the GitHub private vulnerability report below.
    </p>
    <h3>GitHub private vulnerability reporting</h3>
    <p>
      The agent repository has GitHub’s private vulnerability reporting enabled. <a href="https://github.com/glassmkr/crucible/blob/main/SECURITY.md">SECURITY.md</a> describes both routes: the private report form on GitHub and <a href="mailto:security@glassmkr.com">security@glassmkr.com</a>.
    </p>
    <h3>What to include</h3>
    <p>
      Description of the issue, reproduction steps if applicable, your contact information if you’d like to coordinate disclosure.
    </p>
    <h3>Response timing</h3>
    <p>
      We’ll acknowledge within 24 hours and provide an initial assessment within 72 hours.
    </p>
    <h3>Disclosure timeline</h3>
    <p>
      We coordinate disclosure timing with reporters. Default 90 days from acknowledgement to public disclosure, longer if needed for complex fixes, shorter if the issue is actively exploited.
    </p>
    <h3>Bug bounty</h3>
    <p>
      We don’t currently run a formal bug bounty program. Verified security findings get credited (with reporter’s permission) in our security disclosures, and we’ll send a thank-you bottle of whisky or equivalent.
    </p>
  </section>

  <section class="trust-section" id="provenance">
    <h2>Infrastructure provenance</h2>
    <p>What Glassmkr runs on:</p>
    <h3>Dashboard</h3>
    <p>
      SvelteKit application on a bare-metal Linux server in Amsterdam, behind Cloudflare. PostgreSQL + ClickHouse for storage. pgBackRest for PostgreSQL backups. Self-hosted on dedicated hardware, not a cloud VM.
    </p>
    <p>
      You do not have to take the location on trust. The dashboard answers on
      <code>89.187.174.239</code> and the GPU host on <code>185.229.190.89</code>;
      both are RIPE allocations with country code <code>NL</code> and the network
      name <code>CDN77-AMS</code>. One command, from your machine, no account:
    </p>
    <pre><code>whois 89.187.174.239 | grep -Ei '^(country|netname)'</code></pre>
    <p>
      One nuance that the phrase "EU jurisdiction" was hiding, so it is stated
      here instead: the servers are in the Netherlands, and the network
      operator's legal entity is DataCamp Limited, registered in London. The
      data controller is in the Czech Republic and is named on the
      <a href="/privacy">privacy policy</a>. Those are three different places and
      a single phrase could not carry all three honestly.
    </p>
    <h3>AI assistant (Furnace)</h3>
    <p>
      Self-hosted Gemma 4 26B model on a single NVIDIA L4 GPU in Amsterdam, served via llama.cpp. No third-party LLM APIs (no OpenAI, no Anthropic, no Google): analysis runs on the host named above, on the same Amsterdam network as the dashboard, over WireGuard.
    </p>
    <h3>Networking</h3>
    <p>
      WireGuard between the dashboard server and the GPU server. TLS termination at Cloudflare for public endpoints. Origin certs from Let’s Encrypt.
    </p>
    <h3>Email</h3>
    <p>
      Resend for transactional email (account notifications, password resets). Customer alert notifications routed via your configured channels (Telegram, Slack, etc.), not through our email service.
    </p>
    <h3>Billing</h3>
    <p>
      Stripe for payments. We store the minimum required (Stripe customer ID, subscription state). Card numbers and CVVs are not stored by Glassmkr; they live in Stripe.
    </p>
    <h3>No AWS, GCP, or Azure dependency.</h3>
    <p>
      Glassmkr does not rely on any major cloud provider for serving customer requests. If AWS has an outage, Glassmkr keeps running.
    </p>
    <h3>Self-hosted everything.</h3>
    <p>
      Where possible, we run our own infrastructure. The dashboard, the database, the AI model, the WireGuard mesh. Same infrastructure model we expect from our customers.
    </p>
  </section>

  <section class="trust-section" id="gaps">
    <h2>What we don’t have yet</h2>
    <p>We’re honest about gaps:</p>
    <ul>
      <li><strong>No ISO 27001 certification.</strong> Pursuing this depends on customer demand. Email if your procurement requires it.</li>
      <li><strong>No formal SLA.</strong> We run on infrastructure designed for high availability, but we don’t currently offer monetary SLA guarantees.</li>
      <li><strong>No dedicated on-call team.</strong> Most operational issues are resolved within hours during European working hours; outages outside those hours may take longer.</li>
    </ul>
    <p>
      If these gaps are blockers for your team, we want to know. Email <a href="mailto:contact@glassmkr.com">contact@glassmkr.com</a>.
    </p>
  </section>

  <footer class="trust-footer">
    <p>Last updated: 2026-08-24.</p>
  </footer>
</article>

<style>
  /* First-class technical page on the wide shell (spec 16.2); prose keeps
     its measure, tables and diagrams take the width. */
  .trust {
    width: min(100%, var(--page-max));
    margin: 0 auto;
    padding: 0 var(--page-gutter);
  }
  .trust section p,
  .trust section li {
    max-width: 76ch;
  }

  .trust-hero {
    padding: 72px 0 48px;
  }
  .trust-hero h1 {
    font-size: clamp(2.4rem, 1.8rem + 2.4vw, 3.9rem);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.04;
    color: var(--text-primary);
    margin: 0 0 22px;
    text-wrap: balance;
  }
  .lede {
    font-size: clamp(16px, 1.8vw, 18px);
    line-height: 1.7;
    color: var(--text-secondary);
    margin: 0 0 36px;
    max-width: 680px;
  }
  /* Plain links with hairline separators, not a bordered card. This was the
     last large container on the page. */
  .trust-toc {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 28px;
    border-top: 1px solid var(--border-subtle);
  }
  .trust-toc a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-subtle);
    transition: color 0.12s;
  }
  .trust-toc a:hover { color: var(--accent); }

  .trust-section {
    padding: 48px 0;
    border-top: 1px solid var(--surface-border);
    scroll-margin-top: 80px;
  }
  .trust-section h2 {
    font-size: clamp(24px, 3.2vw, 32px);
    font-weight: 600;
    letter-spacing: -0.005em;
    color: var(--text-primary);
    margin: 0 0 24px;
  }
  .trust-section h3 {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 28px 0 10px;
  }
  .trust-section p {
    font-size: 15.5px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin: 0 0 16px;
  }
  .trust-section p:last-child { margin-bottom: 0; }
  .trust-section a {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .trust-section a:hover { text-decoration-thickness: 2px; }
  .trust-section code {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    background: rgba(255, 107, 53, 0.06);
    color: var(--accent);
    padding: 2px 5px;
    border-radius: var(--radius-sm);
  }
  .trust-section ul {
    padding-left: 20px;
    margin: 0 0 16px;
  }
  .trust-section li {
    font-size: 15px;
    line-height: 1.75;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .trust-section strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .trust-footer {
    margin: 64px 0 80px;
    padding: 24px 0;
    border-top: 1px solid var(--surface-border);
    font-size: 13px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }

  @media (max-width: 720px) {
    .trust-hero { padding: 56px 0 36px; }
    .trust-section { padding: 36px 0; }
  }
</style>
