<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import IPMISensor from "./IPMISensor.svelte";

  // Visually-interesting subset (12 of 22) per spec.
  const sensors = [
    { name: "CPU TEMP", value: "53", unit: "°C" },
    { name: "SYSTEM TEMP", value: "44", unit: "°C" },
    { name: "PERIPHERAL TEMP", value: "38", unit: "°C" },
    { name: "CPU_VRM0 TEMP", value: "42", unit: "°C" },
    { name: "DIMMAB TEMP", value: "38", unit: "°C" },
    { name: "FAN1", value: "10780", unit: "RPM" },
    { name: "MB 12V", value: "12.075", unit: "V" },
    { name: "MB 5VCC", value: "5.12", unit: "V" },
    { name: "MB 3.3VCC", value: "3.343", unit: "V" },
    { name: "VBAT", value: "0", unit: "discrete" },
    { name: "GPU0 TEMP", value: "58", unit: "°C" },
    { name: "PS1 STATUS", value: "0", unit: "discrete" },
  ];
</script>

<DashboardFrame>
  <div class="body">
    <div class="head-row">
      <h2>IPMI</h2>
      <span class="ecc">CORRECTABLE: 0, UNCORRECTABLE: 0</span>
    </div>
    <div class="grid">
      {#each sensors as s (s.name)}
        <IPMISensor name={s.name} value={s.value} unit={s.unit} />
      {/each}
    </div>
    <p class="show-all">Show all 22 sensors</p>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px 22px 22px;
    height: 100%;
    overflow: hidden;
  }
  .head-row {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #f0f0f0);
    margin: 0;
  }
  .ecc {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    background: rgba(52, 211, 153, 0.1);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.25);
    padding: 3px 8px;
    border-radius: var(--radius-md);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .show-all {
    margin: 14px 0 0;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary, #707070);
  }
  @media (max-width: 700px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
