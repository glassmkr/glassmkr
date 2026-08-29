<script lang="ts">
  import rules from "$lib/data/rules.json";
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Automated onboarding", item: "https://glassmkr.com/docs/automated-onboarding" },
    ],
  });
</script>

<svelte:head>
  <title>Automated fleet onboarding with glassmkr-crucible enroll: Glassmkr documentation</title>
  <meta name="description" content="Onboard a whole fleet with one write-scoped account key and zero per-host secrets. glassmkr-crucible enroll self-registers each host by a stable machine ID, idempotent across re-runs and re-images. Ansible and cloud-init examples." />
  <link rel="canonical" href="https://glassmkr.com/docs/automated-onboarding" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/automated-onboarding" />
  <meta property="og:title" content="Automated fleet onboarding (glassmkr-crucible enroll)" />
  <meta property="og:description" content="One account key baked into automation, each host self-registers by machine ID and gets its own collector key. Idempotent, no per-host secrets." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Automated fleet onboarding (glassmkr-crucible enroll)" />
  <meta name="twitter:description" content="One account key, zero per-host secrets. Idempotent, machine-ID keyed. Ansible + cloud-init." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<div class="docs-layout">
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <a href="/docs" class="sidebar-section">&larr; Back to docs</a>
      <a href="#overview" class="sidebar-link">Overview</a>
      <a href="#how-it-works" class="sidebar-link">How enroll works</a>
      <a href="#prerequisites" class="sidebar-link">Prerequisites</a>
      <a href="#ansible" class="sidebar-link">Ansible</a>
      <a href="#cloud-init" class="sidebar-link">cloud-init</a>
      <a href="#one-liner" class="sidebar-link">Post-install one-liner</a>
      <a href="#idempotency" class="sidebar-link">Idempotent by machine ID</a>
      <a href="#keys" class="sidebar-link">Where the keys live</a>
      <a href="#next" class="sidebar-link">Next steps</a>
    </nav>
  </aside>

  <article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / AUTOMATED ONBOARDING</p>
      <h1>Automated fleet onboarding</h1>
      <p class="docs-subtitle">One write-scoped account key, zero per-host secrets. The <code>glassmkr-crucible enroll</code> subcommand (Crucible 0.13.21 and later) lets every host self-register, receive its own collector key, and start reporting, with no dashboard clicks in the loop.</p>
    </header>

    <section id="overview">
      <h2><a href="#overview" class="anchor-link">#</a>Overview</h2>
      <p>The single-server flow in <a href="/docs/getting-started">Getting started</a> creates the server in the dashboard first (to get a collector key), then installs the agent with that key. That is a manual step per host.</p>
      <p>For a fleet, <code>enroll</code> collapses those two steps into one command that runs on the host itself. You bake a single <code>write</code>-scoped account key (<code>gmk_acct_live_</code>) into your automation. Each host runs <code>enroll</code> once; the command registers the server with the Dashboard, receives that server's own collector key (<code>gmk_cru_live_</code>), writes the agent config, and starts the service.</p>
      <div class="callout">
        <strong>Prefer the raw API?</strong> <code>enroll</code> is a convenience wrapper over the same endpoints documented in the <a href="/docs/programmatic-api">Programmatic API quickstart</a> (<code>POST /api/v1/servers</code> plus the install). Use the API directly when your control plane, not the host, decides identity and holds the collector keys.
      </div>
    </section>

    <section id="how-it-works">
      <h2><a href="#how-it-works" class="anchor-link">#</a>How enroll works</h2>
      <p>A single <code>enroll</code> run does four things on the host:</p>
      <ol>
        <li><strong>Derives a stable machine ID.</strong> It reads the DMI product UUID (<code>/sys/class/dmi/id/product_uuid</code>), falling back to <code>/etc/machine-id</code> where DMI is unavailable (many VMs and containers). This ID is the host's durable identity.</li>
        <li><strong>Registers the server.</strong> It calls the Dashboard with your account key, creating a server keyed by that machine ID (or re-attaching to the existing one), and applies any <code>--tags</code>.</li>
        <li><strong>Writes only the collector key.</strong> The Dashboard returns a per-server collector key (<code>gmk_cru_live_</code>). <code>enroll</code> writes that key (and only that key) to <code>/etc/glassmkr/crucible.yaml</code> (mode 0600), then installs and starts the <code>glassmkr-crucible</code> systemd unit, the same on-disk result as <code>glassmkr-crucible init</code>.</li>
        <li><strong>Discards the account key.</strong> The account key is used for the one registration call and is never written to disk. See <a href="#keys">Where the keys live</a>.</li>
      </ol>
      <p>By default <code>enroll</code> verifies connectivity to the Dashboard after registering (the same check <code>init</code> runs). Pass <code>--no-verify</code> to skip that round-trip so the command returns immediately; the agent still verifies on its first snapshot a minute later. That is the right choice inside a boot sequence, where the network may not be fully up yet (see <a href="#cloud-init">cloud-init</a>).</p>
    </section>

    <section id="prerequisites">
      <h2><a href="#prerequisites" class="anchor-link">#</a>Prerequisites</h2>
      <ul>
        <li>A <code>write</code>-scoped account key (<code>gmk_acct_live_</code>), minted once. See <a href="/docs/programmatic-api">Programmatic API</a> for how to create one (it needs a step-up password re-auth). Store it in your automation's secret store, not in a machine image.</li>
        <li>Crucible 0.13.21 or later on the host (the release that introduced <code>enroll</code>). Installed globally with <code>npm install -g @glassmkr/crucible</code>, which needs Node.js 22.19.0 or newer.</li>
        <li>Outbound HTTPS on port 443 to <code>app.glassmkr.com</code>. No inbound ports.</li>
        <li>Node-quota headroom: each enrolled host consumes one node against the hosted cap. Self-hosted has no node limit.</li>
      </ul>
    </section>

    <section id="ansible">
      <h2><a href="#ansible" class="anchor-link">#</a>Ansible</h2>
      <p>Install the agent, then enroll. The <code>creates:</code> guard makes the enroll task a no-op on hosts that already have <code>/etc/glassmkr/crucible.yaml</code>, so re-running the playbook is safe and cheap.</p>
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
      <ul>
        <li><code>vault_glassmkr_account_key</code> is your <code>gmk_acct_live_</code> key, held in Ansible Vault. It is passed for the single registration call and never written to a file on the host.</li>
        <li><code>group_names | join(',')</code> tags each host with the inventory groups it belongs to, so the dashboard grouping mirrors your inventory.</li>
        <li><code>no_log: true</code> keeps the key out of Ansible's task output and logs.</li>
      </ul>
    </section>

    <section id="cloud-init">
      <h2><a href="#cloud-init" class="anchor-link">#</a>cloud-init</h2>
      <p>Enroll from <code>runcmd</code> so a host registers itself the first time it boots:</p>
      <pre><code>#cloud-config
