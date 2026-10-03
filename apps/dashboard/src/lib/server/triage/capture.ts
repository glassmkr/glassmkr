// Capture commands for paste triage: the exact, read-only commands a person
// runs on the server to produce output the triage parsers can read. Used by
// the get_capture_command tool and by analyze.ts when it tells the user what
// to run next.
//
// Every command here is something the parsers were written against
// (smartctl -j -a, zpool status -v, /proc/mdstat plus mdadm --detail,
// dmesg -T / journalctl -k, ipmitool sel elist plus sel info, nvidia-smi -q
// and nvidia-smi nvlink --status). None of them changes state on the host.

import { z } from "zod";

export const CAPTURE_GOALS = [
  "all_disks",
  "one_disk",
  "nvme",
  "raid_md",
  "zfs",
  "kernel_errors",
  "gpu",
  "nvlink",
  "bmc_events",
] as const;

export type CaptureGoal = (typeof CAPTURE_GOALS)[number];

/** Package family, from an /etc/os-release ID. Only families install.sh knows. */
export type DistroFamily = "apt" | "dnf" | "other" | "unspecified";

// Named in apps/site/static/install.sh ("apt (Debian/Ubuntu) and dnf/yum (RHEL,
// Rocky, AlmaLinux, CentOS, Fedora)"). Proxmox VE is Debian with apt-get, which
// is what install.sh actually detects. Anything else is "other": no claim is
// made about its package manager.
const APT_IDS = new Set(["debian", "ubuntu", "proxmox", "pve"]);
const DNF_IDS = new Set(["rhel", "rocky", "almalinux", "centos", "fedora"]);

/**
 * The leading word of a distro hint, lowercased: "Ubuntu 24.04" and
 * "ubuntu-24.04" read as ubuntu, "rhel9" as rhel, "Debian GNU/Linux 12" as
 * debian, "Red Hat Enterprise Linux 9" as rhel. The hint is optional and a
 * model fills it with whatever the user said; a strict pattern made a value
 * like "Ubuntu 24.04" fail the whole call, paste analysis included (R1-23).
 * Empty or null means unspecified.
 */
export function normalizeDistroHint(raw: string | null | undefined): string | undefined {
  const text = (raw ?? "").trim().toLowerCase();
  if (/^red\s*hat\b/.test(text)) return "rhel";
  return /^[a-z]+/.exec(text)?.[0] || undefined;
}

export function distroFamily(distro?: string | null): DistroFamily {
  const id = (distro ?? "").trim().toLowerCase();
  if (!id) return "unspecified";
  if (APT_IDS.has(id)) return "apt";
  if (DNF_IDS.has(id)) return "dnf";
  return "other";
}

interface CaptureStep {
  command: string;
  purpose: string;
  needs_root: boolean;
}

type ToolPackage = "smartmontools" | "mdadm" | "ipmitool";

interface GoalSpec {
  summary: string;
  /** One line for analyze.ts next_capture: why this capture helps. */
  why: string;
  steps: CaptureStep[];
  /** Package that provides the command, for the install hint. null = none applies. */
  pkg: ToolPackage | null;
  pasteNote: string;
}

// Physical disks only: lsblk -e 1,7,11 drops ram, loop and optical devices (the
// same filter the smart_failing quick check uses), and TYPE=disk drops md, dm
// and partitions, which smartctl cannot read and which would only add noise.
const DISK_LOOP = `for d in $(lsblk -dno NAME,TYPE -e 1,7,11 | awk '$2=="disk"{print $1}'); do sudo smartctl -j -a /dev/$d; done`;

