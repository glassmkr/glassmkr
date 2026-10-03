import { describe, expect, it } from "vitest";
import {
  CAPTURE_GOALS,
  captureCommandText,
  captureCommands,
  captureOutputSchema,
  distroFamily,
  renderCaptureText,
} from "../capture.js";

// Product copy rules that apply to every tool output.
const COMMERCIAL = /\b(price|pricing|free|trial|plans?|tier|upgrade|discount|subscription|billing)\b|node[- ]cap|10[- ]node/i;

describe("captureCommands", () => {
  it.each(CAPTURE_GOALS)("%s returns schema-valid, non-empty commands", (goal) => {
    const result = captureCommands(goal);
    expect(captureOutputSchema.safeParse(result).success).toBe(true);
    expect(result.goal).toBe(goal);
    expect(result.commands.length).toBeGreaterThan(0);
    const all = JSON.stringify(result) + renderCaptureText(result);
    expect(all).not.toContain("\u2014");
    expect(all).not.toMatch(COMMERCIAL);
  });

  it("uses the commands the parsers were written against", () => {
    const text = (goal: (typeof CAPTURE_GOALS)[number]) => captureCommands(goal).commands.map((c) => c.command).join("\n");
    expect(text("all_disks")).toContain("sudo smartctl -j -a /dev/$d");
    expect(text("all_disks")).toContain("lsblk -dno NAME,TYPE -e 1,7,11");
    expect(text("one_disk")).toBe("sudo smartctl -j -a /dev/sdX");
    expect(text("nvme")).toBe(`for d in $(lsblk -dno NAME,TRAN -e 1,7,11 | awk '$2=="nvme"{print $1}'); do sudo smartctl -j -a /dev/$d; done`);
    // No bare /dev globs: under zsh an unmatched glob aborts the whole loop.
    for (const goal of CAPTURE_GOALS) expect(captureCommandText(goal)).not.toMatch(/\/dev\/[a-z]+\[/);
    expect(text("raid_md")).toBe("cat /proc/mdstat\nfor md in $(awk '/^md/{print $1}' /proc/mdstat); do sudo mdadm --detail /dev/$md; done");
    expect(text("zfs")).toBe("sudo zpool status -v");
    expect(text("kernel_errors")).toBe("sudo dmesg -T\nsudo journalctl -k -b -1 --no-pager -o short-iso");
    // A level filter drops what the rules read: SCSI sense (info), ext4
    // read-only remount (crit), EDAC uncorrected (emerg).
    expect(text("kernel_errors")).not.toContain("--level");
    expect(text("gpu")).toBe("nvidia-smi -q");
    expect(text("nvlink")).toBe("nvidia-smi nvlink --status");
    expect(text("bmc_events")).toBe("sudo ipmitool sel elist\nsudo ipmitool sel info");
  });

  it("never suggests a command that changes state", () => {
    for (const goal of CAPTURE_GOALS) {
      const cmds = captureCommandText(goal);
      expect(cmds).not.toMatch(/\b(clear|--add|--remove|--fail|replace|online|offline|-t short|-t long|scrub|reset)\b/);
    }
  });

  it("marks root-only commands", () => {
    expect(captureCommands("gpu").commands[0].needs_root).toBe(false);
    expect(captureCommands("bmc_events").commands.every((c) => c.needs_root)).toBe(true);
    expect(captureCommands("raid_md").commands.map((c) => c.needs_root)).toEqual([false, true]);
  });

  it("gives a distro-specific install hint only for families install.sh knows", () => {
    expect(captureCommands("all_disks", "ubuntu").install_hint).toEqual(
      expect.objectContaining({ package: "smartmontools", command: "sudo apt-get install -y smartmontools" }),
    );
    expect(captureCommands("bmc_events", "rocky").install_hint?.command).toBe("sudo dnf install -y ipmitool");
    expect(captureCommands("raid_md", "almalinux").install_hint?.command).toBe("sudo dnf install -y mdadm");
    const arch = captureCommands("all_disks", "arch").install_hint;
    expect(arch?.command).toBeNull();
    expect(arch?.purpose).toContain("smartmontools");
    expect(captureCommands("zfs", "ubuntu").install_hint).toBeNull();
    expect(captureCommands("gpu", "debian").install_hint).toBeNull();
  });

  it("asks for the paste unchanged", () => {
    expect(captureCommands("zfs").paste_instructions).toContain("Paste the complete output back");
  });

  it("asks for a different placeholder per redacted serial, never one shared placeholder (R1-11)", () => {
    const text = captureCommands("all_disks").paste_instructions;
    expect(text).toContain("replace each one with a different placeholder");
    expect(text).toContain("GPU UUIDs");
    expect(text).not.toMatch(/may be replaced with placeholders/);
  });
});

describe("distroFamily", () => {
  it("maps os-release IDs to the package families install.sh supports", () => {
    expect(distroFamily("debian")).toBe("apt");
    expect(distroFamily("Ubuntu")).toBe("apt");
    expect(distroFamily("proxmox")).toBe("apt");
    expect(distroFamily("rhel")).toBe("dnf");
    expect(distroFamily("fedora")).toBe("dnf");
    expect(distroFamily("alpine")).toBe("other");
    expect(distroFamily("")).toBe("unspecified");
    expect(distroFamily(undefined)).toBe("unspecified");
  });
});