runcmd:
  - npm install -g @glassmkr/crucible
  - glassmkr-crucible enroll --account-key "gmk_acct_live_..." --no-verify</code></pre>
      <p><code>--no-verify</code> keeps enrollment from blocking on a Dashboard round-trip while the network is still coming up during boot. The agent verifies on its first push.</p>
      <p class="note">The <code>npm install</code> line assumes Node.js 22.19.0 or newer is already on the image. If it is not, install it first (a preceding <code>runcmd</code> step, or a base image with Node bundled). And treat cloud-init user-data as sensitive: it often stays readable via the instance metadata service, so pull the account key from a secret manager in <code>runcmd</code> rather than hardcoding it wherever your platform supports that.</p>
    </section>

    <section id="one-liner">
      <h2><a href="#one-liner" class="anchor-link">#</a>Post-install one-liner</h2>
      <p>Drop this at the end of any post-install, kickstart, preseed, or provisioning script:</p>
      <pre><code>sudo npm install -g @glassmkr/crucible &amp;&amp; \
  sudo glassmkr-crucible enroll --account-key "gmk_acct_live_..." --tags "prod,web"</code></pre>
      <p>Same effect as the Ansible and cloud-init flows: install the agent, self-register by machine ID, write the collector key, and start the service.</p>
    </section>

    <section id="idempotency">
      <h2><a href="#idempotency" class="anchor-link">#</a>Idempotent by machine ID</h2>
      <p>Because the server is keyed by the host's stable machine ID, running <code>enroll</code> more than once is safe:</p>
      <ul>
        <li><strong>Re-runs re-attach, they do not duplicate.</strong> A second <code>enroll</code> on an already-enrolled host maps back to the same server record. With the Ansible <code>creates:</code> guard, the command is skipped outright once <code>/etc/glassmkr/crucible.yaml</code> exists.</li>
        <li><strong>Re-images map back to the same server.</strong> Rebuild or re-image a host that keeps the same machine identity and it re-attaches to its existing server, preserving history and alert state instead of creating a new node (and consuming another quota slot).</li>
        <li><strong>Keep machine identity unique per host.</strong> Hosts that share a machine ID would collapse onto one server record. When you clone from a golden image, make sure each instance gets a distinct identity: regenerate <code>/etc/machine-id</code> on first boot (cloud-init does this by default) so hosts with no distinct DMI UUID do not collide.</li>
      </ul>
    </section>

    <section id="keys">
      <h2><a href="#keys" class="anchor-link">#</a>Where the keys live</h2>
      <p>The security property of <code>enroll</code> is that the powerful credential never touches the host disk. Only a narrowly-scoped, per-host credential does.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Key</th><th>Prefix</th><th>Where it lives in this flow</th><th>Scope</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Account key</strong></td>
              <td><code>gmk_acct_live_</code></td>
              <td>Your automation's secret store only (Ansible Vault, a secret manager, a CI secret). Never written to disk by <code>enroll</code>.</td>
              <td>Account-wide: can create servers across the account. Keep it in the control plane.</td>
            </tr>
            <tr>
              <td><strong>Collector key</strong></td>
              <td><code>gmk_cru_live_</code></td>
              <td><code>/etc/glassmkr/crucible.yaml</code> on the host (mode 0600, readable by the non-root <code>glassmkr</code> user).</td>
              <td>One server's telemetry only. Cannot list other servers, create servers, or read account settings.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>So a compromised host leaks only its own collector key, scoped to that one server's telemetry, not the account key that can enroll the rest of your fleet. If a collector key is exposed, rotate it with <code>POST /api/v1/servers/&#123;id&#125;/rotate-key</code>; if the account key is exposed, revoke it from Settings or <code>DELETE /api/v1/account/keys/&#123;id&#125;</code>.</p>
      <p class="note">Last updated: 2026-07-14. <code>enroll</code> was introduced in Crucible 0.13.21.</p>
    </section>

    <section id="next">
      <h2><a href="#next" class="anchor-link">#</a>Next steps</h2>
      <ul>
        <li><a href="/docs/getting-started">Getting started</a>: the single-server flow, and the two kinds of keys explained.</li>
        <li><a href="/docs/programmatic-api">Programmatic API</a>: the raw endpoints behind <code>enroll</code>, plus a 50-server provisioning loop, rate limits, and the audit log.</li>
        <li><a href="/docs/configuration">Configuration reference</a>: everything you can set in <code>/etc/glassmkr/crucible.yaml</code>.</li>
        <li><a href="/docs/rules">Alert rules</a>: the {rules.length} rules the Dashboard evaluates on every snapshot.</li>
      </ul>
    </section>
  </article>
