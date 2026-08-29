<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import ServerCard from "./ServerCard.svelte";

  // Generic server fleet. Hostnames are illustrative; IPs use the
  // RFC 5737 documentation block (192.0.2.0/24) so the example
  // doesn't accidentally point at someone's real infra. Mixed
  // status: one with active alerts, two acked.
</script>

<DashboardFrame>
  <div class="body">
    <div class="header">
      <h2>Your Servers</h2>
      <span class="add-btn">+ Add Server</span>
    </div>
    <div class="grid">
      <ServerCard
        hostname="web-prod-1"
        distro="ubuntu 24.04 LTS"
        ip="192.0.2.10"
        lastSeen="12s ago"
        status="amber"
        badge={{ count: 2, kind: "alerts" }}
      />
      <ServerCard
        hostname="db-prod-2"
        distro="ubuntu 24.04 LTS"
        ip="192.0.2.20"
        lastSeen="47s ago"
        status="green"
        badge={{ count: 1, kind: "acked" }}
      />
      <ServerCard
        hostname="cache-eu-1"
        distro="ubuntu 24.04 LTS"
        ip="192.0.2.30"
        lastSeen="1m ago"
        status="green"
        badge={{ count: 1, kind: "acked" }}
      />
    </div>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px 18px 24px;
    height: 100%;
    overflow: hidden;
    /* Container queries on .body let the grid below switch between
       1-column stack and 3-column row based on the chapter image
       column's actual width, not the page viewport. With exactly
       three cards this avoids the awkward 2+1 stranded layout that
       auto-fit produced at intermediate widths. */
    container-type: inline-size;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    margin: 0;
  }
  .add-btn {
    font-size: 12px;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    padding: 5px 11px;
    background: rgba(245, 166, 35, 0.05);
  }
  .grid {
    display: grid;
    /* Default to single-column stack; widen to 3 columns when the
       container is wide enough to fit them comfortably. Skips the
       intermediate "2 cards + 1 stranded" auto-fit produced
       previously. */
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @container (min-width: 720px) {
    .grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
