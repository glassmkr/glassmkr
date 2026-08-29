// Resolve a degraded mdadm array's failed members to their physical-drive
// identity (model + serial), so a provider ticket can name the exact drive to
// pull, not just the array. mdadm reports members as bare kernel names that may
// be partitions (e.g. "sdb2"); SMART is collected per physical disk
// ("/dev/sdb"), so we strip the partition suffix and match on the base device.
// Best-effort: a fully removed or dead disk is absent from the SMART scan, so we
// keep the member name with null identity rather than guessing.
//
// Hardware RAID has no analogue here: its failed disk sits behind the controller
// and its serial only comes from the vendor CLI, never from SMART. This module
// is mdadm-only.

export interface SmartDriveLike {
  device?: string | null;
  model?: string | null;
  serial?: string | null;
}

export interface FailedMember {
  /** Raw mdadm member token as reported, e.g. "sdb2". */
  member: string;
  /** Resolved SMART device path (e.g. "/dev/sdb"), or null if not matched. */
  device: string | null;
  model: string | null;
  serial: string | null;
}

/**
 * Normalize a device token to its base physical-disk name:
 *   "/dev/sdb2" -> "sdb", "nvme0n1p3" -> "nvme0n1", "sda" -> "sda".
 * Returns null for empty/nullish input.
 */
export function baseDiskName(dev: string | null | undefined): string | null {
  if (dev == null) return null;
  const s = String(dev).trim().replace(/^\/dev\//, "");
  if (!s) return null;
  // NVMe namespace + optional partition: nvme0n1, nvme0n1p2 -> nvme0n1.
  const nvme = /^(nvme\d+n\d+)(?:p\d+)?$/.exec(s);
  if (nvme) return nvme[1];
  // SCSI/SATA/virtio/xen: sda, sdb2 -> sdb, vda1 -> vda, xvda3 -> xvda.
  const blk = /^([a-z]+)\d*$/.exec(s);
  if (blk) return blk[1];
  return s;
}

/**
 * Join each failed mdadm member to its SMART identity by base device. The SMART
 * array is the snapshot's per-disk SMART collection; entries are keyed by their
 * own device path. Unmatched members (a disk that has dropped out of the SMART
 * scan) carry null model/serial.
 */
export function resolveFailedMembers(
  failedDisks: ReadonlyArray<string> | null | undefined,
  smart: ReadonlyArray<SmartDriveLike> | null | undefined,
): FailedMember[] {
  const byBase = new Map<string, SmartDriveLike>();
  for (const d of smart ?? []) {
    const base = baseDiskName(d?.device);
    // A physical disk has one SMART entry; partitions are not in SMART. First
    // writer wins so a stray duplicate cannot shadow the real disk.
    if (base && !byBase.has(base)) byBase.set(base, d);
  }
  return (failedDisks ?? []).map((member) => {
    const base = baseDiskName(member);
    const drive = base ? byBase.get(base) : undefined;
    return {
      member: String(member),
      device: drive?.device ?? null,
      model: drive?.model ?? null,
      serial: drive?.serial ?? null,
    };
  });
}
