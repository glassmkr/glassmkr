// The read-only RAID membership step in smart_failing and nvme_wear_high,
// run as written against captured lsblk output. It read the array from the
// raid row's PKNAME, which is that row's tree parent: the member, not the
// array. On a host where sda1 is in md0 it printed "device is a member of
// /dev/sda1", and the guarded mdadm commands below it would have named a
// partition as the array (R6-8). nvme_wear_high's member line ran lsblk in
// tree mode and captured the tree glyph.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getRuleMetadata } from "../loader";

// util-linux 2.40 output for a partition member (sda1 in md0) and a
// whole-disk member (sdb in md1). The tree-mode (-no) samples are what the
// old derivation read.
const SAMPLES: Record<string, { list: string; tree: string; want: string }> = {
  sda: {
    list: "sda           disk\nsda1  sda     part\nmd0   sda1    raid1\n",
    tree: "      disk\nsda   part\nsda1  raid1\n",
    want: "/dev/md0|/dev/sda1",
  },
  sdb: {
    list: "sdb           disk\nmd1   sdb     raid1\n",
    tree: "      disk\nsdb   raid1\n",
    want: "/dev/md1|/dev/sdb",
  },
  sdc: { list: "sdc           disk\nsdc1  sdc     part\n", tree: "      disk\nsdc   part\n", want: "|" },
};

const dir = mkdtempSync(join(tmpdir(), "raid-membership-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in lsblk that prints the captured sample for the device it is given.
const fake = join(dir, "lsblk");
writeFileSync(
  fake,
  [
    "#!/bin/sh",
    'mode=tree; dev=""',
    'for a in "$@"; do case "$a" in -l*) mode=list ;; /dev/*) dev="${a#/dev/}" ;; esac; done',
    'cat "$(dirname "$0")/$dev.$mode" 2>/dev/null',
  ].join("\n") + "\n",
);
chmodSync(fake, 0o755);
for (const [dev, s] of Object.entries(SAMPLES)) {
  writeFileSync(join(dir, `${dev}.list`), s.list);
  writeFileSync(join(dir, `${dev}.tree`), s.tree);
}

/** The variant's ARRAY= and MEMBER= lines, run for one device; "ARRAY|MEMBER". */
function derive(rule: string, device: string): string {
  const variant = getRuleMetadata(rule)!.fix.variants.find((v) => v.distro_match.includes("*") && v.vendor_match.includes("*"))!;
  const lines = variant.command.split("\n").filter((l) => /^(?:ARRAY|MEMBER)=\$\(lsblk /.test(l));
  expect(lines.length, rule).toBeGreaterThan(0);
  const script = [...lines, 'printf "%s|%s" "$ARRAY" "$MEMBER"']
    .join("\n")
    .split("{{device}}").join(`/dev/${device}`)
    .split("${DEVICE}").join(device);
  return execFileSync("sh", ["-c", script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
}

describe("RAID membership derivation (R6-8)", () => {
  for (const rule of ["smart_failing", "nvme_wear_high"]) {
    for (const [device, s] of Object.entries(SAMPLES)) {
      it(`${rule}: ${device} -> ${s.want}`, () => {
        expect(derive(rule, device)).toBe(s.want);
      });
    }

    it(`${rule}: the guarded mdadm commands name the derived member, not the whole device`, () => {
      const variant = getRuleMetadata(rule)!.fix.variants.find((v) => v.distro_match.includes("*") && v.vendor_match.includes("*"))!;
      const mdadm = variant.command.split("\n").filter((l) => /mdadm --manage/.test(l));
      expect(mdadm.length).toBeGreaterThan(0);
      for (const line of mdadm) expect(line).toMatch(/--manage "\$ARRAY" --(?:fail|remove|add) "\$MEMBER"/);
    });
  }
});
