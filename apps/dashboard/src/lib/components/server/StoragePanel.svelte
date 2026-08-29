<script lang="ts">
  // Storage panel: one card per mount with a big used figure + fill bar.
  // Accepts the raw disk objects from the snapshot (used_gb/used_mb variants).

  interface Disk {
    mount?: string;
    mountpoint?: string;
    used_mb?: number;
    used_gb?: number;
    total_mb?: number;
    total_gb?: number;
    percent_used?: number;
    percent?: number;
  }
  interface Props { disks?: Disk[]; }
  let { disks = [] }: Props = $props();

  function usedMb(d: Disk): number { return d.used_mb ?? (d.used_gb ?? 0) * 1024; }
  function totalMb(d: Disk): number { return d.total_mb ?? (d.total_gb ?? 0) * 1024; }
  function pct(d: Disk): number {
    const p = d.percent_used ?? d.percent;
    if (typeof p === "number") return p;
    const t = totalMb(d);
    return t > 0 ? (usedMb(d) / t) * 100 : 0;
  }
  function gb(mb: number): string {
    if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
    return `${(mb / 1024).toFixed(mb / 1024 >= 100 ? 0 : 1)} GB`;
  }
  function color(p: number): string {
    return p >= 90 ? "var(--red)" : p >= 75 ? "var(--yellow)" : "var(--green)";
  }
</script>

<div class="mount-list">
  {#each disks as d}
    {@const p = pct(d)}
    <div class="card mount">
      <div class="mount-top">
        <span class="mount-name">{d.mount ?? d.mountpoint ?? "unknown"}</span>
        <span class="mount-detail">{gb(usedMb(d))} / {gb(totalMb(d))} &middot; {p.toFixed(1)}%</span>
      </div>
      <div class="mount-bar"><div class="mount-fill" style="width:{Math.max(p, 1)}%;background:{color(p)}"></div></div>
    </div>
  {/each}
</div>

<style>
  .mount-list { display: flex; flex-direction: column; gap: 12px; }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 4px; }
  .mount { padding: 14px 18px; }
  .mount-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .mount-name { font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .mount-detail { font-size: 12px; color: var(--text-tertiary); }
  .mount-bar { height: 8px; border-radius: 4px; background: var(--bg-elevated); margin-top: 10px; overflow: hidden; }
  .mount-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
</style>
