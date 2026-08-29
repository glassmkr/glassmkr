<script lang="ts">
  // Network panel: per-interface saturation / errors / discards. These are the
  // actionable signals (raw throughput alone ignores the link ceiling). Error
  // and discard tiers reuse the shared classifier so the dashboard colours
  // match what the interface_errors / softnet_drops rules actually fire on.

  import {
    classifyInterfaceTier,
    hardwareErrorSum,
    dropSum,
    type IfaceLike,
  } from "$lib/alerts/interface-tiers";

  interface Props {
    interfaces?: IfaceLike[];
    firewallActive?: boolean;
  }

  let { interfaces = [], firewallActive = false }: Props = $props();

  interface NetIface extends IfaceLike {
    speed_mbps?: number;
    rx_bytes_sec?: number;
    tx_bytes_sec?: number;
  }

  const isBondIface = (n: NetIface) =>
    n.is_bond_master === true || (n.interface ?? "").startsWith("bond");

  // Drop loopback; it carries no link/error signal worth a card.
  let nics = $derived(
    (interfaces as NetIface[]).filter((i) => (i.interface ?? "") !== "lo")
  );

  // An interface with no negotiated link speed (and not a bond master) is
  // almost always an unused / unplugged port: no carrier, so saturation
  // can't be computed. We still track errors/discards on it, but it adds
  // noise to a box with many onboard NICs, so hide these behind a toggle.
  let knownNics = $derived(nics.filter((n) => (n.speed_mbps ?? 0) > 0 || isBondIface(n)));
  let unknownNics = $derived(nics.filter((n) => !((n.speed_mbps ?? 0) > 0) && !isBondIface(n)));
  let showUnknown = $state(false);
  // If every interface lacks a link speed, there is nothing to collapse to,
  // so just show them all rather than an empty panel behind a toggle.
  let visibleNics = $derived(
    knownNics.length === 0
      ? unknownNics
      : showUnknown
        ? [...knownNics, ...unknownNics]
        : knownNics,
  );
  let hasHidden = $derived(knownNics.length > 0 && unknownNics.length > 0);

  const mbps = (bytesSec?: number) => ((bytesSec ?? 0) * 8) / 1_000_000;
  function speedLabel(mbpsVal?: number): string {
    if (!mbpsVal) return "link ?";
    return mbpsVal >= 1000 ? `${mbpsVal / 1000} GbE` : `${mbpsVal} Mb`;
  }
  function satColor(pct: number): string {
    return pct >= 80 ? "var(--red)" : pct >= 50 ? "var(--yellow)" : "var(--green)";
  }
  // Tier -> tag class. orange folds into yellow (base.css has no orange tag).
  function tierTag(tier: string): string {
    if (tier === "red") return "tag-red";
    if (tier === "orange" || tier === "yellow") return "tag-yellow";
    return "tag-green";
  }
</script>

