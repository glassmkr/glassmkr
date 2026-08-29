<script lang="ts">
  type TabName = "overview" | "customers" | "servers" | "alerts" | "system";

  interface OverviewData {
    customers: number;
    servers: number;
    active_alerts: number;
    snapshots_last_hour: number;
  }

  interface Customer {
    email: string;
    plan: string | null;
    status: string;
    server_count: number;
    plan_server_limit: number | null;
    alert_count: number;
    created_at: string;
  }

  interface Server {
    name: string;
    customer_email: string;
    ip: string | null;
    last_seen_at: string | null;
    alert_count: number;
  }

  interface Alert {
    severity: string;
    server_name: string;
    customer_email: string;
    title: string;
    first_seen: string;
  }

  interface ClickHouseTable {
    table: string;
    total_rows: number;
    compressed: string;
    uncompressed: string;
    ratio: number;
  }

  interface SystemData {
    clickhouse: { tables: ClickHouseTable[] } | null;
    postgres: { connections: number } | null;
  }

  let activeTab = $state<TabName>("overview");
  let loading = $state(true);
  let error = $state<string | null>(null);

  let overviewData = $state<OverviewData | null>(null);
  let customersData = $state<Customer[]>([]);
  let serversData = $state<Server[]>([]);
  let alertsData = $state<Alert[]>([]);
  let systemData = $state<SystemData | null>(null);

  const tabs: { id: TabName; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "customers", label: "Customers" },
    { id: "servers", label: "Servers" },
    { id: "alerts", label: "Alerts" },
    { id: "system", label: "System" },
  ];

  async function fetchTab(tab: TabName) {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/admin?tab=${tab}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      if (tab === "overview") overviewData = data;
      else if (tab === "customers") customersData = data.customers;
      else if (tab === "servers") serversData = data.servers;
      else if (tab === "alerts") alertsData = data.alerts;
      else if (tab === "system") systemData = data;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function switchTab(tab: TabName) {
    activeTab = tab;
    fetchTab(tab);
  }

  function timeAgo(ts: string | null): string {
    if (!ts) return "never";
    const ms = Date.now() - new Date(ts).getTime();
    if (ms < 60000) return "just now";
    if (ms < 3600000) return Math.floor(ms / 60000) + "m ago";
    if (ms < 86400000) return Math.floor(ms / 3600000) + "h ago";
    return Math.floor(ms / 86400000) + "d ago";
  }

  function planColor(plan: string | null): string {
    if (plan === "pro") return "var(--accent)";
    if (plan === "enterprise") return "var(--green)";
    return "var(--text-tertiary)";
  }

  // Initial load
  $effect(() => {
    fetchTab("overview");
    // Refresh every 60 seconds
    const interval = setInterval(() => fetchTab(activeTab), 60000);
    return () => clearInterval(interval);
  });
</script>

<div class="tabs">
  {#each tabs as tab}
    <button
      class="tab"
      class:active={activeTab === tab.id}
      onclick={() => switchTab(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<div id="content">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else if activeTab === "overview" && overviewData}
    <div class="stat-grid">
      <div class="stat">
        <div class="label">Customers</div>
        <div class="value">{overviewData.customers}</div>
      </div>
      <div class="stat">
        <div class="label">Servers</div>
        <div class="value">{overviewData.servers}</div>
      </div>
      <div class="stat">
        <div class="label">Active Alerts</div>
        <div class="value">{overviewData.active_alerts}</div>
      </div>
      <div class="stat">
        <div class="label">Snapshots/hr</div>
        <div class="value">{overviewData.snapshots_last_hour}</div>
      </div>
    </div>
  {:else if activeTab === "customers"}
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Plan</th>
          <th>Status</th>
          <th>Servers</th>
          <th>Alerts</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {#each customersData as c}
          <tr>
            <td>{c.email}</td>
            <td style="color:{planColor(c.plan)}">{(c.plan || "free").toUpperCase()}</td>
            <td>{c.status}</td>
            <td>{c.server_count}/{c.plan_server_limit || 3}</td>
            <td>{c.alert_count}</td>
            <td>{new Date(c.created_at).toLocaleDateString()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if activeTab === "servers"}
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Customer</th>
          <th>IP</th>
          <th>Last Seen</th>
          <th>Alerts</th>
        </tr>
      </thead>
      <tbody>
        {#each serversData as s}
          <tr>
            <td>{s.name}</td>
            <td>{s.customer_email}</td>
            <td>{s.ip || "-"}</td>
            <td>{timeAgo(s.last_seen_at)}</td>
            <td>{s.alert_count}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if activeTab === "alerts"}
    {#if alertsData.length === 0}
      <div class="empty">No active alerts</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Server</th>
            <th>Customer</th>
            <th>Alert</th>
            <th>Since</th>
          </tr>
        </thead>
        <tbody>
          {#each alertsData as a}
            <tr>
              <td class="severity-{a.severity}">{a.severity}</td>
              <td>{a.server_name}</td>
              <td>{a.customer_email}</td>
              <td>{a.title}</td>
              <td>{timeAgo(a.first_seen)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if activeTab === "system" && systemData}
    <h3 class="section-title">ClickHouse Tables</h3>
    <table>
      <thead>
        <tr>
          <th>Table</th>
          <th>Rows</th>
          <th>Compressed</th>
          <th>Uncompressed</th>
          <th>Ratio</th>
        </tr>
      </thead>
      <tbody>
        {#each systemData.clickhouse?.tables || [] as t}
          <tr>
            <td>{t.table}</td>
            <td>{t.total_rows}</td>
            <td>{t.compressed}</td>
            <td>{t.uncompressed}</td>
            <td>{t.ratio}x</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h3 class="section-title">PostgreSQL</h3>
    <div class="stat-grid" style="grid-template-columns:1fr">
      <div class="stat">
        <div class="label">Active Connections</div>
        <div class="value">{systemData.postgres?.connections || 0}</div>
      </div>
    </div>
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
  }
  .tab {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
    cursor: pointer;
    border: none;
    background: none;
    font-family: inherit;
    border-radius: 6px;
    transition: all 0.2s;
  }
  .tab:hover {
    color: var(--text-secondary);
    background: var(--surface);
  }
  .tab.active {
    color: var(--accent);
    background: var(--accent-glow);
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    background: var(--surface-border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .stat {
    background: var(--bg);
    padding: 20px;
  }
  .stat .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .stat .value {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    padding: 12px 16px;
    border-bottom: 1px solid var(--surface-border);
    font-weight: 500;
  }
  td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--surface-border);
    color: var(--text-secondary);
  }
  tr:hover td {
    background: var(--surface);
  }
  .section-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 12px;
    margin-top: 24px;
  }
  .section-title:first-child {
    margin-top: 0;
  }
  :global(.severity-critical) {
    color: var(--red);
    font-weight: 600;
  }
  :global(.severity-warning) {
    color: var(--yellow);
    font-weight: 600;
  }
  .loading {
    color: var(--text-tertiary);
    padding: 40px;
    text-align: center;
  }
  .error {
    color: var(--red);
    padding: 40px;
    text-align: center;
  }
  .empty {
    color: var(--text-tertiary);
    text-align: center;
    padding: 40px;
  }
  @media (max-width: 640px) {
    .stat-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
