<script lang="ts">
  // Dense fleet view.
  //
  // This replaces a two-by-two grid of large cards, which is the generic SaaS
  // pattern the redesign set out to avoid and which an external audit called out
  // by name. A card grid gives every host the same weight and spends a whole
  // viewport on four machines; an operator opening this page wants to know which
  // box needs them, and cards make that a scanning exercise.
  //
  // Desktop is a table because a fleet is tabular: one row per host, columns you
  // can compare down. Mobile keeps rows rather than inflating each host back
  // into a card, with the two facts that decide whether you tap through, alerts
  // and freshness, on the first line next to the hostname.
  import { goto } from "$app/navigation";
  import { timeAgo } from "$lib/utils/time";
  import { normalizeVendor } from "$lib/utils/vendor";
  import { serverLinkPath } from "$lib/utils/server-slug";

  type Row = {
    id: string;
    name: string;
    hostname?: string | null;
    os_type?: string | null;
    os_version?: string | null;
    status?: string | null;
    last_seen_at: string | null;
    dmi_vendor?: string | null;
    dmi_product?: string | null;
    alertCount?: number;
    unackedCount?: number;
    trendWarningCount?: number;
    profile?: string | null;
  };

  let { servers = [], fleet = [] }: { servers: Row[]; fleet: Row[] } = $props();

  // Stale is a fact about the data, not a health verdict: a host that stopped
  // reporting is not healthy, and showing its last known state as if it were
  // current is how a dead box looks fine.
  const STALE_AFTER_MS = 15 * 60 * 1000;

  function freshness(s: Row): { label: string; state: "fresh" | "stale" | "never" } {
    if (!s.last_seen_at) return { label: "never", state: "never" };
    const age = Date.now() - new Date(s.last_seen_at).getTime();
    return { label: timeAgo(s.last_seen_at), state: age > STALE_AFTER_MS ? "stale" : "fresh" };
  }

  function hardware(s: Row): string {
    const vendor = normalizeVendor(s.dmi_vendor) ?? "";
    const product = (s.dmi_product ?? "").trim();
    return [vendor, product].filter(Boolean).join(" ") || "unknown";
  }

  function distro(s: Row): string {
    return [s.os_type, s.os_version].filter(Boolean).join(" ") || "unknown";
  }

  // Worst first by default: the reason to open this page is the host that needs
  // attention. The controls below let you re-order without losing that as the
  // starting point, and they exist because a fleet of four is not the fleet this
  // has to work on.
  type SortKey = "attention" | "freshness" | "host";
  let sortKey = $state<SortKey>("attention");
  let onlyAttention = $state(false);
  let profile = $state("");

  const alertsOf = (s: Row) => s.unackedCount ?? s.alertCount ?? 0;
  const seenOf = (s: Row) => (s.last_seen_at ? new Date(s.last_seen_at).getTime() : 0);
  const needsAttention = (s: Row) =>
    alertsOf(s) > 0 || (s.trendWarningCount ?? 0) > 0 || freshness(s).state !== "fresh";

  // Only offer the profile filter when the fleet actually has more than one, so
  // a small fleet does not get a control that can only ever be a no-op.
  let profiles = $derived(
    [...new Set(servers.map((s) => s.profile ?? "").filter(Boolean))].sort(),
  );

  let ordered = $derived(
    [...servers]
      .filter((s) => (onlyAttention ? needsAttention(s) : true))
      .filter((s) => (profile ? (s.profile ?? "") === profile : true))
      .sort((a, b) => {
        if (sortKey === "host") {
          return (a.name || a.hostname || "").localeCompare(b.name || b.hostname || "");
        }
        if (sortKey === "freshness") return seenOf(a) - seenOf(b);
        const alerts = alertsOf(b) - alertsOf(a);
        if (alerts !== 0) return alerts;
        const trends = (b.trendWarningCount ?? 0) - (a.trendWarningCount ?? 0);
        if (trends !== 0) return trends;
        return seenOf(a) - seenOf(b);
      }),
  );

  let hiddenCount = $derived(servers.length - ordered.length);

  // The whole row is the target, not just the hostname: every cell describes
  // the same host, so a click anywhere on the row should open it. The anchor
  // stays as the accessible, keyboard-reachable primary link; the row handler
  // only fires for clicks that did not land on a link or button, and it
  // respects modifier clicks by falling through to nothing (there is no href
  // to open in a new tab from a div click, so those go through the anchor).
  function openRow(e: MouseEvent, s: Row) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, select, label")) return;
    if (window.getSelection()?.toString()) return;
    goto(serverLinkPath(s, fleet));
  }
