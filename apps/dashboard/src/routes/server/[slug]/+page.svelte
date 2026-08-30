<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { api } from "$lib/utils/api";
  import { timeAgo, formatUptime } from "$lib/utils/time";
  import { normalizeVendor } from "$lib/utils/vendor";
  import { resolveServerBySlug } from "$lib/utils/server-slug";
  import { getToasts } from "$lib/stores/toast.svelte";
  import { ConfirmModal, CopyButton } from "@glassmkr/ui";
  import AlertRow from "$lib/components/AlertRow.svelte";
  import { formatTimestamp, formatDuration } from "$lib/alerts/presentation";
  import AnalysisPanel from "$lib/components/AnalysisPanel.svelte";
  import TrendWarningCard from "$lib/components/TrendWarningCard.svelte";
  import HostVitalsPanel from "$lib/components/server/HostVitalsPanel.svelte";
  import NetworkPanel from "$lib/components/server/NetworkPanel.svelte";
  import IpmiPanel from "$lib/components/server/IpmiPanel.svelte";
  import StoragePanel from "$lib/components/server/StoragePanel.svelte";
  import SmartPanel from "$lib/components/server/SmartPanel.svelte";
  import MetricHistoryModal from "$lib/components/server/MetricHistoryModal.svelte";

  const toast = getToasts();

  // Open metric-history modal (CPU / Memory / per-core), driven by the
  // "View history" buttons on the live panels. null = closed.
  type HistoryMetric =
    | { kind: "cpu" }
    | { kind: "cpu_temp" }
    | { kind: "memory" }
    | { kind: "core"; index: number; label: string }
    | { kind: "gpu"; index: number; metric: "temp" | "power" | "vram" | "util"; label: string };
  let historyMetric = $state<HistoryMetric | null>(null);

  let slug = $derived($page.params.slug);
  let customer = $derived($page.data.customer);

  let server = $state<any>(null);
  let health = $state<any>(null);
  let alerts = $state<any[]>([]);
  let trendWarnings = $state<any[]>([]);
  let loading = $state(true);
  let serverId = $state("");
  // True when two or more servers share this URL's hostname slug (a rebuilt box
  // whose old record still exists). Shown as a banner because the duplicate is
  // otherwise invisible from here, and one of the two records has no URL at all.
  let slugAmbiguous = $state(false);

  let alertTab = $state<"active" | "acknowledged" | "resolved" | "muted">("active");
  let mutedRules = $state<string[]>([]);
  let hostProfiles = $state<Array<{ id: string; label: string; description: string; suppressed_rules: string[] }>>([]);
  let savingProfile = $state(false);
  let resolvedAlerts = $state<any[]>([]);
  // Count loaded eagerly so the tab label reads "Resolved (7)" without
  // forcing the user to click into the tab first. The full row list
  // still lazy-loads via loadResolved() to keep the initial page cheap.
  let resolvedCount = $state<number | null>(null);
  let loadingHistory = $state(false);

  let filteredAlerts = $derived(
    alertTab === "resolved" ? resolvedAlerts :
    alertTab === "acknowledged" ? alerts.filter(a => a.acknowledged) :
    alerts.filter(a => !a.acknowledged)
  );
  let deleteOpen = $state(false);
  let showUpdateModal = $state(false);
  let latestCrucible = $state("");

  function isOlderVersion(current: string, latest: string): boolean {
    const c = current.replace(/^v/, "").split(".").map(Number);
    const l = latest.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((c[i] || 0) < (l[i] || 0)) return true;
      if ((c[i] || 0) > (l[i] || 0)) return false;
    }
    return false;
  }

  // Demo nodes never ingest, so their seeded collector_version is frozen and
  // would always read "outdated" after a Crucible release. For the demo tenant
  // we display the live latest version (so the fleet looks current and the view
  // auto-adjusts on every release) and never surface the update button.
  let reportedVersion = $derived(health?.collector_version || server?.collector_version || "N/A");
  let displayVersion = $derived(
    customer?.isDemo ? (latestCrucible || reportedVersion) : reportedVersion,
  );
  let updateAvailable = $derived(
    !customer?.isDemo &&
    latestCrucible &&
    reportedVersion !== "N/A" &&
    isOlderVersion(reportedVersion, latestCrucible),
  );

  function parseJsonField(val: any): any {
    if (!val) return null;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  }

  async function resolveServerId() {
    try {
      const data: any = await api("/api/v1/servers");
      const servers = data.servers ?? data ?? [];
      // Accepts a raw id as well as a hostname slug, and on a duplicate hostname
      // picks the most recently seen record instead of whichever the array
      // happened to list first. Without that, /server/<hostname> for a rebuilt
      // box could show a long-dead twin's data for a machine that is fine.
      const { server: match, ambiguous } = resolveServerBySlug(slug ?? "", servers);
      if (!match) {
        toast.show("Server not found", "error");
        goto("/");
        return;
      }
      if (ambiguous) {
        // Surfaced, not silently resolved: the duplicate record is the thing the
        // operator has to clean up, and it is otherwise invisible from this page.
        slugAmbiguous = true;
      }
      serverId = match.id;
    } catch {
      toast.show("Failed to load servers", "error");
      goto("/");
    }
  }

  async function loadServerData() {
    if (!serverId) return;
    loading = true;
    try {
      const [sData, hData] = await Promise.all([
        api<any>(`/api/v1/servers/${serverId}`),
        api<any>(`/api/v1/servers/${serverId}/health`).catch(() => null),
      ]);
      server = sData.server ?? sData;
      health = hData?.snapshot ?? hData?.health ?? hData;

      // Host-profile catalog: static product metadata, fetch once.
      if (hostProfiles.length === 0) {
        try {
          hostProfiles = (await api<any>("/api/v1/host-profiles")).profiles ?? [];
        } catch { /* non-fatal; the selector just shows no profile options */ }
      }

      // Load alerts, muted rules, and resolved count (light-weight) in parallel
      try {
        const [aData, mData, rcData] = await Promise.all([
          api<any>(`/api/v1/servers/${serverId}/alerts?status=active`),
          api<any>(`/api/v1/servers/${serverId}/mutes`).catch(() => ({ muted_rules: [] })),
          api<any>(`/api/v1/servers/${serverId}/alerts?status=resolved&count_only=true`).catch(() => null),
        ]);
        alerts = aData.alerts ?? aData ?? [];
        mutedRules = mData.muted_rules ?? [];
        resolvedCount = rcData && typeof rcData.count === "number" ? rcData.count : null;
      } catch {
        alerts = [];
      }

      try {
        const twData: any = await api(`/api/v1/servers/${serverId}/trend-warnings?status=active`);
        trendWarnings = twData.warnings ?? [];
      } catch {
        trendWarnings = [];
      }
    } catch (err: any) {
      toast.show(err.message || "Failed to load server", "error");
    } finally {
      loading = false;
    }
  }

  async function setProfile(profile: string | null) {
    if (savingProfile) return;
    savingProfile = true;
    try {
      await api(`/api/v1/servers/${serverId}`, { method: "PATCH", body: JSON.stringify({ profile }) });
      toast.show(profile ? "Host profile applied" : "Host profile cleared", "success");
      await loadServerData();
    } catch (err: any) {
      toast.show(err.message || "Failed to update host profile", "error");
    } finally {
      savingProfile = false;
    }
  }

  // Tooltip text for the header profile control (hover on the info marker).
  function profileTooltip(profile: string | null | undefined): string {
    const base =
      "A host-type profile silences alerts that are expected by design for this kind of host; real problems still fire.";
    if (!profile) return `${base} General means no suppression (the default).`;
    const p = hostProfiles.find((x) => x.id === profile);
    if (!p) return base;
    return `${p.label}: ${p.description} Suppressed: ${p.suppressed_rules.join(", ")}.`;
  }

  async function loadResolved() {
    alertTab = "resolved";
    if (resolvedAlerts.length > 0 || !serverId) return; // already loaded or no server
    loadingHistory = true;
    try {
      const data = await api<any>(`/api/v1/servers/${serverId}/alerts?status=resolved&limit=50`);
      resolvedAlerts = data.alerts ?? [];
    } catch {
      resolvedAlerts = [];
    } finally {
      loadingHistory = false;
    }
  }

  $effect(() => {
    if (slug) resolveServerId();
  });

  $effect(() => {
    if (serverId) loadServerData();
  });

  $effect(() => {
    api<any>("/api/v1/version").then(v => { latestCrucible = v?.crucible?.latest ?? ""; }).catch(() => {});
  });

  // Disk health rollup (CC_DISK_HEALTH_ROLLUP.md). Keyed by device path.
  // Phase 1 is silent (no notifications); this just renders a per-drive
  // badge in the SMART section when state is not healthy.
  let diskHealth = $state<Record<string, { state: string; signals: string[] }>>({});
  $effect(() => {
    if (!serverId) return;
    api<{ drives: Array<{ device_id: string; state: string; signals: string[] }> }>(
      `/api/v1/servers/${serverId}/disk-health`,
    ).then((r) => {
      const map: Record<string, { state: string; signals: string[] }> = {};
      for (const d of r.drives ?? []) {
        map[d.device_id] = { state: d.state, signals: d.signals ?? [] };
      }
      diskHealth = map;
    }).catch(() => { diskHealth = {}; });
  });

  // Derived parsed fields from health snapshot
  let disks = $derived(parseJsonField(health?.disks) ?? []);
  let smart = $derived(parseJsonField(health?.smart) ?? []);
  let network = $derived(parseJsonField(health?.network) ?? []);
  let ipmi = $derived(parseJsonField(health?.ipmi));
  // Hwmon CPU thermal block (Crucible 0.8.0+; ClickHouse column added in
  // migration 003). Host-vitals reads thermal.max_cpu_celsius for the
  // current CPU temperature tile + its history clickthrough.
  let thermal = $derived(parseJsonField(health?.thermal));

  // Hardware identification (Phase 3 A.5 + A.6).
  // dmi_vendor + dmi_product live on the servers row (migration
  // 012); the live snapshot blob exposes them via snap.dmi too,
  // but the PG row is sufficient and matches what the dashboard
  // tile uses. ipmi_sensors_count lives on the servers row; the
  // detail page also has the full IPMI block from /health, so we
  // prefer the live count when available and fall back to the
  // PG snapshot otherwise.
  let hwVendorDisplay = $derived(normalizeVendor(server?.dmi_vendor));
  let hwProductDisplay = $derived((server?.dmi_product ?? "").trim());
  let hwLine = $derived(
    hwVendorDisplay && hwProductDisplay
      ? `${hwVendorDisplay} ${hwProductDisplay}`
      : (hwVendorDisplay || hwProductDisplay || "")
  );
  let liveSensorCount = $derived(
    Array.isArray(ipmi?.sensors) ? ipmi.sensors.length : null
  );
  let ipmiCountDisplay = $derived(
    liveSensorCount ?? server?.ipmi_sensors_count ?? 0
  );
  let ipmiDetected = $derived(
    Boolean(ipmi?.available) || ipmiCountDisplay > 0
  );
  // When Crucible 0.9.4+ couldn't probe IPMI, ipmi.detection.reason
  // carries the machine-readable reason ({no_ipmitool_binary,
  // permission_denied, no_bmc_device, execution_failed}). Map to a
  // short user-facing string for the "IPMI: Not detected" header.
  // Cross-vendor IPMI audit B.1c.
  // Short, paren-free reason labels for the "IPMI: Not detected" header.
  // The previous strings had inner parens, which produced nested parens
  // in the rendered output ("Not detected (ipmitool not installed
  // (install ipmitool...))"); the actionable fix lives in the doctor
  // subcommand and /docs/troubleshooting/ipmi where there's room for it.
  // Verification fixes Task C.1.
  const IPMI_REASON_LABELS: Record<string, string> = {
    no_ipmitool_binary: "ipmitool not installed",
    permission_denied: "agent cannot access /dev/ipmi0",
    no_bmc_device: "no BMC device found",
    execution_failed: "ipmitool error",
  };
  let ipmiNotDetectedReason = $derived(
    !ipmiDetected && ipmi?.detection?.reason
      ? IPMI_REASON_LABELS[ipmi.detection.reason as string] ?? `${ipmi.detection.reason}`
      : null
  );
  let cpuCores = $derived(parseJsonField(health?.cpu_cores) ?? []);

  // GPU snapshot block (Crucible v0.13.0+). The panel renders only
  // when tier1 is available, so non-NVIDIA hosts see no GPU surface.
  let gpu = $derived(parseJsonField(health?.gpu));
  let gpuAvailable = $derived(
    Boolean(gpu?.tier1 && "available" in gpu.tier1 && gpu.tier1.available)
  );

  // Section nav
  let isPinned = $state(false);
  let activeSection = $state("alerts");
  let headerEl = $state<HTMLElement | undefined>();
  // The section nav has always scrolled horizontally, but with the scrollbar
  // suppressed there was nothing to say so: on a phone it simply cut "Storage"
  // in half and looked like a rendering fault. `navMore` drives a fade on the
  // edge that still has items behind it.
  let navEl = $state<HTMLElement | undefined>();
  let navMore = $state(false);

  let sections = $derived(
    [
      alerts.length > 0 || (resolvedCount ?? 0) > 0
        ? { id: "alerts", label: "Alerts", count: alerts.filter(a => !a.acknowledged).length }
        : null,
      trendWarnings.length > 0
        ? { id: "trend-warnings", label: "Trend Warnings", count: trendWarnings.length }
        : customer?.plan === "free" ? { id: "trend-warnings", label: "Trend Warnings" } : null,
      health && gpuAvailable ? { id: "gpu", label: "GPU" } : null,
      health ? { id: "cpu", label: "CPU" } : null,
      health ? { id: "memory", label: "Memory" } : null,
      disks.length > 0 || smart.length > 0 ? { id: "storage", label: "Storage" } : null,
      network.length > 0 ? { id: "network", label: "Network" } : null,
      ipmi?.available ? { id: "ipmi", label: "IPMI" } : null,
      { id: "analysis", label: "AI Analysis" },
    ].filter(Boolean) as Array<{ id: string; label: string; count?: number }>
  );

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    // Offset by the actual pinned-nav height (was a stale hard-coded 112px
    // left over from an old top-bar, which over-scrolled and left a gap
    // above the target). +12px breathing room below the bar.
    const nav = document.querySelector(".section-nav") as HTMLElement | null;
    const navH = nav?.offsetHeight ?? 48;
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 12;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // Track whether the section nav has content past its right edge.
  $effect(() => {
    const el = navEl;
    // Read `sections` so the check re-runs when items appear or disappear.
    void sections.length;
    if (!el || typeof window === "undefined") return;
    const update = () => {
      navMore = el.scrollWidth - el.clientWidth - el.scrollLeft > 4;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  });

  // Pin section nav when header scrolls out
  $effect(() => {
    if (!headerEl || typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => { isPinned = !entry.isIntersecting; },
      { threshold: 0, rootMargin: "-57px 0px 0px 0px" }
    );
    observer.observe(headerEl);
    return () => observer.disconnect();
  });

  // Scrollspy
  $effect(() => {
    if (typeof window === "undefined" || sections.length === 0) return;
    const els = sections.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost visible section
        for (const entry of entries) {
          if (entry.isIntersecting) activeSection = entry.target.id;
        }
      },
      { threshold: 0, rootMargin: "-120px 0px -75% 0px" }
    );
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  });
  let security = $derived(parseJsonField(health?.security));

  async function deleteServer() {
    try {
      await api(`/api/v1/servers/${serverId}?confirm=true`, { method: "DELETE" });
      toast.show("Server deleted", "success");
      goto("/");
    } catch (err: any) {
      toast.show(err.message || "Failed to delete", "error");
    }
    deleteOpen = false;
  }