const GOALS: Record<CaptureGoal, GoalSpec> = {
  all_disks: {
    summary: "SMART health for every physical disk on the server.",
    why: "SMART health, reallocated sectors and NVMe health logs for every disk.",
    steps: [
      {
        command: DISK_LOOP,
        purpose: "SMART health, attributes, error counters and self-test log for every physical disk, as JSON.",
        needs_root: true,
      },
    ],
    pkg: "smartmontools",
    pasteNote: "If smartctl rejects -j (smartmontools older than 7.0), run the same command without -j and paste that text instead.",
  },
  one_disk: {
    summary: "SMART health for a single disk.",
    why: "SMART health and error counters for the disk in question.",
    steps: [
      {
        command: "sudo smartctl -j -a /dev/sdX",
        purpose: "SMART health, attributes and self-test log for one disk. Replace sdX with the disk name, for example sda or nvme0n1.",
        needs_root: true,
      },
    ],
    pkg: "smartmontools",
    pasteNote: "lsblk -d -o NAME,MODEL,SERIAL lists disk names next to their serial numbers if you need to find the right one. If smartctl rejects -j, run it without -j.",
  },
  nvme: {
    summary: "NVMe health logs for every NVMe drive.",
    why: "NVMe critical warning, spare capacity, wear and media errors.",
    steps: [
      {
        // lsblk rather than a /dev/nvme* glob: an unmatched glob aborts the
        // whole loop under zsh ("no matches found").
        command: `for d in $(lsblk -dno NAME,TRAN -e 1,7,11 | awk '$2=="nvme"{print $1}'); do sudo smartctl -j -a /dev/$d; done`,
        purpose: "NVMe health log (critical warning byte, available spare, percentage used, media errors) for every NVMe drive, as JSON.",
        needs_root: true,
      },
    ],
    pkg: "smartmontools",
    pasteNote: "If smartctl rejects -j, run the same command without -j.",
  },
  raid_md: {
    summary: "Linux software RAID (md) state and member detail.",
    why: "mdadm --detail names each member and its state, which /proc/mdstat alone abbreviates.",
    steps: [
      {
        command: "cat /proc/mdstat",
        purpose: "Every md array with its member list and the [UU] / [U_] health map.",
        needs_root: false,
      },
      {
        command: "for md in $(awk '/^md/{print $1}' /proc/mdstat); do sudo mdadm --detail /dev/$md; done",
        purpose: "Per-array state and the role and state of every member device.",
        needs_root: true,
      },
    ],
    pkg: "mdadm",
    pasteNote: "Paste both outputs together.",
  },
  zfs: {
    summary: "ZFS pool state, vdev tree and scrub result.",
    why: "Pool and vdev state, error counters and the last scrub result.",
    steps: [
      {
        command: "sudo zpool status -v",
        purpose: "State of every pool and vdev, read/write/checksum error counters, the last scrub line and any files with permanent errors.",
        needs_root: true,
      },
    ],
    pkg: null,
    pasteNote: "Paste the whole output, including the scan line and the errors line.",
  },
  kernel_errors: {
    summary: "Kernel log: disk I/O errors, NVMe resets, ext4 read-only remounts, GPU Xid events, memory errors reported by EDAC.",
    why: "Kernel I/O errors, NVMe resets, ext4 read-only remounts and GPU Xid events corroborate a hardware finding.",
    steps: [
      {
        // No --level filter. The lines the rules read are logged at several
        // levels: SCSI sense data at info, an ext4 read-only remount at crit,
        // an EDAC uncorrected error at emerg. `--level=err,warn` dropped all
        // three, so the paste could never show them.
        command: "sudo dmesg -T",
        purpose: "The kernel log of the current boot, with wall-clock times. Hardware errors are logged at several levels, so it is not filtered by level.",
        needs_root: true,
      },
      {
        // short-iso: the default journalctl format prints no year, so every
        // event in the previous boot's log came back undated (R1-21).
        command: "sudo journalctl -k -b -1 --no-pager -o short-iso",
        purpose: "The kernel log of the previous boot, with full dates, for events that led up to a crash or reboot. Needs a persistent journal; it prints nothing useful without one.",
        needs_root: true,
      },
    ],
    pkg: null,
    pasteNote: "If the output is very long, paste the part around the affected device or the time of the incident.",
  },
  gpu: {
    summary: "Full NVIDIA GPU state.",
    why: "Per-GPU ECC counters, retired pages, PCIe link, temperature and throttle reasons.",
    steps: [
      {
        command: "nvidia-smi -q",
        purpose: "Per-GPU ECC counters, retired or remapped pages, PCIe link generation and width, temperatures and throttle reasons.",
        needs_root: false,
      },
    ],
    pkg: null,
    pasteNote: "nvidia-smi ships with the NVIDIA driver. If it fails to talk to the driver, paste that error too.",
  },
  nvlink: {
    summary: "NVLink link state for every GPU.",
    why: "Per-link NVLink state, to see whether any link is down.",
    steps: [
      {
        command: "nvidia-smi nvlink --status",
        purpose: "State and speed of every NVLink on every GPU.",
        needs_root: false,
      },
    ],
    pkg: null,
    pasteNote: "Paste the output for all GPUs.",
  },
  bmc_events: {
    summary: "The BMC System Event Log (SEL) and how full it is.",
    why: "The BMC event log records DIMM, PSU, fan and thermal faults, and sel info shows whether the log is full.",
    steps: [
      {
        command: "sudo ipmitool sel elist",
        purpose: "Every event in the BMC System Event Log, with sensor names and asserted or deasserted state.",
        needs_root: true,
      },
      {
        command: "sudo ipmitool sel info",
        purpose: "How full the event log is; a full log stops recording new hardware faults.",
        needs_root: true,
      },
    ],
    pkg: "ipmitool",
    pasteNote: "Paste both outputs together.",
  },
};

