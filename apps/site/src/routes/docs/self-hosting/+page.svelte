<script lang="ts">
  import { DASHBOARD_REPO_PUBLIC, AGENT_REPO_URL } from "$lib/repo-state";
  // Self-hosting guide (OSS pivot, 2026-08). The quickstart code block
  // must stay byte-identical to SELF_HOSTING.md in the glassmkr repo and
  // the homepage hero block: if they drift, a stranger's first command
  // fails. Update all three together.
  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://glassmkr.com/docs" },
      { "@type": "ListItem", position: 2, name: "Self-hosting", item: "https://glassmkr.com/docs/self-hosting" },
    ],
  });
</script>

<svelte:head>
  <title>Self-hosting: Glassmkr documentation</title>
  <meta name="description" content="Run the whole Glassmkr stack on your own hardware with Docker Compose: dashboard, Postgres, ClickHouse, and the Crucible agent pointed at your own URL. AGPL-3.0-only, everything included." />
  <link rel="canonical" href="https://glassmkr.com/docs/self-hosting" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://glassmkr.com/docs/self-hosting" />
  <meta property="og:title" content="Self-hosting Glassmkr" />
  <meta property="og:description" content="One compose file: dashboard, Postgres, ClickHouse. Point the agent at your own URL. AGPL-3.0-only, no license key, no node limits." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Self-hosting Glassmkr" />
  <meta name="twitter:description" content="Run the whole stack on your hardware with Docker Compose. AGPL-3.0-only, everything included." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />

  {@html `<script type="application/ld+json">${breadcrumbLd}</` + `script>`}
</svelte:head>