<div class="net-grid">
  {#each visibleNics as n (n.interface)}
    {@const rx = mbps(n.rx_bytes_sec)}
    {@const tx = mbps(n.tx_bytes_sec)}
    {@const link = n.speed_mbps ?? 0}
    {@const sat = link > 0 ? (Math.max(rx, tx) / link) * 100 : null}
    {@const errors = hardwareErrorSum(n)}
    {@const drops = dropSum(n)}
    {@const tier = classifyInterfaceTier(n, 0, firewallActive)}
    {@const isBond = n.is_bond_master === true || (n.interface ?? "").startsWith("bond")}
    {@const statusColor = tier === "red" ? "var(--red)" : tier === "orange" || tier === "yellow" ? "var(--yellow)" : "var(--green)"}
    <div class="card net-card">
      <div class="net-head">
        <span class="net-name">{n.interface}{#if n.bond_master}<span class="bond-of"> in {n.bond_master}</span>{/if}</span>
        {#if isBond}<span class="net-speed">bond</span>{:else}<span class="net-speed">{speedLabel(link)}</span>{/if}
        <span class="status-dot" style="margin-left:auto;background:{statusColor}"></span>
      </div>

      <div class="net-sat-top">
        <span>Saturation</span>
        {#if sat !== null}
          <span class="net-sat-pct" style="color:{satColor(sat)}">{sat < 0.1 ? sat.toFixed(2) : sat.toFixed(1)}%</span>
        {:else}
          <span class="net-sat-pct" style="color:var(--text-tertiary);font-size:12px">link speed unknown</span>
        {/if}
      </div>
      {#if sat !== null}
        <div class="sat-bar"><div class="sat-fill" style="width:{Math.max(sat, 1)}%;background:{satColor(sat)}"></div></div>
      {/if}
      <div class="net-detail">rx {rx.toFixed(rx < 1 ? 2 : 1)} &middot; tx {tx.toFixed(tx < 1 ? 2 : 1)} Mbps{#if link > 0}&nbsp;of {speedLabel(link)}{/if}</div>

      <div class="net-stats">
        <div class="net-stat">
          <div class="k">Errors</div>
          <div class="v"><span class="tag {errors === 0 ? 'tag-green' : tierTag(tier)}">{errors}</span><span class="sub">hw errors</span></div>
        </div>
        <div class="net-stat">
          <div class="k">Discards</div>
          <div class="v"><span class="tag {drops === 0 ? 'tag-green' : tierTag(tier)}">{drops}</span><span class="sub">dropped</span></div>
        </div>
      </div>
    </div>
  {/each}
</div>

{#if hasHidden}
  <button class="net-toggle" onclick={() => (showUnknown = !showUnknown)} aria-expanded={showUnknown}>
    <span class="chev" class:open={showUnknown}>&rsaquo;</span>
    {showUnknown
      ? "Hide interfaces with no link speed"
      : `Show ${unknownNics.length} interface${unknownNics.length === 1 ? "" : "s"} with no link speed`}
  </button>
{/if}

<style>
  .net-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
  .net-toggle {
    display: flex; align-items: center; gap: 8px; margin-top: 12px;
    background: var(--surface); border: 1px solid var(--surface-border);
    color: var(--text-secondary); border-radius: 4px; padding: 9px 14px;
    font-size: 13px; font-weight: 500; cursor: pointer; width: 100%;
    transition: border-color 0.15s, color 0.15s;
  }
  .net-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .net-toggle .chev { display: inline-block; transition: transform 0.15s; font-size: 16px; line-height: 1; }
  .net-toggle .chev.open { transform: rotate(90deg); }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; }
  .net-card { padding: 16px 18px; }
  .net-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .net-name { font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .bond-of { color: var(--text-tertiary); font-weight: 400; font-size: 12px; }
  .net-speed { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 4px; color: var(--text-secondary); border: 1px solid var(--surface-border); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

  .net-sat-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--text-secondary); }
  .net-sat-pct { font-weight: 700; font-size: 14px; }
  .sat-bar { height: 8px; border-radius: 4px; background: var(--bg-elevated); margin: 8px 0 6px; overflow: hidden; }
  .sat-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .net-detail { font-size: 12px; color: var(--text-tertiary); }

  .net-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
  .net-stat { background: var(--bg-elevated); border-radius: 4px; padding: 9px 12px; }
  .net-stat .k { font-size: 12px; color: var(--text-tertiary); }
  .net-stat .v { font-size: 16px; font-weight: 700; margin-top: 3px; display: flex; align-items: center; gap: 6px; }
  .net-stat .sub { font-size: 12px; color: var(--text-tertiary); font-weight: 400; }

  .tag { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 4px; }
  .tag-green { background: var(--green-bg); color: var(--green); }
  .tag-yellow { background: var(--yellow-bg); color: var(--yellow); }
  .tag-red { background: var(--red-bg); color: var(--red); }
</style>