// Serials tell drives apart in output that names no device (smartctl text
// without a prompt per disk), and nvidia-smi UUIDs tie a GPU's sections
// together. One placeholder for every serial merged a failing drive into a
// healthy one (R1-11), so each gets its own.
const PASTE_BASE =
  "Paste the complete output back into this conversation as printed. To hide serial numbers or hostnames, replace each one with a different placeholder (DISK1, DISK2, ...); keep device names, GPU UUIDs and the table layout unchanged.";

function installHint(
  pkg: ToolPackage | null,
  family: DistroFamily,
): { package: string; command: string | null; purpose: string } | null {
  if (!pkg) return null;
  const binary = pkg === "smartmontools" ? "smartctl" : pkg;
  const purpose = `Only needed if ${binary} is not installed.`;
  if (family === "apt") return { package: pkg, command: `sudo apt-get install -y ${pkg}`, purpose };
  if (family === "dnf") return { package: pkg, command: `sudo dnf install -y ${pkg}`, purpose };
  return {
    package: pkg,
    command: null,
    purpose: `${purpose} Install the ${pkg} package with your distribution's package manager.`,
  };
}

export const captureOutputShape = {
  goal: z.enum(CAPTURE_GOALS),
  summary: z.string(),
  commands: z.array(
    z.object({
      command: z.string(),
      purpose: z.string(),
      needs_root: z.boolean(),
    }).strict(),
  ),
  install_hint: z.object({
    package: z.string(),
    command: z.string().nullable(),
    purpose: z.string(),
  }).strict().nullable(),
  paste_instructions: z.string(),
};

export const captureOutputSchema = z.object(captureOutputShape).strict();
export type CaptureResult = z.infer<typeof captureOutputSchema>;

/** The commands to run for one goal, with a distro-specific install hint. */
export function captureCommands(goal: CaptureGoal, distro?: string | null): CaptureResult {
  const spec = GOALS[goal];
  return {
    goal,
    summary: spec.summary,
    commands: spec.steps.map((s) => ({ ...s })),
    install_hint: installHint(spec.pkg, distroFamily(distro)),
    paste_instructions: `${PASTE_BASE} ${spec.pasteNote}`,
  };
}

/** All of a goal's commands as one copyable block, for analyze.ts next_capture. */
export function captureCommandText(goal: CaptureGoal): string {
  return GOALS[goal].steps.map((s) => s.command).join("\n");
}

/** Why a goal's capture helps, for analyze.ts next_capture. */
export function captureWhy(goal: CaptureGoal): string {
  return GOALS[goal].why;
}

/**
 * Plain-text rendering for the tool result's content block. Every field is in
 * it: clients that forward only content lost each command's purpose and the
 * paste instructions, which carry the distinct-placeholder rule (R2-15).
 * Purposes are shell comments, so the block still pastes into a shell.
 */
export function renderCaptureText(result: CaptureResult): string {
  const lines = [`${result.summary} Run on the server, then paste the output back:`];
  const hint = result.install_hint;
  if (hint) {
    lines.push(`# ${hint.purpose}`);
    if (hint.command) lines.push(hint.command);
  }
  for (const c of result.commands) {
    lines.push(`# ${c.purpose}`);
    lines.push(c.command);
  }
  lines.push("", result.paste_instructions);
  return lines.join("\n");
}
