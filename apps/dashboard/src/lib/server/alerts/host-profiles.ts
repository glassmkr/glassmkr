// Host-type profiles: context-aware alert suppression.
//
// A server can carry a `profile` (servers.profile column, migration 031).
// Each profile names a set of rules that are expected-by-design for that host
// type and should not fire. Suppression is applied by unioning these rule ids
// into the server's effective muted set at ingest/evaluation time (see
// api/v1/ingest/+server.ts). The stored servers.muted_rules list and the
// GET /servers/:id/mutes endpoint are deliberately unchanged: they remain the
// operator's MANUAL mute list. Profile suppression is separate, declarative,
// and records its reason as the profile itself rather than as a per-rule mute.
//
// From the 20-box GPU fleet remediation report (rec #2): on a marketplace GPU
// host, no_firewall / unattended_upgrades_disabled / gpu_power_cap_throttling
// all fire because of REQUIRED marketplace config, not because anything is
// wrong. A host-type profile cuts that noise without per-rule, per-host mutes.

export interface HostProfile {
  id: string;
  label: string;
  description: string;
  suppressed_rules: string[];
}

export const HOST_PROFILES: Record<string, HostProfile> = {
  marketplace_gpu: {
    id: "marketplace_gpu",
    label: "Marketplace GPU host",
    description:
      "A GPU box rented out on a marketplace (Vast.ai and similar). Suppresses rules that fire on required or deliberate marketplace configuration: the host firewall must stay open for the rental port range (and fights Docker's iptables), automatic updates are disabled on purpose so an unattended upgrade cannot bump the NVIDIA driver out from under the running CUDA stack, the kernel therefore carries known CVEs that are patched on a scheduled maintenance reboot the operator chooses (not auto-applied), and these GPUs ship a conservative default power cap. Real problems still fire: a failing drive (smart_failing), uncorrected ECC with actual memory damage, PCIe degradation under load, and the driver-will-not-survive-reboot check. It also suppresses the I/O false-alarm family on these hosts (I/O pressure, iowait, and short-burst disk-fill projection), which are artifacts of Docker on a loopback file over an md RAID array on fast, mostly-idle NVMe. Disk latency is deliberately NOT suppressed here: its rule now classifies virtual/stacked-device latency (loop/dm/md) as info on its own, so a genuinely slow physical drive still fires even on a marketplace host.",
    suppressed_rules: [
      "no_firewall",
      "unattended_upgrades_disabled",
      "kernel_vulnerabilities",
      "gpu_power_cap_throttling",
      // Round 5: the I/O false-alarm family inherent to the Vast host
      // architecture (Docker on a loopback file over an md RAID array on fast,
      // mostly-idle NVMe). These are idle-percentage or ephemeral-churn
      // artifacts, not faults. Real disk failure is still caught by
      // smart_failing + disk_health_rollup (NOT suppressed).
      //
      // Deliberately NOT suppressed here, because each is handled inside its
      // own rule rather than blanket-muted, so a genuine fault still fires:
      //   - disk_latency_high classifies virtual/stacked devices (loop/dm/md)
      //     as info in-rule, keeping it diagnostic for a slow *physical* drive.
      //   - gpu_pcie_link_degraded: idle-downshift FP handled load-awarely, so
      //     a real under-load PCIe degradation still fires.
      "io_pressure_high",
      "cpu_iowait_high",
      "disk_fill_projection",
    ],
  },
};

// Profile ids the API accepts (in addition to null, which clears the profile).
export const HOST_PROFILE_IDS = Object.keys(HOST_PROFILES);

// Rules suppressed for a given profile value. Unknown or empty -> none, so an
// unrecognized or absent profile is simply a no-op (today's behavior).
export function profileSuppressedRules(profile: string | null | undefined): string[] {
  if (!profile) return [];
  return HOST_PROFILES[profile]?.suppressed_rules ?? [];
}

// Server tags that mark a rented / marketplace box (Vast.ai and similar),
// where the marketplace_gpu profile's suppressions apply. Lower-cased.
const MARKETPLACE_TAG_HINTS = ["vast", "marketplace", "runpod", "tensordock"];

// Suggest a host profile for a server that has none set, from cheap signals
// (today: its tags). Returns marketplace_gpu when the server is tagged as a
// marketplace box and has no profile yet, else null. Drives the detail-page
// nudge that closes the round-2 gap where the profile shipped but was never
// assigned to any host. Conservative: never overrides an existing profile.
export function suggestMarketplaceProfile(
  tags: string[] | null | undefined,
  currentProfile: string | null | undefined,
): string | null {
  if (currentProfile) return null;
  if (!Array.isArray(tags)) return null;
  const isMarketplace = tags.some((t) =>
    MARKETPLACE_TAG_HINTS.includes(String(t).toLowerCase().trim()),
  );
  return isMarketplace ? "marketplace_gpu" : null;
}
