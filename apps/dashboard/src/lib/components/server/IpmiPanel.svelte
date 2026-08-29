<script lang="ts">
  // IPMI panel: the full BMC sensor readout, collapsed by default under a
  // single "IPMI sensors (N)" disclosure so it stays out of the way (it is
  // rarely the thing an operator wants first). Curated thermals/fans live in
  // Host vitals and ECC lives in the Memory tile; this is the complete raw
  // list. Pure presentational; parent gates on ipmi presence.

  interface Sensor { name?: string; value?: number | string; unit?: string; }
  // hideThermal / gpuAvailable are retained for API compatibility with the
  // caller. gpuAvailable still demotes the redundant IPMI "GPU* Temp" sensor
  // when OS GPU telemetry is present (the GPU cards show the die temp).
  interface Props { ipmi?: any; hideThermal?: boolean; gpuAvailable?: boolean; }
  let { ipmi = null, hideThermal = false, gpuAvailable = false }: Props = $props();

  let sensors = $derived<Sensor[]>(Array.isArray(ipmi?.sensors) ? ipmi.sensors : []);
  const num = (v: any) => (typeof v === "number" ? v : Number(v));

  const isGpuTemp = (s: Sensor) => s.unit === "degrees C" && /gpu/i.test(s.name ?? "");
  let temps = $derived(sensors.filter((s) => s.unit === "degrees C" && !(gpuAvailable && isGpuTemp(s))));
  let fans = $derived(sensors.filter((s) => s.unit === "RPM"));
  let powers = $derived(sensors.filter((s) => s.unit === "Watts"));
  let others = $derived(
    sensors.filter((s) => {
      const u = s.unit ?? "";
      if (u === "RPM" || u === "Watts") return false;
      if (u === "degrees C") return gpuAvailable && isGpuTemp(s);
      return true;
    })
  );

  function tempColor(c: number): string {
    if (!Number.isFinite(c)) return "var(--text-primary)";
    return c >= 75 ? "var(--red)" : c >= 60 ? "var(--yellow)" : "var(--green)";
  }
  function unitSuffix(u?: string): string {
    if (u === "degrees C") return "°C";
    if (u === "RPM") return "rpm";
    if (u === "Volts") return "V";
    if (u === "Watts") return "W";
    return u ? ` ${u}` : "";
  }
</script>

{#if sensors.length > 0}
  <details class="ipmi-fold">
    <summary>
      <span class="fold-arrow" aria-hidden="true">▸</span>
      <span class="fold-title">IPMI sensors</span>
      <span class="fold-count">({sensors.length})</span>
    </summary>
    <div class="fold-body">
      {#if temps.length > 0}
        <div class="ipmi-sub">Temperatures</div>
        <div class="tile-grid">
          {#each temps as t}
            <div class="tile">
              <div class="k">{t.name}</div>
              <div class="v" style="color:{tempColor(num(t.value))}">{t.value}<span class="u">{unitSuffix(t.unit)}</span></div>
            </div>
          {/each}
        </div>
      {/if}

      {#if fans.length > 0}
        <div class="ipmi-sub">Fans</div>
        <div class="tile-grid">
          {#each fans as f}
            {@const spinning = num(f.value) > 0}
            <div class="tile fan-tile">
              <span class="status-dot" style="background:{spinning ? 'var(--green)' : 'var(--red)'}"></span>
              <div class="fan-body">
                <div class="k">{f.name}</div>
                <div class="v">{f.value}<span class="u">{unitSuffix(f.unit)}</span></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if powers.length > 0}
        <div class="ipmi-sub">Power</div>
        <div class="tile-grid">
          {#each powers as p}
            <div class="tile">
              <div class="k">{p.name}</div>
              <div class="v">{p.value}<span class="u">{unitSuffix(p.unit)}</span></div>
            </div>
          {/each}
        </div>
      {/if}

      {#if others.length > 0}
        <div class="ipmi-sub">Other</div>
        <div class="tile-grid">
          {#each others as o}
            <div class="tile">
              <div class="k">{o.name}</div>
              <div class="v" style="font-size:16px">{o.value}<span class="u">{unitSuffix(o.unit)}</span></div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </details>
{:else}
  <div class="ipmi-empty">No IPMI sensors reported.</div>
{/if}

<style>
  /* One collapsible whose summary is the section header ("IPMI sensors (N)").
     The parent no longer renders a separate "IPMI" h2. */
  .ipmi-fold > summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;
    user-select: none;
  }
  .ipmi-fold > summary::-webkit-details-marker { display: none; }
  .fold-arrow { font-size: 17px; line-height: 1; color: var(--text-secondary); transition: transform 0.15s; display: inline-block; transform-origin: 45% 55%; }
  .ipmi-fold[open] > summary .fold-arrow { transform: rotate(90deg); }
  .ipmi-fold > summary:hover .fold-arrow { color: var(--accent); }
  .fold-count { font-size: 13px; font-weight: 500; color: var(--text-tertiary); }
  .fold-body { margin-top: 12px; }

  .ipmi-sub { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); margin: 16px 0 10px; }
  .ipmi-sub:first-child { margin-top: 0; }
  .tile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .tile { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; padding: 12px 14px; }
  .tile .k { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .v { font-size: 20px; font-weight: 700; margin-top: 5px; font-variant-numeric: tabular-nums; }
  .tile .v .u { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .fan-tile { display: flex; align-items: center; gap: 10px; }
  .fan-body { flex: 1; min-width: 0; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .ipmi-empty { font-size: 13px; color: var(--text-tertiary); }
</style>
