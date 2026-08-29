<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import StorageRow from "./StorageRow.svelte";
  import SMARTRow from "./SMARTRow.svelte";
</script>

<DashboardFrame>
  <div class="body">
    <h2>Storage</h2>
    <div class="rows">
      <StorageRow mount="/" used="133.3 GB" total="438.7 GB" percent={33.0} />
      <StorageRow mount="/boot/efi" used="0 MB" total="256 MB" percent={1.0} />
    </div>

    <h2 class="mt">SMART Health</h2>
    <div class="rows">
      <SMARTRow
        device="/dev/sda"
        model="SAMSUNG MZ7L3480HCHQ-00B7C"
        temperature="43°C"
        uptime="31d uptime"
      />
      <SMARTRow
        device="/dev/sdb"
        model="SAMSUNG MZ7L3480HCHQ-00B7C"
        temperature="43°C"
        uptime="31d uptime"
      />
    </div>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px 22px 24px;
    height: 100%;
    overflow: hidden;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    margin: 0 0 12px;
  }
  .mt { margin-top: 22px; }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
