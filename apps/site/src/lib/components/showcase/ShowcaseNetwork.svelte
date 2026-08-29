<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import NetworkRow from "./NetworkRow.svelte";
  const ifaces = [
    { iface: "enp1s0f0 (slave of bond0)", speed: "10 Gbps", rx: "15.8 KB/s", tx: "0 B/s",  errors: 0 },
    { iface: "enp1s0f1 (slave of bond0)", speed: "10 Gbps", rx: "60 B/s",    tx: "7.8 KB/s", errors: 0 },
    { iface: "enxbe3af2b6059f",           speed: "N/A",     rx: "0 B/s",     tx: "0 B/s",  errors: 0 },
    { iface: "bond0",                     speed: "20 Gbps", rx: "15.8 KB/s", tx: "7.8 KB/s", errors: 0 },
    { iface: "wg0",                       speed: "N/A",     rx: "0 B/s",     tx: "0 B/s",  errors: 0 },
  ];
</script>

<DashboardFrame>
  <div class="body">
    <h2>Network Interfaces</h2>
    <table>
      <thead>
        <tr>
          <th>INTERFACE</th>
          <th>SPEED</th>
          <th>RX/S</th>
          <th>TX/S</th>
          <th>ERRORS</th>
        </tr>
      </thead>
      <tbody>
        {#each ifaces as f (f.iface)}
          <NetworkRow iface={f.iface} speed={f.speed} rx={f.rx} tx={f.tx} errors={f.errors} />
        {/each}
      </tbody>
    </table>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px 22px 22px;
    height: 100%;
    overflow: hidden;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    margin: 0 0 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    padding: 8px 12px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--text-tertiary, #707070);
    text-transform: uppercase;
    border-bottom: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
  }
</style>
