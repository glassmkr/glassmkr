<script lang="ts">
  import DashboardFrame from "./DashboardFrame.svelte";
  import AlertCard from "./AlertCard.svelte";

  // Single P1 RAID degraded alert with the multi-line fix block.
  // Cropped at 480px chapter cap; the bottom of the FIX block fades
  // out under the gradient. The chapter prose below repeats the key
  // commands so the message survives the crop.

  const fixCommands = [
    "# Identify the degraded array and the failed member (alert evidence has the device names)",
    "cat /proc/mdstat",
    "sudo mdadm --detail /dev/mdX  # replace mdX with the array from the alert",
    "lsblk",
    "",
    "# After replacing the failed disk, re-add the new member",
    "sudo mdadm --manage /dev/mdX --add /dev/sdYN  # sdYN = partition on the new disk",
    "",
    "# Watch the rebuild progress",
    "watch -n 5 cat /proc/mdstat",
  ];
</script>

<DashboardFrame>
  <div class="body">
    <AlertCard
      severity="P1"
      title="RAID md126 degraded"
      description="md126 (raid1) is degraded. Failed disks: sda1. One more failure means data loss."
      sustained="Sustained just now. (raid_degraded)"
      evidenceLink="Storage overview"
      fixCommands={fixCommands}
      fired="Fired: 2026-05-05 08:02:31 UTC"
    >
      {#snippet action()}
        Replace the failed drive immediately. Check
        <code>cat /proc/mdstat</code>
        and
        <code>mdadm --detail /dev/md126</code>
        for status.
      {/snippet}
    </AlertCard>
  </div>
</DashboardFrame>

<style>
  .body {
    padding: 18px;
  }
</style>