<article class="docs-content">
    <header class="page-header">
      <p class="eyebrow">DOCS / SELF-HOSTING</p>
      <h1>Self-hosting</h1>
      <p class="docs-subtitle">The whole stack on your hardware: dashboard (AGPL-3.0-only), Postgres, ClickHouse, and the Crucible agent (AGPL-3.0-only) reporting to your own URL. Nothing phones home; there is no license key; every feature is enabled.</p>
    </header>

    <section id="overview">
      <h2><a href="#overview" class="anchor-link">#</a>Overview</h2>
      <p>The <a href="https://github.com/glassmkr/crucible">github.com/glassmkr/crucible</a> repository ships a <code>docker-compose.yml</code> that runs three services: the dashboard, Postgres 16 (accounts, servers, alert state), and ClickHouse 24 (telemetry history). Database migrations apply automatically on boot. The compose file sets <code>GLASSMKR_SELF_HOSTED=1</code>, which removes every gate: no plans, no node limits, no billing. The programmatic API is on, and the AI analysis hook turns on as soon as you set <code>LLM_API_URL</code>. The MCP server ships in the box but is off by default: its OAuth server refuses a non-HTTPS origin in production, so it needs TLS in front plus a few environment variables. The flow has been exercised on the hosted origin, not yet on a self-hosted one. The <a href="/docs/self-hosting">self-hosting guide</a> lists them.</p>
    </section>

    <section id="prerequisites">
      <h2><a href="#prerequisites" class="anchor-link">#</a>Prerequisites</h2>
      <ul>
        <li>Docker with the compose plugin (or a Postgres 16 + ClickHouse 24 you operate yourself; the app is configured entirely by environment variables).</li>
        <li>2 GB RAM is comfortable for a small fleet; ClickHouse is the hungriest part.</li>
        <li>Linux hosts to monitor, with Node 22.19.0+ for the npm agent install (the binary install needs no Node at all).</li>
        <li>Headroom on the monitored hosts for the agent itself. Measured on a two-disk Supermicro running Rocky 9.8: 40 samples over 20 minutes, spanning four collection cycles, gave 77 to 82 MB resident with a high-water mark of 103 MB that did not move during the run. Budget around 150 MB and you have room. Hosts with more disks and sensors to enumerate will sit higher, because the cost scales with what there is to walk.</li>
      </ul>
    </section>

    <section id="quickstart">
      <h2><a href="#quickstart" class="anchor-link">#</a>Quickstart</h2>
      <!-- The site deploys before the repository goes public, because the
           installer gate can only pass once this build is live and nothing
           should go public while that gate is red. So for a short window the
           first line below points at a URL that answers 404. Say so here
           rather than letting someone find out by running it. -->
      {#if !DASHBOARD_REPO_PUBLIC}
        <div class="callout callout-pending">
          <strong>The dashboard repository is not public yet.</strong>
          The clone below will fail until it is. The agent is already public and
          AGPL-3.0-only at <a href={AGENT_REPO_URL}>github.com/glassmkr/crucible</a>, and
          everything else on this page is accurate for the moment the repository
          opens. If you want to be told when that happens, mail
          <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a>.
        </div>
      {/if}
      <pre><code>git clone https://github.com/glassmkr/glassmkr.git
cd glassmkr
cp env.selfhost.example .env
./scripts/selfhost-setup.sh     # generates the secrets
docker compose up -d</code></pre>
      <p>Then open <code>http://localhost:3000</code>, register the first account, and you are on the dashboard.</p>
      <div class="callout">
        <strong>GLASSMKR_KEY_PEPPER</strong> is the pepper for API-key hashing. <code>selfhost-setup.sh</code> generates it, and re-running the script never overwrites it. Never change it after first boot; changing it invalidates every issued key.
      </div>
      <p>Migrations run automatically: ClickHouse's on every <code>up</code> (they are idempotent), Postgres's from the dashboard container before the app starts (tracked, so only new ones apply).</p>
    </section>

    <section id="agent">
      <h2><a href="#agent" class="anchor-link">#</a>Pointing an agent at your dashboard</h2>
      <p>Create the server in your dashboard (or via <code>POST /api/v1/servers</code> with a write key from Settings); it returns the per-server <code>gmk_cru_live_...</code> key once. Then on the server, one command installs the agent and points it at YOUR dashboard:</p>
      <pre><code>curl -fsSL https://glassmkr.com/install.sh | sudo bash -s -- \
  --api-key "gmk_cru_live_..." \
  --ingest-url "http://your-dashboard-host:3000/api/v1/ingest"</code></pre>
      <p>The URL must be the full <code>/api/v1/ingest</code> endpoint (a bare base URL also works; the agent appends the path and says so). The installer allowlists exactly that origin for the agent's endpoint policy, which is what makes an http or private-network dashboard address work; https endpoints on public DNS need nothing extra.</p>
      <p>If you install the npm package yourself instead, the same two flags on <code>glassmkr-crucible init</code> do the same thing (plus <code>--allow-endpoint-origin &lt;origin&gt;</code> for http/private endpoints; run <code>glassmkr-crucible init --help</code> for the full surface).</p>
      <p>The agent stores the URL in <code>/etc/glassmkr/crucible.yaml</code>, so the flags are only needed at init time. Snapshots arrive roughly every five minutes; the first one appears on the dashboard within one cycle.</p>
    </section>

    <section id="ai">
      <h2><a href="#ai" class="anchor-link">#</a>AI analysis (optional)</h2>
      <p>Set <code>LLM_API_URL</code> in <code>.env</code> to any OpenAI-compatible endpoint and <code>LLM_MODEL</code> to the model name. Local Ollama works:</p>
      <pre><code>LLM_API_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1:8b</code></pre>
      <p>Leave it empty and the analyze button reports that AI analysis is not configured; everything else is unaffected.</p>
    </section>

    <section id="upgrading">
      <h2><a href="#upgrading" class="anchor-link">#</a>Upgrading</h2>
      <pre><code>git pull
./scripts/selfhost-setup.sh
docker compose build dashboard
docker compose up -d</code></pre>
      <p>Run the setup script on every upgrade. It is idempotent and never changes a value you already have, so usually it just prints "already set" and does nothing. It matters on the upgrade where a release needs a secret your <code>.env</code> predates: without it, <code>docker compose</code> refuses to parse.</p>
      <p>New migrations apply on boot, the ClickHouse set idempotently and the Postgres set tracked. Read the <a href="/docs/changelog">changelog</a> before major version jumps.</p>
    </section>

    <section id="backups">
      <h2><a href="#backups" class="anchor-link">#</a>Backups</h2>
      <p>State lives in the two Docker volumes: <code>pgdata</code> (accounts, servers, alert state, keys) and <code>chdata</code> (telemetry history). Snapshot both. Postgres is the one you cannot afford to lose; telemetry history is rebuildable by time.</p>
    </section>

    <section id="hosted">
      <h2><a href="#hosted" class="anchor-link">#</a>Self-hosted vs hosted</h2>
      <p>Same codebase. The hosted instance at <a href="https://app.glassmkr.com">app.glassmkr.com</a> is the maintained reference deployment and live demo; self-hosted is the same thing on your hardware with every gate removed by the <code>GLASSMKR_SELF_HOSTED</code> flag. If you ever move between them, agents re-point with one <code>init</code> and the API is identical.</p>
    </section>
  </article>

<style>
  /* Temporary by design: this styling goes when DASHBOARD_REPO_PUBLIC flips. */
  .callout-pending {
    border-left: 2px solid var(--accent);
  }
  /* Scoped per component, like every other docs page: Svelte does not share
     these rules, so each page carries its own copy. This page shipped without
     a style block at all, which left it with no sidebar, no column layout, and
     visible "#" anchor markers, because .anchor-link's transparent color was
     never applied. Rules match /docs/mcp so the pages stay consistent. */
  .page-header { margin-bottom: 2rem; }
  .docs-subtitle { color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 0; line-height: 1.6; }
  h3 { font-size: 1.05rem; color: var(--text-primary); margin-top: 1.25rem; margin-bottom: 0.5rem; }
  ul { color: var(--text-secondary); line-height: 1.7; padding-left: 1.25rem; }
  .callout { background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid var(--accent); border-radius: var(--radius-md); padding: 14px 16px; margin: 16px 0; font-size: 0.9rem; line-height: 1.65; color: var(--text-secondary); }
  .callout strong { color: var(--accent); }

  @media (max-width: 860px) {
    .docs-layout { flex-direction: column; gap: 24px; padding: 40px 20px 80px; }
    .sidebar { position: static; width: auto; max-height: none; }
    .sidebar-nav { flex-direction: row; flex-wrap: wrap; gap: 4px 8px; }
  }

  /* Mobile technical-text floor: 12px minimum on a phone. */</style>
