<script lang="ts">
  import FleetTable from "$lib/components/FleetTable.svelte";
  import { page } from "$app/stores";
  import { api } from "$lib/utils/api";

  let customer = $derived($page.data.customer);
  let servers = $state<any[]>([]);
  let alertCounts = $state<Record<string, number>>({});
  let unackedCounts = $state<Record<string, number>>({});
  let trendWarningCounts = $state<Record<string, number>>({});
  let latestCrucible = $state("");

  // Dynamic favicon based on fleet health
  function updateFavicon(counts: Record<string, number>) {
    if (typeof document === "undefined") return;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const color = total === 0 ? "#46B98A" : total >= 3 ? "#E5564B" : "#E0A93B";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${color}"/></svg>`;
    const existing = document.querySelector("link[rel='icon'][data-dynamic]") as HTMLLinkElement;
    if (existing) {
      existing.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    } else {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.dataset.dynamic = "true";
      link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      document.head.appendChild(link);
    }
  }

  $effect(() => {
    if (customer && Object.keys(unackedCounts).length > 0) {
      updateFavicon(unackedCounts);
    }
  });
  let loading = $state(true);

  $effect(() => {
    if (!customer) {
      loading = false;
      return;
    }
    loadServers();
  });

  async function loadServers() {
    loading = true;
    try {
      // Fetch servers and latest version in parallel. Restore actions
      // for suspended servers live on the Settings page now (no per-tile
      // button), so we don't need billing/status here.
      const [data, versionData] = await Promise.all([
        api<any>("/api/v1/servers"),
        api<any>("/api/v1/version").catch(() => null),
      ]);
      servers = data.servers ?? data ?? [];
      latestCrucible = versionData?.crucible?.latest ?? "";

      // Load alert and trend-warning counts for each server
      const counts: Record<string, number> = {};
      const unacked: Record<string, number> = {};
      const trends: Record<string, number> = {};
      await Promise.all(
        servers.map(async (s: any) => {
          try {
            const [alerts, tw]: [any, any] = await Promise.all([
              api(`/api/v1/servers/${s.id}/alerts?status=active`),
              api(`/api/v1/servers/${s.id}/trend-warnings?status=active`).catch(() => ({ warnings: [] })),
            ]);
            const list = alerts.alerts ?? alerts ?? [];
            counts[s.id] = list.length;
            unacked[s.id] = list.filter((a: any) => !a.acknowledged).length;
            const warnings = tw.warnings ?? [];
            trends[s.id] = warnings.filter((w: any) => w.urgency_tier === "imminent" || w.urgency_tier === "soon").length;
          } catch {
            counts[s.id] = 0;
            unacked[s.id] = 0;
            trends[s.id] = 0;
          }
        })
      );
      alertCounts = counts;
      unackedCounts = unacked;
      trendWarningCounts = trends;
    } catch {
      servers = [];
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Dashboard | Bare Metal Monitoring</title>
</svelte:head>

<div class="container">
  {#if !customer}
    <div class="landing">
      <h1 class="landing-heading">
        Bare metal monitoring dashboard
      </h1>
      <p class="landing-desc">
        Sign in to manage your servers, alerts, and notification channels.
      </p>
      <div class="landing-actions">
        <a href="/register" class="btn btn-primary">Sign up</a>
        <a href="/login" class="btn">Log in</a>
      </div>
      <a href="https://glassmkr.com/" class="learn-link">
        Learn more about Dashboard
      </a>
    </div>
  {:else}
    <div class="dash-header">
      <h1>Your Servers</h1>
      {#if !customer?.isDemo}
        <a href="/add-server" class="btn btn-primary">+ Add Server</a>
      {/if}
    </div>

    {#if loading}
      <!-- Table-shaped skeleton (spec 17.2): the loading state holds the shape
           of what arrives, not a sentence in an empty canvas. Shimmer is
           disabled under prefers-reduced-motion. -->
      <div class="fleet-skeleton" aria-label="Loading servers" role="status">
        <div class="sk-head"></div>
        {#each Array(5) as _, i (i)}
          <div class="sk-row">
            <span class="sk-cell w-host"></span>
            <span class="sk-cell w-sm"></span>
            <span class="sk-cell w-sm"></span>
            <span class="sk-cell w-md"></span>
            <span class="sk-cell w-md"></span>
          </div>
        {/each}
      </div>
    {:else if servers.length === 0}
      <div class="empty-state">
        <h2>Add your first server</h2>
        <p>Install Crucible on a Linux server and connect it to Dashboard. You will see metrics, alerts, and health data within 5 minutes.</p>
        <div class="empty-steps">
          <div class="empty-step">
            <span class="step-num">1</span>
            <div>
              <strong>Register a server</strong>
              <p class="step-desc">Get an API key for your server.</p>
            </div>
          </div>
          <div class="empty-step">
            <span class="step-num">2</span>
            <div>
              <strong>Install Crucible</strong>
              <!-- The installer requires root AND a key, and refuses anything outside
                   Ubuntu and Debian. This command had neither, so following the empty
                   state exactly produced an immediate failure. The key comes from step 1. -->
              <pre><code>curl -sf https://glassmkr.com/install.sh | sudo bash -s -- --api-key gmk_cru_live_your_key</code></pre>
              <p class="step-desc">Ubuntu and Debian. On RHEL, Rocky, Alma, Arch or Alpine use the single-file binary, which needs no Node: <a href="https://glassmkr.com/docs/getting-started" target="_blank" rel="noopener">getting started</a>.</p>
            </div>
          </div>
          <div class="empty-step">
            <span class="step-num">3</span>
            <div>
              <strong>Configure and start</strong>
              <p class="step-desc">Add your API key to the config and Crucible starts pushing data automatically.</p>
            </div>
          </div>
        </div>
        <a href="/add-server" class="btn btn-primary" style="margin-top:20px">+ Add Server</a>
      </div>
    {:else}
      <!-- Dense fleet table. The card grid this replaces was the generic dashboard
           pattern the redesign set out to avoid: four hosts filling a viewport, every
           one weighted the same, and the two things that decide where you click
           (alerts and freshness) buried inside each box. Demo nodes never ingest, so
           their seeded collector_version is frozen; the table does not show a version
           column at all, which sidesteps the badge that used to need special-casing. -->
      {#if customer?.isDemo}
        {@const captureMs = Math.max(...servers.map((s) => (s.last_seen_at ? new Date(s.last_seen_at).getTime() : 0))) + 60_000}
        <!-- The demo is a recorded capture (review P1-7): ages measured
             against the wall clock made it look abandoned. Measure against
             the capture timestamp and say so plainly. -->
        <p class="demo-capture-note">
          Sample capture from {new Date(captureMs).toISOString().slice(0, 10)}; timestamps are relative to the capture, not live.
        </p>
        <FleetTable
          servers={servers.map((s) => ({
            ...s,
            alertCount: alertCounts[s.id] ?? 0,
            unackedCount: unackedCounts[s.id] ?? 0,
            trendWarningCount: trendWarningCounts[s.id] ?? 0,
          }))}
          fleet={servers}
          nowMs={captureMs}
        />
      {:else}
        <FleetTable
          servers={servers.map((s) => ({
            ...s,
            alertCount: alertCounts[s.id] ?? 0,
            unackedCount: unackedCounts[s.id] ?? 0,
            trendWarningCount: trendWarningCounts[s.id] ?? 0,
          }))}
          fleet={servers}
        />
      {/if}
    {/if}
  {/if}
</div>

<style>
  .demo-capture-note {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-tertiary);
    margin: 0 0 10px;
  }
  /* Fleet loading skeleton */
  .fleet-skeleton {
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .sk-head {
    height: 38px;
    background: var(--g-surface-2);
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .sk-row {
    display: flex;
    gap: 24px;
    align-items: center;
    padding: 0 16px;
    height: 46px;
    border-bottom: 1px solid var(--g-border-subtle);
  }
  .sk-row:last-child { border-bottom: none; }
  .sk-cell {
    height: 12px;
    border-radius: 2px;
    background: var(--g-surface-3);
    animation: sk-pulse 1.4s ease-in-out infinite;
  }
  .w-host { width: 160px; }
  .w-sm { width: 48px; }
  .w-md { width: 96px; }
  @keyframes sk-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk-cell { animation: none; }
  }

  .landing {
    text-align: center;
    padding: 80px 0 40px;
    max-width: 520px;
    margin: 0 auto;
  }
  .landing-heading {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.2;
    background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 16px;
  }
  .landing-desc {
    font-size: 15px;
    color: var(--text-secondary);
    margin-bottom: 28px;
    line-height: 1.6;
  }
  .landing-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 24px;
  }
  .learn-link {
    font-size: 13px;
    color: var(--text-tertiary);
  }
  .learn-link:hover {
    color: var(--accent);
  }

  .dash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .dash-header h1 {
    font-size: 28px;
    font-weight: 500;
  }

  .empty-state {
    max-width: 520px;
    margin: 48px auto;
  }
  .empty-state h2 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .empty-state > p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .empty-steps {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .empty-step {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  /* The step's content column must be allowed to SHRINK.
     A flex item defaults to min-width:auto, meaning it refuses to be narrower
     than its own min-content width. The install command is one unbreakable
     88-character line inside a <pre> (white-space:pre), so that min-content is
     about 676px, and this column dragged itself 198px past the 520px
     .empty-state container. The panel is correctly centred; the overflow is
     what made it look shifted right, because the visible content then spanned
     380..1098 in a 1280 viewport, centred on 739 rather than 640.
     The global `pre { overflow-x: auto }` could not help: the thing refusing to
     shrink is this flex item, not the pre inside it. With min-width:0 the pre
     scrolls within the column instead, and the panel measures dead centre. */
  .empty-step > div {
    min-width: 0;
  }
  .empty-step .step-num {
    width: 28px;
    height: 28px;
    min-width: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(255, 107, 53,0.08);
    border: 1px solid rgba(255, 107, 53,0.15);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
  .empty-step strong {
    font-size: 14px;
    display: block;
    margin-bottom: 4px;
  }
  .empty-step pre {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 12px;
    margin-top: 6px;
  }
  .empty-step code { color: var(--accent); }
  .step-desc { font-size: 13px; color: var(--text-tertiary); margin: 0; }


</style>