</div>

<style>
  .docs-layout { display: flex; max-width: 960px; margin: 0 auto; padding: 60px 24px 120px; gap: 48px; }
  .sidebar { position: sticky; top: 80px; align-self: flex-start; flex-shrink: 0; width: 180px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-section { display: block; padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); text-decoration: none; margin-bottom: 8px; }
  .sidebar-link { display: block; padding: 6px 12px; font-size: 13px; color: var(--text-tertiary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: color 0.15s, border-color 0.15s; }
  .sidebar-link:hover { color: var(--text-secondary); }
  .docs-content { flex: 1; min-width: 0; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em; color: var(--text-tertiary); margin-bottom: 8px; }
  h1 { font-size: 2.25rem; color: var(--text-primary); margin-bottom: 0.25rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 2rem; line-height: 1.6; }
  section { margin-bottom: 3.5rem; scroll-margin-top: 80px; }
  h2 { font-size: 1.5rem; color: var(--text-primary); margin-bottom: 1rem; position: relative; }
  h3 { font-size: 1.1rem; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p, li { color: var(--text-secondary); line-height: 1.7; margin-bottom: 0.75rem; }
  .anchor-link { color: transparent; text-decoration: none; margin-right: 4px; font-weight: 400; transition: color 0.15s; }
  h2:hover .anchor-link { color: var(--text-tertiary); }
  .anchor-link:hover { color: var(--accent) !important; text-decoration: none; }
  pre { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid rgba(245, 166, 35, 0.35); border-radius: var(--radius-md); padding: 14px 16px; overflow-x: auto; margin: 0.75rem 0 1.25rem; }
  pre code { font-family: var(--font-mono); font-size: 0.84rem; line-height: 1.65; color: var(--text-primary); background: transparent; padding: 0; }
  code { font-family: var(--font-mono); background: var(--surface); padding: 2px 6px; border-radius: var(--radius-md); font-size: 0.88em; }
  /* 0.875rem, not 0.85rem, because `code` inside a note is 0.88em and the two
     compound: 13.6 x 0.88 = 11.97px, under this project's own 12px floor. At
     14px the inline code lands at 12.3px and the note still reads as secondary. */
  .note { font-size: 0.875rem; color: var(--text-tertiary); line-height: 1.6; font-style: italic; margin-top: 1rem; }
  .callout { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid var(--accent); border-radius: var(--radius-md); padding: 14px 16px; margin: 16px 0; font-size: 0.9rem; line-height: 1.65; color: var(--text-secondary); }
  .callout strong { color: var(--accent); }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.875rem; }
  thead th { text-align: left; padding: 8px 12px; color: var(--text-tertiary); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--surface-border); }
  tbody td { padding: 7px 12px; color: var(--text-secondary); border-bottom: 1px solid rgba(61, 54, 48, 0.4); vertical-align: top; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: none; }
  @media (max-width: 900px) { .sidebar { display: none; } .docs-layout { gap: 0; padding: 40px 20px 100px; } }

  /* Mobile technical-text floor (taste pass 4.1): 12px minimum on a
     phone; wide tables scroll rather than shrink. */
  @media (max-width: 768px) {
    table, thead th, tbody td { font-size: 12px; }
    code, pre code { font-size: 12px; }
  }
</style>
