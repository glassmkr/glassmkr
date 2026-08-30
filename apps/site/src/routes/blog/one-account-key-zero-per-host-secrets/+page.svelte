<svelte:head>
  <title>One account key, zero per-host secrets - Glassmkr Blog</title>
  <meta name="description" content="Most fleets onboard into monitoring by copying one powerful credential onto every box. glassmkr-crucible enroll does the opposite: one account key stays in your control plane, each host self-registers by a stable machine ID and holds only its own collector key, and running the automation twice does nothing." />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/blog/one-account-key-zero-per-host-secrets" />
  <meta property="og:title" content="One account key, zero per-host secrets" />
  <meta property="og:description" content="glassmkr-crucible enroll: bake one write-scoped account key into your automation, each host self-registers by machine ID and holds only its own collector key. Idempotent across re-runs and re-images." />
  <meta property="og:image" content="https://glassmkr.com/og/one-account-key-zero-per-host-secrets.png?v=20260830" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Glassmkr" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="One account key, zero per-host secrets" />
  <meta name="twitter:description" content="One account key stays in your control plane; each host self-registers by machine ID and holds only its own collector key. Idempotent by construction." />
  <meta name="twitter:image" content="https://glassmkr.com/og/one-account-key-zero-per-host-secrets.png?v=20260830" />
  <link rel="canonical" href="https://glassmkr.com/blog/one-account-key-zero-per-host-secrets" />

  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "One account key, zero per-host secrets",
    description: "How glassmkr-crucible enroll onboards a bare-metal fleet from a single write-scoped account key used only for the one registration call, keying each server by a stable machine ID so re-runs and re-images are idempotent.",
    image: "https://glassmkr.com/og/one-account-key-zero-per-host-secrets.png?v=20260830",
    datePublished: "2026-07-15",
    dateModified: "2026-07-15",
    author: { "@type": "Organization", name: "Glassmkr", url: "https://glassmkr.com" },
    publisher: { "@type": "Organization", name: "Glassmkr", logo: { "@type": "ImageObject", url: "https://glassmkr.com/og/one-account-key-zero-per-host-secrets.png?v=20260830" } },
    mainEntityOfPage: "https://glassmkr.com/blog/one-account-key-zero-per-host-secrets",
    articleSection: "Engineering"
  })}</` + `script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://glassmkr.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://glassmkr.com/blog" },
      { "@type": "ListItem", position: 3, name: "One account key, zero per-host secrets", item: "https://glassmkr.com/blog/one-account-key-zero-per-host-secrets" }
    ]
  })}</` + `script>`}
</svelte:head>

<div class="container-narrow">
  <article class="post">
  <img class="post-hero" src="/og/one-account-key-zero-per-host-secrets.png?v=20260830" alt="Glassmkr blog card with the hexagon logo and the title One account key, zero per-host secrets" width="1200" height="630" loading="eager" decoding="async" />
    <header class="post-header">
      <p class="post-meta">July 2026 · Engineering · 5 min read</p>
      <h1>One account key, zero per-host secrets</h1>
      <p class="lede">
        There is a quiet compromise in how most fleets get onboarded into a monitoring tool: you mint one credential and copy it onto every box. It works, and it costs you twice. A credential powerful enough to enroll servers now sits on every server, so any single compromised host leaks something that can reach the whole account. And you have to track which host got which secret, so the moment a machine is re-imaged you get drift, duplicates, and a node count that no longer matches reality. We wanted the opposite: each host ends up holding only a credential scoped to itself, and running the same automation twice does nothing.
      </p>
    </header>

    <p>
      That is what the <code>glassmkr-crucible enroll</code> subcommand (Crucible 0.13.21 and later) is for. It is the answer to the practical question every operator asks on day one: what do I drop into my Ansible role, my cloud-init, or my post-install script so a host shows up in monitoring by itself?
    </p>

    <h2>What enroll does</h2>
    <p>
      You bake a single write-scoped account key (<code>gmk_acct_live_</code>) into your automation, held in a vault or secret manager. Each host runs <code>enroll</code> once. On that one run it:
    </p>
    <ol>
      <li><strong>Derives a stable machine ID.</strong> The DMI product UUID (<code>/sys/class/dmi/id/product_uuid</code>), falling back to <code>/etc/machine-id</code> where DMI is unavailable (many VMs and containers). This is the host's durable identity.</li>
      <li><strong>Registers itself with the Dashboard</strong> under that ID, or re-attaches to the server that ID already maps to, and applies any tags you pass.</li>
      <li><strong>Receives its own per-server collector key</strong> (<code>gmk_cru_live_</code>), writes that key (and only that key) to <code>/etc/glassmkr/crucible.yaml</code> at mode 0600, then installs and starts the agent.</li>
    </ol>
    <p>
      The account key is used only for that single registration call: <code>enroll</code> itself never writes it to disk. What <code>enroll</code> leaves on the box is the collector key, and nothing else. How your automation hands <code>enroll</code> the account key is a separate question, and the examples below keep it out of the image.
    </p>

    <h2>Idempotent by machine ID</h2>
    <p>
      Because the server record is keyed by the host's stable machine ID, re-running <code>enroll</code> is safe by construction. A second run on an already-enrolled host maps back to the same server instead of creating a duplicate. Re-image or rebuild a host that keeps the same machine identity and it re-attaches to its existing server, so its history and alert state survive the rebuild rather than starting over as a fresh node and eating another quota slot.
    </p>
    <p>
      In Ansible this gets even cheaper. An <code>args: creates: /etc/glassmkr/crucible.yaml</code> guard makes the enroll task skip outright on any host that is already enrolled, so a playbook you run nightly does no work on steady-state hosts.
    </p>
    <p>
      The one thing to watch is cloned images that share a machine ID: they would collapse onto a single server record. Give each instance a distinct machine identity, which cloud-init already does by regenerating <code>/etc/machine-id</code> on first boot.
    </p>

    <h2>The security property: the strong key stays in the control plane</h2>
    <p>
      Two keys, very different power. The account key <code>enroll</code> needs is write-scoped: it can create servers (that is what <code>enroll</code> uses), and because the scopes are hierarchical it can also list every server in the account, read all of their telemetry and alerts, and update or delete any of them. Only rotating a collector key needs a higher admin scope. That account key lives only in your secret store. The per-server collector key can do exactly one thing: push that one server's telemetry. It is rejected from every account-management endpoint, so it cannot list, create, delete, or read any other server.
    </p>
    <p>
      So the blast radius of a compromised host is that host: a credential that can push one server's telemetry, not the key that could enumerate, create, or delete the rest of your fleet. The powerful credential never leaves your control plane.
    </p>
    <p>
      The practical hygiene follows from that. Keep the account key in Ansible Vault or a secret manager. Set <code>no_log: true</code> on the enroll task so it stays out of Ansible's output. Treat cloud-init user-data as sensitive, since many clouds expose it through the instance metadata service. One honest caveat: the account key is passed as a process argument during that single enroll call, so it is not persisted to disk but it is briefly visible to local process listing. The guidance is a secret manager plus <code>no_log</code>, not a claim of invisibility.
    </p>

    <h2>Copy-paste</h2>
    <p>Ansible, install then enroll, idempotent via the <code>creates:</code> guard:</p>
    <pre><code>- name: Install the Crucible agent globally
  community.general.npm:
    name: "@glassmkr/crucible"
    global: true
    state: present

- name: Enroll this host into Glassmkr (idempotent)
  ansible.builtin.command:
    cmd: glassmkr-crucible enroll --account-key "&#123;&#123; vault_glassmkr_account_key &#125;&#125;" --tags "&#123;&#123; group_names | join(',') &#125;&#125;"
  args:
    creates: /etc/glassmkr/crucible.yaml
  no_log: true</code></pre>

    <p>cloud-init, self-register on first boot. Do not embed the account key in user-data: user-data is readable through the instance metadata service and persists on the instance. Fetch it from your secret manager at boot instead:</p>
    <pre><code>#cloud-config
runcmd:
  - npm install -g @glassmkr/crucible
  # Replace `your-secret-manager get` with your platform's secret fetch
  # (aws ssm get-parameter, gcloud secrets versions access, vault kv get, ...).
  - 'ACCT_KEY="$(your-secret-manager get glassmkr/account-key)"; glassmkr-crucible enroll --account-key "$ACCT_KEY" --no-verify'</code></pre>

    <p>Or at the end of any post-install, kickstart, or preseed script. Source the key from your secret store, not a literal in the script: a literal persists on disk and in provisioning logs.</p>
    <pre><code>ACCT_KEY="$(your-secret-manager get glassmkr/account-key)"
sudo npm install -g @glassmkr/crucible &amp;&amp; \
  sudo glassmkr-crucible enroll --account-key "$ACCT_KEY" --tags "prod,web"</code></pre>

    <p>
      <code>--no-verify</code> skips the post-registration connectivity check so <code>enroll</code> does not block while the network is still coming up during boot; the agent verifies on its first snapshot a minute later. Installing the agent needs Node.js 24 or later on the host.
    </p>

    <h2>Updating the fleet</h2>
    <p>
      Onboarding is the first half; keeping the agent current is the other, and it has the same shape. The agent is a global npm package behind a systemd unit, so an update is two commands, and the collector key already on disk is left alone: you are swapping the binary, not re-enrolling.
    </p>
    <pre><code>sudo npm install -g @glassmkr/crucible@&lt;version&gt; &amp;&amp; \
  sudo systemctl restart glassmkr-crucible</code></pre>
    <p>
      Pin an explicit version rather than a floating tag, so every host lands on the same build and a release published mid-rollout cannot split your fleet. Across a fleet it is the Ansible task you already have, with a version pin that makes a re-run on an already-current host a no-op:
    </p>
    <pre><code>- name: Update Crucible to a pinned version
  community.general.npm:
    name: "@glassmkr/crucible"
    version: "&lt;version&gt;"
    global: true
    state: present
  notify: restart crucible

# handlers/main.yml
- name: restart crucible
  ansible.builtin.systemd:
    name: glassmkr-crucible
    state: restarted</code></pre>
    <p>Without a config-management tool, a fan-out over your inventory does the same thing. Use <code>ssh -n</code> so ssh does not swallow the loop's stdin and stop after the first host:</p>
    <pre><code>while read -r host; do
  ssh -n "$host" 'sudo npm install -g @glassmkr/crucible@&lt;version&gt; &amp;&amp; sudo systemctl restart glassmkr-crucible'
done &lt; hosts.txt</code></pre>
    <p>
      Each server reports its collector version to the Dashboard, so after a rollout you can confirm the whole fleet actually moved rather than assume it did. One caveat: a release that adds a new privileged collector action says so in its notes, and hosts running the agent as the unprivileged service user need a one-time <code>glassmkr-crucible init</code> re-run (or wrapper refresh) to grant the new read.
    </p>

    <h2>Where this sits</h2>
    <p>
      <code>enroll</code> is a convenience wrapper over the documented public API (<code>POST /api/v1/servers</code> plus the agent install), not a new or private surface. Use the raw API directly when your control plane, not the host, should decide identity and hold the collector keys; that version, with a 50-server provisioning loop, is in the <a href="/docs/programmatic-api">Programmatic API guide</a>. When the host should register itself, use <code>enroll</code>. The full how-to, with the Ansible and cloud-init examples above plus the key-lifecycle details, is at <a href="/docs/automated-onboarding">Automated fleet onboarding</a>.
    </p>
    <p>
      Node quota still applies: each enrolled host consumes one node against your plan, with the first three free. The point of <code>enroll</code> is not a pricing change. It is that the credential your hosts hold should be the weakest one that does the job, and that onboarding a fleet should be something you can run twice without thinking about it.
    </p>
  </article>
</div>

<style>
  .post-hero { display:block; width:100%; height:auto; aspect-ratio:1200/630;
    border-radius:6px; border:1px solid var(--surface-border);
    margin:24px 0 20px; background:var(--surface-raised); }
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
  .post ul,
  .post ol {
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
  .post pre {
    margin: 18px 0;
    padding: 16px 20px;
    background: var(--surface-subtle);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .post pre code {
    background: transparent;
    padding: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .post strong {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