</script>

<svelte:head>
  <title>{server?.hostname ?? "Server"} | Dashboard</title>
</svelte:head>

<div class="container">
  <a href="/" class="back-link">&larr; Back to servers</a>

  {#if loading && !server}
    <p class="muted mt-3">Loading server details...</p>
  {:else if server}
    {@const isSuspendedNoCard = server.status === "suspended" && server.suspended_reason === "no_card_on_file"}
    {#if isSuspendedNoCard}
      <div class="suspended-banner">
        <strong>This server is disabled because no payment method is on file.</strong>
        <a href="/settings#disabled-servers" class="btn btn-small btn-primary">Manage in Settings</a>
      </div>
    {/if}
    {#if slugAmbiguous}
      <div class="ambiguous-banner">
        <strong>More than one server record shares this hostname.</strong>
        <span>
          You are seeing the most recently active one. This usually means the machine
          was rebuilt or re-enrolled and the old record was left behind, which also
          inflates your server count. Open the duplicate from the server list to
          review or remove it.
        </span>
      </div>
    {/if}
    <div class="server-header" bind:this={headerEl}>
      <h1>{server.hostname || server.name}</h1>
      <div class="header-actions">
        {#if !customer?.isDemo && hostProfiles.length > 0}
          <div class="profile-inline">
            <span class="profile-inline-label">Profile</span>
            <select
              class="profile-inline-select"
              value={server?.profile ?? ""}
              disabled={savingProfile}
              onchange={(e) => setProfile((e.currentTarget as HTMLSelectElement).value || null)}
              aria-busy={savingProfile}
            >
              <option value="">General</option>
              {#each hostProfiles as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <span class="profile-info">
              <button type="button" class="profile-info-icon" aria-label="What is a host profile?">&#9432;</button>
              <span class="profile-info-pop" role="tooltip">{profileTooltip(server?.profile)}</span>
            </span>
          </div>
        {/if}
        {#if !customer?.isDemo}
          <button
            class="btn btn-danger btn-small"
            disabled={isSuspendedNoCard}
            title={isSuspendedNoCard ? "This server is disabled. Restore it first." : ""}
            onclick={() => (deleteOpen = true)}
          >
            Delete Server
          </button>
        {/if}
      </div>
    </div>

    {#if !customer?.isDemo && server?.suggested_profile && !server?.profile}
      <div class="profile-nudge">
        <span class="profile-nudge-text">
          This looks like a marketplace GPU host. Apply the <strong>Marketplace GPU host</strong> profile to silence the power-cap, firewall, and unattended-upgrade alerts that are expected by design on rented boxes. Real faults still fire.
        </span>
        <button
          class="btn btn-small profile-nudge-apply"
          onclick={() => setProfile("marketplace_gpu")}
          disabled={savingProfile}
          aria-busy={savingProfile}
        >Apply profile</button>
      </div>
    {/if}

    <!-- Info Grid -->
    <div class="info-grid">
      <div class="info-item">
        <span class="label">Hostname</span>
        <span>{server.hostname || "N/A"}</span>
      </div>
      <div class="info-item">
        <span class="label">OS</span>
        <span>{health?.os || `${server.os_type} ${server.os_version}`}</span>
      </div>
      <div class="info-item">
        <span class="label">IP</span>
        <span>{health?.ip || server.ip}</span>
      </div>
      <div class="info-item">
        <span class="label">Uptime</span>
        <span>{health?.uptime_seconds ? formatUptime(health.uptime_seconds) : "N/A"}</span>
      </div>
      <div class="info-item info-item-wide">
        <span class="label">Crucible (collector daemon)</span>
        <span>
          {displayVersion}
          {#if updateAvailable}
            <button class="btn btn-primary btn-small update-badge" onclick={() => showUpdateModal = true}>
              Update to {latestCrucible}
            </button>
          {/if}
        </span>
      </div>
      <div class="info-item">
        <span class="label">Last Seen</span>
        <span>{server.last_seen_at ? timeAgo(server.last_seen_at) : "Never"}</span>
      </div>
      {#if hwLine}
        <div class="info-item info-item-wide">
          <span class="label">Hardware</span>
          <span>{hwLine}</span>
        </div>
      {/if}
      <div class="info-item info-item-wide">
        <span class="label">IPMI</span>
        <span>
          {#if ipmiDetected}
            Detected ({ipmiCountDisplay} sensor{ipmiCountDisplay === 1 ? "" : "s"})
          {:else}
            Not detected{#if ipmiNotDetectedReason}{" "}<span class="ipmi-reason">({ipmiNotDetectedReason})</span> <a class="ipmi-help" href="https://glassmkr.com/docs/troubleshooting/ipmi" target="_blank" rel="noopener">How to fix ↗</a>{/if}
          {/if}
        </span>
      </div>
    </div>

    {#if !health && !loading}
      <div class="waiting-state">
        <div class="waiting-pulse"></div>
        <h2>Waiting for first snapshot</h2>
        <p>Crucible sends data every 5 minutes. If you just installed it, the first snapshot should arrive shortly.</p>
        <p class="waiting-sub">Server registered {server.created_at ? timeAgo(server.created_at) : "recently"}.</p>
        <details class="waiting-help">
          <summary>Not seeing data?</summary>
          <ul>
            <li>Verify Crucible is running: <code>systemctl status glassmkr-crucible</code></li>
            <li>Check the logs: <code>journalctl -u glassmkr-crucible -f</code></li>
            <li>Confirm the API key in <code>/etc/glassmkr/crucible.yaml</code> (legacy installs: <code>/etc/glassmkr/collector.yaml</code>; the agent reads either)</li>
            <li>Make sure the server can reach <code>app.glassmkr.com</code> on port 443</li>
          </ul>
        </details>
      </div>
    {/if}

    <!-- Section Nav -->
    {#if !loading && health}
      <div class="section-nav" class:pinned={isPinned} class:has-more={navMore} bind:this={navEl}>
        {#each sections as section}
          <a
            href="#{section.id}"
            class="section-nav-item"
            class:active={activeSection === section.id}
            onclick={(e) => { e.preventDefault(); scrollToSection(section.id); }}
          >
            {section.label}
            {#if section.count !== undefined}
              <span class="section-nav-count">({section.count})</span>
            {/if}
          </a>
        {/each}
      </div>
    {/if}

    <!-- Alerts (active / acknowledged / resolved). Stays visible whenever
         the server has any alert history, so users who just cleared the
         last active alert still see the tab they expect. -->
    {#if alerts.length > 0 || (resolvedCount ?? 0) > 0 || mutedRules.length > 0}
      <section class="section">
        <div class="alerts-header" id="alerts">
          <h2 class="section-title">Alerts</h2>
          <div class="alert-tabs">
            <button class="alert-tab" class:active={alertTab === "active"} onclick={() => alertTab = "active"}>
              Active ({alerts.filter(a => !a.acknowledged).length})
            </button>
            <button class="alert-tab" class:active={alertTab === "acknowledged"} onclick={() => alertTab = "acknowledged"}>
              Acknowledged ({alerts.filter(a => a.acknowledged).length})
            </button>
            <button class="alert-tab" class:active={alertTab === "resolved"} onclick={loadResolved}>
              Resolved {resolvedAlerts.length > 0
                ? `(${resolvedAlerts.length})`
                : resolvedCount !== null && resolvedCount > 0
                  ? `(${resolvedCount})`
                  : ""}
            </button>
            {#if mutedRules.length > 0}
              <button class="alert-tab" class:active={alertTab === "muted"} onclick={() => alertTab = "muted"}>
                Muted ({mutedRules.length})
              </button>
            {/if}
          </div>
        </div>
        {#if alertTab === "muted"}
          <p class="muted-info">These rules will not fire or send notifications for this server. Rules silenced by a host profile are managed via the Profile control above, not here.</p>
          <div class="muted-list">
            {#each mutedRules as rule}
              <div class="muted-item">
                <span class="muted-rule-name">{rule}</span>
                <button class="btn btn-small" onclick={async () => {
                  try {
                    await api(`/api/v1/servers/${serverId}/mutes`, { method: "DELETE", body: JSON.stringify({ alert_type: rule }) });
                    toast.show(`Rule "${rule}" unmuted`, "success");
                    loadServerData();
                  } catch (err) { toast.show("Failed to unmute", "error"); }
                }}>Unmute</button>
              </div>
            {/each}
          </div>
        {:else if loadingHistory && alertTab === "resolved"}
          <p class="muted-text">Loading history...</p>
        {:else if filteredAlerts.length > 0}
          {#each filteredAlerts as alert (alert.id)}
            {#if alertTab === "resolved"}
              <div class="resolved-row">
                <div class="resolved-header">
                  <span class="resolved-type">{alert.alert_type}</span>
                  <span class="resolved-severity tag-{alert.severity}">{alert.severity}</span>
                </div>
                <div class="resolved-title">{alert.title}</div>
                <div class="resolved-times">
                  <span>Fired {formatTimestamp(alert.first_seen)}</span>
                  <span>Resolved {formatTimestamp(alert.resolved_at)}</span>
                  <span class="resolved-duration">Duration: {formatDuration(new Date(alert.resolved_at).getTime() - new Date(alert.first_seen).getTime())}</span>
                </div>
              </div>
            {:else}
              <AlertRow {alert} {serverId} onack={loadServerData} onmute={loadServerData} />
            {/if}
          {/each}
        {:else}
          <p class="muted-text">{alertTab === "resolved" ? "No resolved alerts in the last 90 days." : `No ${alertTab} alerts.`}</p>
        {/if}
      </section>
    {/if}

    <!-- Trend Warnings -->
    {#if trendWarnings.length > 0}
      <section class="section">
        <div class="alerts-header" id="trend-warnings">
          <h2 class="section-title">Trend Warnings ({trendWarnings.length})</h2>
        </div>
        {#each trendWarnings as warning (warning.id)}
          <TrendWarningCard {warning} onfeedback={loadServerData} oncancel={loadServerData} isDemo={customer?.isDemo === true} />
        {/each}
      </section>
    {/if}
    <!-- The Pro upsell block that used to sit here is retired with the plan
         split (P0-03 resolution, 2026-08-29): every account gets the full
         trend pipeline, so a host with no warnings simply shows none. -->

    <!-- CPU + Memory (live, from latest snapshot) -->
    {#if health}
      <section class="section" id="vitals">
        <HostVitalsPanel
          user={health.cpu_user_percent ?? 0}
          system={health.cpu_system_percent ?? 0}
          iowait={health.cpu_iowait_percent ?? 0}
          idle={health.cpu_idle_percent ?? 100}
          cores={cpuCores}
          cpuTempC={thermal?.max_cpu_celsius ?? null}
          cpuTempSource={thermal?.source ?? null}
          usedMb={health.ram_used_mb ?? 0}
          totalMb={health.ram_total_mb ?? 0}
          availableMb={health.ram_available_mb ?? 0}
          freeMb={health.ram_free_mb ?? 0}
          swapUsedMb={health.swap_used_mb ?? 0}
          swapTotalMb={health.swap_total_mb ?? 0}
          load1={health.load_1m ?? 0}
          load5={health.load_5m ?? 0}
          load15={health.load_15m ?? 0}
          ipmiSensors={Array.isArray(ipmi?.sensors) ? ipmi.sensors : []}
          {gpuAvailable}
          {gpu}
          ecc={ipmi?.ecc_errors ?? null}
          memoryTopology={typeof health.memory_topology === "object" ? health.memory_topology : null}
          onViewHistory={(m) => (historyMetric = m)}
        />
      </section>

      <!-- Storage: capacity/mounts + SMART disk health together (SMART is
           disk health, so it lives under Storage rather than its own section). -->
      {#if disks.length > 0 || smart.length > 0}
        <section class="section">
          <h2 class="section-title" id="storage">Storage</h2>
          {#if disks.length > 0}
            <StoragePanel {disks} />
          {/if}
          {#if smart.length > 0}
            <div class="storage-sub">SMART disk health</div>
            <SmartPanel {smart} {diskHealth} />
          {/if}
        </section>
      {/if}

      <!-- Network -->
      {#if network.length > 0}
        <section class="section">
          <h2 class="section-title" id="network">Network</h2>
          <NetworkPanel interfaces={network} firewallActive={security?.firewall === true} />
        </section>
      {/if}

      <!-- IPMI sensors (folds to one "IPMI sensors (N)" row; thermals live in
           Host vitals, ECC moved to Memory). -->
      {#if ipmi}
        <section class="section" id="ipmi">
          <IpmiPanel {ipmi} hideThermal {gpuAvailable} />
        </section>
      {/if}

      <!-- Security Posture -->
      {#if security}
        <section class="section">
          <h2 class="section-title" id="security">Security Posture</h2>
          <div class="security-grid">
            {#if security.ssh_root_login != null}
              <div class="sec-item">
                <span class="label">SSH Root Login</span>
                <span class="tag tag-{security.ssh_root_login ? 'red' : 'green'}">
                  {security.ssh_root_login ? "Enabled" : "Disabled"}
                </span>
              </div>
            {/if}
            {#if security.firewall != null}
              <div class="sec-item">
                <span class="label">Firewall</span>
                <span class="tag tag-{security.firewall ? 'green' : 'yellow'}">
                  {security.firewall ? "Active" : "Inactive"}
                </span>
              </div>
            {/if}
            {#if security.updates_available != null}
              <div class="sec-item">
                <span class="label">Updates Available</span>
                <span class="tag tag-{security.updates_available > 0 ? 'yellow' : 'green'}">
                  {security.updates_available}
                </span>
              </div>
            {/if}
            {#if security.kernel_vulns != null && Array.isArray(security.kernel_vulns)}
              {@const vulns = security.kernel_vulns}
              {@const unmitigated = vulns.filter((v: any) => !v.mitigated)}
              {@const mitigated = vulns.filter((v: any) => v.mitigated)}
              <div class="sec-item sec-item-vulns">
                <span class="label">Kernel Vulnerabilities</span>
                <span class="tag tag-{unmitigated.length > 0 ? 'red' : 'green'}">
                  {#if unmitigated.length > 0}
                    {unmitigated.length} vulnerable, {mitigated.length} mitigated
                  {:else}
                    {mitigated.length} mitigated
                  {/if}
                </span>
                {#if vulns.length > 0}
                  <details class="vuln-details">
                    <summary class="vuln-toggle">Show all {vulns.length}</summary>
                    <ul class="vuln-list">
                      {#each vulns as v}
                        <li class="vuln-entry" title={v.status}>
                          <span class="vuln-dot" style="background:{v.mitigated ? 'var(--green)' : 'var(--red)'}"></span>
                          <span class="vuln-name">{v.name}</span>
                          <span class="vuln-status">{v.status.length > 60 ? v.status.slice(0, 57) + '...' : v.status}</span>
                        </li>
                      {/each}
                    </ul>
                  </details>
                {/if}
              </div>
            {/if}
            {#if security.auto_updates != null}
              <div class="sec-item">
                <span class="label">Auto-updates</span>
                <span class="tag tag-{security.auto_updates ? 'green' : 'yellow'}">
                  {security.auto_updates ? "Enabled" : "Disabled"}
                </span>
              </div>
            {/if}
          </div>
        </section>
      {/if}
    {/if}

    <!-- AI Analysis -->
    {#if serverId}
      <section class="section" id="analysis">
        <AnalysisPanel
          {serverId}
          plan={customer?.plan ?? "free"}
          freeAnalysisUsed={server?.free_analysis_used ?? false}
          isDemo={customer?.isDemo === true}
        />
      </section>
    {/if}
  {/if}
</div>

<ConfirmModal
  bind:open={deleteOpen}
  title="Delete Server"
  message="Are you sure you want to delete this server? This cannot be undone."
  confirmText="Delete"
  danger
  onconfirm={deleteServer}
  oncancel={() => (deleteOpen = false)}
/>

{#if historyMetric && serverId}
  <MetricHistoryModal {serverId} metric={historyMetric} onClose={() => (historyMetric = null)} />
{/if}

{#if showUpdateModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" role="presentation" onclick={() => showUpdateModal = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="update-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="update-modal-header">
        <div>
          <h3>Update Crucible to {latestCrucible}</h3>
          <p class="update-modal-sub">Run these commands on <strong>{server?.hostname || server?.name}</strong> (make sure you are connected to the server via SSH first).</p>
        </div>
        <button class="update-close" onclick={() => showUpdateModal = false}>&times;</button>
      </div>

      <div class="update-steps">
        <div class="update-step">
          <span class="update-step-num">1</span>
          <div class="update-step-content">
            <span class="update-step-label">Update package</span>
            <div class="update-code-wrap">
              <pre><code>sudo npm install -g @glassmkr/crucible@latest</code></pre>
            </div>
          </div>
        </div>
        <div class="update-step">
          <span class="update-step-num">2</span>
          <div class="update-step-content">
            <span class="update-step-label">Restart service</span>
            <div class="update-code-wrap">
              <pre><code>sudo systemctl restart glassmkr-crucible</code></pre>
            </div>
          </div>
        </div>
      </div>

      <div class="update-copy-all">
        <CopyButton text={"sudo npm install -g @glassmkr/crucible@latest && sudo systemctl restart glassmkr-crucible"} label="Copy all as one-liner" />
      </div>

      <div class="update-footer">
        <div class="update-footer-info">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;margin-top:1px"><circle cx="8" cy="8" r="7" stroke="var(--text-tertiary)" stroke-width="1.5"/><path d="M8 5v3" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11" r="0.75" fill="var(--text-tertiary)"/></svg>
          <span>Version updates within 5&nbsp;minutes.</span>
        </div>
        <a href="https://github.com/glassmkr/crucible/releases/tag/v{latestCrucible}" target="_blank" rel="noopener" class="update-release-btn">
          Release notes &rarr;
        </a>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Offset anchors for sticky nav + section nav */
  :global([id="alerts"]),
  :global([id="cpu"]),
  :global([id="memory"]),
  :global([id="storage"]),
  :global([id="smart"]),
  :global([id="network"]),
  :global([id="ipmi"]),
  :global([id="gpu"]),
  :global([id="security"]),
  :global([id="analysis"]) {
    /* Matches the pinned section-nav height (~44px) + a little room. Was
       112px (stale old-top-bar value) which left a visible gap. */
    scroll-margin-top: 64px;
  }

  /* Waiting State */
  .waiting-state {
    max-width: 480px;
    margin: 60px auto;
    text-align: center;
  }
  .waiting-state h2 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .waiting-state > p {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 4px;
  }
  .waiting-sub {
    font-size: 13px;
    color: var(--text-tertiary);
  }
  .waiting-pulse {
    width: 12px;
    height: 12px;
    background: var(--accent);
    border-radius: 50%;
    margin: 0 auto 20px;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.3); }
  }
  .waiting-help {
    margin-top: 24px;
    text-align: left;
  }
  .waiting-help summary {
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
  }
  .waiting-help ul {
    margin-top: 8px;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.8;
  }
  .waiting-help code {
    background: var(--surface);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  /* Bottom room so the LAST section (AI Analysis) can scroll up under the
     pinned nav when clicked. Without it the page bottoms out with the last
     section still mid-viewport (the "leaves space" report), since there is
     nothing below it to scroll past. */
  .container {
    padding-bottom: 45vh;
  }

  /* Section Nav */
  .section-nav {
    display: flex;
    gap: 2px;
    padding: 8px 0;
    margin: 16px 0 8px;
    border-bottom: 1px solid var(--surface-border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .section-nav::-webkit-scrollbar { display: none; }
  /* Fade the trailing edge only while there is something behind it, so the
     affordance disappears once you have reached the end rather than sitting
     there permanently as decoration. */
  .section-nav.has-more {
    mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent 100%);
  }
  .section-nav.pinned {
    position: sticky;
    /* Desktop (sidebar layout): no top bar above main content, so
       the section nav sticks to the very top of the viewport. The
       PR #103 sidebar redesign removed the ~49px horizontal top-bar
       this previously anchored to. */
    top: 0;
    z-index: 90;
    background: rgba(8, 9, 12, 0.92);
    backdrop-filter: blur(8px);
    margin: 0 -24px;
    padding: 8px 24px;
    /* Pinned bar floats over scrolling content: keep a defined bottom
       edge (the near-invisible shadow alone read as an undifferentiated
       black bar) plus a shadow for depth. The bar's ~92%-opaque bg
       occludes content behind it, so the border delineates the bar
       rather than cutting through what scrolls under. */
    border-bottom: 1px solid var(--surface-border);
    box-shadow: 0 8px 20px -12px rgba(0, 0, 0, 0.7);
  }
  @media (max-width: 900px) {
    .section-nav.pinned {
      /* Mobile: sidebar collapses; a 48px hamburger top-bar appears
         (.mobile-topbar in routes/+layout.svelte). Stick below it. */
      top: 48px;
    }
  }
  .section-nav-item {
    color: var(--text-tertiary);
    text-decoration: none;
    font-size: 12px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 4px;
    white-space: nowrap;
    outline: none;
    transition: color 0.15s, background 0.15s;
  }
  .section-nav-item:hover {
    color: var(--text-secondary);
    background: var(--surface);
    text-decoration: none;
  }
  .section-nav-item.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Keyboard focus only: the default browser focus ring rendered as a
     harsh blue box over the just-clicked item. Mouse clicks get no ring;
     keyboard users get a subtle accent outline. */
  .section-nav-item:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .section-nav-count {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  /* An update is an ACTION, so it wears the house primary-action treatment
     (accent on accent-glow) via the shared .btn classes above. It used to be a
     .tag.tag-yellow on a bare <button>: warning-amber uppercase inside the
     user agent's own border, which read as a system state in a broken box. */
  .update-badge {
    margin-left: 6px;
    font-size: 12px;
    text-transform: none;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .update-modal {
    background: var(--bg);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    max-width: 520px;
    width: 100%;
    overflow: hidden;
  }

  .update-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 24px 24px 16px;
    border-bottom: 1px solid var(--surface-border);
  }

  .update-modal-header h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .update-modal-sub {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }

  .update-close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 22px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .update-close:hover {
    color: var(--text-primary);
  }

  .update-steps {
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .update-step {
    display: flex;
    gap: 12px;
  }

  .update-step-num {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(255, 107, 53, 0.08);
    border: 1px solid rgba(255, 107, 53, 0.15);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .update-step-content {
    flex: 1;
    min-width: 0;
  }

  .update-step-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    display: block;
    margin-bottom: 6px;
  }

  .update-code-wrap pre {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 10px 12px;
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    overflow: hidden;
  }

  .update-code-wrap code {
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .update-copy-all {
    padding: 0 24px 16px;
    display: flex;
  }

  .update-copy-all :global(.btn) {
    width: 100%;
    justify-content: center;
  }

  .update-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--surface-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .update-footer-info {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .update-release-btn {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 14px;
    border: 1px solid rgba(255, 107, 53, 0.25);
    border-radius: 4px;
    background: rgba(255, 107, 53, 0.06);
    transition: background 0.15s;
  }

  .update-release-btn:hover {
    background: rgba(255, 107, 53, 0.12);
    text-decoration: none;
  }

  .back-link {
    display: inline-block;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }
  .back-link:hover {
    color: var(--accent);
    text-decoration: none;
  }
  .server-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .server-header h1 {
    font-size: 22px;
    font-weight: 600;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }
  .info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .info-item span:last-child {
    font-size: 14px;
  }
  /* Below 720px the auto-fill track above resolved to a single column, so
     eight metadata rows filled 477px and the first alert did not appear until
     817px: on an 844px phone you scrolled a whole screen past "which box is
     this" before reaching "what is wrong with it". Two columns, tighter
     rhythm, and a full row only for the three values that genuinely need one
     (agent version with its update badge, hardware string, IPMI status with
     its help link). */
  @media (max-width: 720px) {
    .info-grid {
      grid-template-columns: 1fr 1fr;
      gap: 12px 16px;
      margin-bottom: 20px;
    }
    .info-item-wide {
      grid-column: 1 / -1;
    }
  }

  .section {
    margin-bottom: 32px;
  }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 14px;
  }
  /* Sub-heading within a section (e.g. SMART disk health under Storage). */
  .storage-sub {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin: 20px 0 10px;
  }
  .alerts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .alerts-header .section-title {
    margin-bottom: 0;
  }
  .alert-tabs {
    display: flex;
    gap: 4px;
    background: var(--surface);
    border-radius: 4px;
    padding: 2px;
    border: 1px solid var(--surface-border);
  }
  .alert-tab {
    background: none;
    border: none;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.15s, color 0.15s;
  }
  .alert-tab:hover {
    color: var(--text-secondary);
  }
  .alert-tab.active {
    background: var(--accent-glow);
    color: var(--accent);
    font-weight: 500;
  }
  .resolved-row {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 8px;
  }
  .resolved-header {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
  }
  .resolved-type {
    font-size: 12px;
    color: var(--text-tertiary);
    font-family: monospace;
  }
  .resolved-severity {
    font-size: 12px;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 2px;
    background: var(--elevated);
  }
  .resolved-severity.tag-critical { color: var(--red); }
  .resolved-severity.tag-warning { color: var(--yellow); }
  .resolved-title {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 6px;
    /* Match the active-alert title disambiguation so historical
       titles like "1 systemd service failed" don't render with a "1"
       that looks like the letter "I". See AlertRow.svelte. */
    font-variant-numeric: tabular-nums lining-nums;
  }
  .resolved-times {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .resolved-duration {
    color: var(--text-secondary);
  }
  .muted-text {
    font-size: 13px;
    color: var(--text-tertiary);
    padding: 12px 0;
  }
  .tw-upgrade {
    background: #121417;
    border: 1px solid #313742;
    border-left: 4px solid #ff6b35;
    border-radius: 4px;
    padding: 18px 22px;
  }
  .tw-upgrade-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .muted-info {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .muted-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .muted-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
  }
  .muted-rule-name {
    font-family: "SF Mono", "Fira Code", "Consolas", monospace;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .profile-inline {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .profile-inline-label {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  /* Compact: override the global full-width select from base.css. The chevron
     comes from the global select rule; 30px right keeps the text clear of it.
     The UA arrow this replaces sat almost on the border, at an inset the page
     cannot style. */
  .profile-inline-select {
    width: auto;
    padding: 4px 30px 4px 8px;
    font-size: 12px;
  }
  .profile-info {
    position: relative;
    display: inline-flex;
  }
  .profile-info-icon {
    background: none;
    border: none;
    padding: 0;
    line-height: 1;
    color: var(--text-tertiary);
    cursor: help;
    font-size: 13px;
    user-select: none;
  }
  .profile-info-icon:hover {
    color: var(--accent);
  }
  /* Hover- AND focus-triggered tooltip (the native title= showed nothing on
     click and was unreliable on hover). focus-within means clicking/tabbing
     the icon also opens it. .server-header has no overflow/transform, so the
     absolute popover is not clipped. */
  .profile-info-pop {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    /* Above the pinned section-nav (`.section-nav.pinned`, z-index 90),
       whose near-opaque backdrop-blurred background otherwise paints a dark
       band across the middle of this tooltip when scrolled. Neither
       .server-header nor .profile-info makes a stacking context, so this
       competes directly in the root context; stay below the modal overlay
       (9999). */
    z-index: 100;
    width: 280px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    text-align: left;
    white-space: normal;
    box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease;
  }
  .profile-info:hover .profile-info-pop,
  .profile-info:focus-within .profile-info-pop {
    opacity: 1;
    visibility: visible;
  }
  .profile-nudge {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: var(--accent-muted);
    border: 1px solid var(--accent);
    border-radius: 4px;
  }
  .profile-nudge-text {
    flex: 1;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .profile-nudge-apply {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .ipmi-reason {
    color: var(--text-tertiary);
    font-size: 13px;
  }
  .ipmi-help {
    color: var(--accent);
    font-size: 12px;
    text-decoration: none;
    margin-left: 4px;
  }
  .ipmi-help:hover {
    text-decoration: underline;
  }

  .security-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .sec-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sec-item-vulns {
    grid-column: 1 / -1;
  }
  .vuln-details {
    margin-top: 4px;
  }
  .vuln-toggle {
    font-size: 12px;
    color: var(--text-tertiary);
    cursor: pointer;
    list-style: none;
  }
  .vuln-toggle::-webkit-details-marker { display: none; }
  .vuln-toggle::before { content: "\25B6 "; font-size: 12px; }
  details[open] > .vuln-toggle::before { content: "\25BC "; }
  .vuln-list {
    list-style: none;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .vuln-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .vuln-dot {
    width: 6px;
    height: 6px;
    min-width: 6px;
    border-radius: 50%;
  }
  .vuln-name {
    font-weight: 500;
    color: var(--text-primary);
    min-width: 0;
  }
  .vuln-status {
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-tertiary);
    font-size: 14px;
  }

  .suspended-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    background: #2A2412;
    border: 1px solid #E0A93B;
    border-radius: 4px;
    padding: 12px 16px;
    margin: 16px 0 20px;
    color: #ECEEF1;
  }

  /* Same shape as .suspended-banner but informational rather than a billing
     action: a duplicate hostname is a data-hygiene problem, not a service stop. */
  .ambiguous-banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #2A2412;
    border: 1px solid #E0A93B;
    border-radius: 4px;
    padding: 12px 16px;
    margin: 16px 0 20px;
    color: #ECEEF1;
  }
  .suspended-banner strong {
    color: #E0A93B;
  }
  .suspended-banner-actions {
    display: flex;
    gap: 8px;
  }
</style>
