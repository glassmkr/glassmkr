<script lang="ts">
  interface Props {
    iface: string;
    speed: string;
    rx: string;
    tx: string;
    errors: string | number;
  }
  let { iface, speed, rx, tx, errors }: Props = $props();
</script>

<tr>
  <td class="iface">{iface}</td>
  <td>{speed}</td>
  <td>{rx}</td>
  <td>{tx}</td>
  <td>{errors}</td>
</tr>

<style>
  tr {
    border-top: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
  }
  td {
    padding: 8px 12px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary, #a0a0a0);
  }
  td.iface {
    color: var(--text-primary, #f0f0f0);
  }
</style>