</script>

<div class="fleet-controls">
  <label class="ctl">
    <span class="ctl-label">Sort</span>
    <select bind:value={sortKey} aria-label="Sort the fleet">
      <option value="attention">Needs attention first</option>
      <option value="freshness">Least recently seen</option>
      <option value="host">Hostname</option>
    </select>
  </label>
  {#if profiles.length > 1}
    <label class="ctl">
      <span class="ctl-label">Profile</span>
      <select bind:value={profile} aria-label="Filter by host profile">
        <option value="">All profiles</option>
        {#each profiles as p}
          <option value={p}>{p}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label class="ctl ctl-check">
    <input type="checkbox" bind:checked={onlyAttention} />
    <span>Only hosts needing attention</span>
  </label>
  {#if hiddenCount > 0}
    <!-- Say what a filter is hiding. A count that silently shrinks is how an
         operator concludes a host disappeared. -->
    <span class="ctl-note">{hiddenCount} of {servers.length} hidden by filters</span>
  {/if}
</div>

<div class="fleet-scroll" tabindex="0" role="region" aria-label="Fleet, scrolls horizontally on small screens">
  <table class="fleet">
    <thead>
      <tr>
        <th scope="col">Host</th>
        <th scope="col" class="count">Alerts</th>
        <th scope="col" class="count">Trend</th>
        <th scope="col">Last seen</th>
        <th scope="col">Distro</th>
        <th scope="col">Hardware</th>
      </tr>
    </thead>
    <tbody>
      {#if ordered.length === 0}
        <tr class="empty-row">
          <td colspan="6">No host matches these filters. Every one of your {servers.length} hosts is fresh and quiet.</td>
        </tr>
      {/if}
      {#each ordered as s (s.id)}
        {@const f = freshness(s)}
        {@const alerts = s.unackedCount ?? s.alertCount ?? 0}
        <tr class="row-link" onclick={(e) => openRow(e, s)}>
          <td class="host">
            <a href={serverLinkPath(s, fleet)}>{s.name || s.hostname || s.id}</a>
            {#if s.hostname && s.name && s.hostname !== s.name}
              <span class="host-sub">{s.hostname}</span>
            {/if}
          </td>
          <td class="count">
            {#if alerts > 0}
              <span class="pill pill-alert">{alerts}</span>
            {:else}
              <span class="pill pill-quiet">0</span>
            {/if}
          </td>
          <td class="count">
            {#if (s.trendWarningCount ?? 0) > 0}
              <span class="pill pill-trend" title="{s.trendWarningCount} trend warning(s)">~{s.trendWarningCount}</span>
            {:else}
              <span class="pill pill-quiet">&ndash;</span>
            {/if}
          </td>
          <td class="seen seen-{f.state}">{f.label}</td>
          <td class="mono">{distro(s)}</td>
          <td class="mono">{hardware(s)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .fleet-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 18px;
    margin-bottom: 12px;
  }
  .ctl { display: flex; align-items: center; gap: 8px; }
  .ctl-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .fleet-controls select {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 2px;
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
    /* Compact padding; the chevron itself comes from the global select rule in
       base.css. The 30px right keeps the text clear of it. */
    padding: 4px 30px 4px 8px;
  }
  .ctl-check { font-size: 13px; color: var(--text-secondary); cursor: pointer; }
  /* The label must stay on ONE line beside its checkbox. In the wrapping
     controls row the span was the only squeezable item, so it broke into a
     three-line sliver floating away from its box. */
  .ctl-check span { white-space: nowrap; }
  /* color-scheme: dark, same as the selects below. accent-color only tints the
     CHECKED fill; an unchecked checkbox without it renders as the light-mode
     control, a glaring white square on the dark page. Sized to match the 13px
     text instead of the UA default. */
  .ctl-check input {
    accent-color: var(--accent);
    color-scheme: dark;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .ctl-note { font-size: 12px; color: var(--text-tertiary); }

  .fleet-scroll {
    overflow-x: auto;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm, 2px);
  }
  .fleet-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .fleet { width: 100%; border-collapse: collapse; min-width: 44rem; }

  .fleet th {
    text-align: left;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    font-weight: 400;
    padding: 10px 14px;
    border-bottom: 1px solid var(--surface-border);
    background: var(--bg-surface);
  }
  .fleet td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: baseline;
    font-size: 14px;
  }
  .fleet tbody tr:last-child td { border-bottom: none; }
  .empty-row td { color: var(--text-tertiary); font-size: 13px; }

  /* The hostname is the row's primary action, and at 18px tall it was the
     smallest target in the fleet table. inline-flex with a 24px floor keeps the
     row height unchanged because the cell padding already exceeds it. */
  .host a {
    color: var(--text-primary); font-weight: 600; text-decoration: none;
    display: inline-flex; align-items: center; min-height: 24px;
  }
  .host a:hover { color: var(--accent); }
  .host a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .host-sub {
    display: block;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .mono { font-family: var(--font-mono, monospace); font-size: 13px; color: var(--text-secondary); }
  /* One centered column per count, so the value sits under its own label
     whether or not the other count exists. */
  .count { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; width: 4.5rem; }

  /* The row is clickable; say so. Links and buttons inside keep their own
     behavior (the click handler ignores them). */
  .row-link { cursor: pointer; }
  .row-link:hover td { background: var(--g-hover-surface); }

  /* Status color is reserved for health. Freshness is a separate axis and gets
     weight rather than hue, except when the data is stale enough that the health
     reading cannot be trusted. */
  .seen { font-family: var(--font-mono, monospace); font-size: 13px; white-space: nowrap; }
  .seen-fresh { color: var(--text-secondary); }
  .seen-stale { color: var(--yellow, #d8a02f); }
  .seen-never { color: var(--text-tertiary); }

  .pill {
    display: inline-block;
    min-width: 1.75rem;
    text-align: center;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    padding: 1px 7px;
    border-radius: var(--radius-sm, 2px);
    border: 1px solid transparent;
  }
  .pill-alert { background: var(--red-bg, rgba(200, 80, 60, 0.14)); color: var(--red, #c05f45); }
  .pill-quiet { color: var(--text-tertiary); }
  .pill-trend { color: var(--yellow, #d8a02f); }

  /* Mobile: still rows, not cards. Hostname, alerts and freshness on the first
     line, because those decide whether you open the host at all; distro and
     hardware follow underneath rather than being hidden, since they are how you
     recognise a box you have not touched in a month. */
  @media (max-width: 720px) {
    .fleet-scroll { overflow-x: visible; border: none; }
    .fleet { min-width: 0; }
    .fleet thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .fleet tbody tr {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 10px;
      padding: 14px 0;
      border-bottom: 1px solid var(--surface-border);
    }
    .fleet td { border: none; padding: 0; }
    .host { grid-column: 1; grid-row: 1; }
    .count { grid-column: 2; grid-row: 1; text-align: right; width: auto; }
    .count + .count { grid-row: 2; }
    .seen { grid-column: 2; grid-row: 3; text-align: right; }
    .mono { grid-column: 1; }
  }
</style>
