// Kernel log parser for paste triage: dmesg (relative "[ 8823.112233]",
// `dmesg -T` ctime, `dmesg --time-format iso`), `journalctl -k` / journalctl
// short formats, and /var/log/kern.log or syslog lines.
//
// It recognises exactly the kernel events the evaluator has rules for:
//   - SCSI sense keys, NVMe timeout / controller reset, EXT4 remount
//     read-only               -> snap.dmesg_events    (disk_io_errors, filesystem_readonly)
//   - kernel "I/O error" lines -> snap.io_errors       (disk_io_errors legacy path)
//   - NVIDIA "NVRM: Xid"      -> snap.gpu.tier1.xid_events (gpu_xid_critical)
//   - EDAC "N CE / N UE" lines -> snap.ecc_edac        (ecc_errors, mce_uncorrected)
//
// Differences from the live agent, all deliberate:
//   - No time window. Crucible keeps the last hour (dmesg events) or 24 h
//     (Xid) against Date.now(); a paste is judged on everything in it.
//   - A timestamp the paste does not carry is never invented. Relative
//     ("[ 8823.112233]") and year-less ("Oct 03 10:00:00") times become ""
//     (no rule compares these fields with the clock; they are evidence
//     only), times without a zone are kept as printed local time, and only
//     ISO times with an offset are converted to UTC.
//   - raw_line / raw_message stay "": no rule needs them to fire, and the
//     raw text is exactly where an injected sentence would ride along.
//   - Lines a journal or syslog prefix attributes to a process other than
//     the kernel are not counted, so a userspace log line that imitates a
//     kernel message cannot raise a finding. Hostnames are never copied.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent, safeLabel } from "../sanitize";
import type { ParseNote, ParserResult, TriageFormat, TriageParser } from "../types";

type DmesgEventsSlice = NonNullable<Snapshot["dmesg_events"]>;
type DmesgEvent = DmesgEventsSlice["events"][number];
type GpuSlice = NonNullable<Snapshot["gpu"]>;
type Tier1Available = Extract<NonNullable<GpuSlice["tier1"]>, { available: true }>;
type XidEvent = Tier1Available["xid_events"][number];
type EdacDimm = NonNullable<Snapshot["ecc_edac"]>["dimms"][number];

// printk caps one record near 1 KiB; anything far longer is not a kernel
// line, and capping keeps every regex below linear on hostile input.
const MAX_LINE = 2048;

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const DOW = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";

// `dmesg -T`: "[Fri Oct  3 10:00:00 2026] msg"
const CTIME_RE = new RegExp(`^\\[${DOW} ${MON} +(\\d{1,2}) (\\d{2}:\\d{2}:\\d{2}) (\\d{4})\\]\\s?(.*)$`);
// plain dmesg and `journalctl -o short-monotonic`: "[ 8823.112233] msg"
const RELATIVE_RE = /^\[\s*(\d{1,10}\.\d{1,9})\]\s?(.*)$/;
// `dmesg -H` / `--reltime` / `-e`: "[Oct 4 06:51] msg" on the first line of a
// minute (strftime "%b%e %H:%M", so "[Oct14 06:51]" for days 10 to 31), then
// "[  +0.000012] msg" or "[ +12.345678] msg" deltas. Neither dates an event.
// Left in the message, the prefix hid the anchored 6.x NVMe media-error lines
// and the paste was not recognised (R2-7).
const RELTIME_RE = new RegExp(`^\\[(?:${MON} {0,2}\\d{1,2} \\d{2}:\\d{2}|\\s{0,8}[+-]\\d{1,10}\\.\\d{1,9})\\]\\s?(.*)$`);
// `grep -H` (or grep over several files) puts the file name first:
// "/var/log/kern.log:Oct  4 06:51:00 host kernel: msg".
const GREP_FILE_RE = /^\/[A-Za-z0-9_.\/-]{1,256}:(?=\S)/;
// `dmesg --time-format iso` (comma fraction), journalctl short-iso, rsyslog RFC 3339
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([,.]\d{1,9})?(Z|[+-]\d{2}:?\d{2})?\s+(.*)$/;
// journalctl short / short-precise ("Oct 03") and RFC 3164 syslog ("Oct  3")
const BSD_RE = new RegExp(`^${MON} ( ?\\d{1,2}) (\\d{2}:\\d{2}:\\d{2})(?:\\.\\d{1,9})?\\s+(.*)$`);
// journalctl short-full: "Fri 2026-10-03 10:00:00 CEST host kernel: msg"
const FULL_RE = new RegExp(`^${DOW} (\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d{1,9})? [A-Za-z][A-Za-z0-9+-]{0,9}\\s+(.*)$`);
// "host ident[pid]: msg" after a journal / syslog timestamp
const HOST_IDENT_RE = /^(\S+)\s+([^\s:[\]]+)(?:\[\d+\])?:\s?(.*)$/;
// rsyslog keeps the kernel's own relative stamp after "kernel: "
const EMBEDDED_STAMP_RE = /^\[\s*\d{1,10}\.\d{1,9}\]\s?/;
// `dmesg -r` ("<3>") and `dmesg -x` ("kern  :err   : ") prefixes
const LEVEL_PREFIX_RE =
  /^(?:<\d{1,3}>|(?:kern|user|mail|daemon|auth|syslog|lpr|news|uucp|cron|authpriv|ftp|local[0-7])\s*:\s*(?:emerg|alert|crit|err|warn|notice|info|debug)\s*:\s?)/;
// Shell prompt lines pasted along with the output: "root@host:~# dmesg -T",
// "[root@host ~]# journalctl -k", "$ dmesg". They can contain "I/O error"
// (a grep pattern) and must not count as a kernel line. The user part of the
// bracketed form excludes '@': with it, every '@' on a line was a split point
// and "[" followed by 2047 '@' cost 3 ms a line, 400 ms a paste, on every
// paste's detect() (R2-1).
const PROMPT_RE = /^(?:\[[^\]@]*@[^\]]*\]\s*[#$]|[\w.-]+@[\w.-]+(?::\S*)?\s*[#$%]|[#$])(?:\s|$)/;

interface KernelLine {
  /** null when the line carries no recognised prefix (dmesg -t, grep output). */
  format: TriageFormat | null;
  /** Normalised event time, "" when the paste does not carry one. */
  time: string;
  timeKind: "absolute" | "local" | "unknown";
  /** Timestamp exactly as printed, used only as a dedup key and never stored. */
  stampKey: string | null;
  /** false when a journal / syslog prefix names a process other than the kernel. */
  fromKernel: boolean;
  message: string;
}

function pad2(n: string): string {
  return n.trim().padStart(2, "0");
}

function validDateTime(y: string, mo: string, d: string, h: string, mi: string, s: string): boolean {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  return (
    year >= 1970 && year <= 2100 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= 31 &&
    Number(h) <= 23 && Number(mi) <= 59 && Number(s) <= 60
  );
}

interface JournalSplit {
  /** "unknown": no "host ident:" after the timestamp, so not a journal / syslog line. */
  origin: "kernel" | "other" | "unknown";
  message: string;
  embeddedStamp: boolean;
}

/** Resolve "host ident[pid]: msg" after a journal / syslog timestamp. */
function splitJournal(rest: string): JournalSplit {
  const m = rest.match(HOST_IDENT_RE);
  if (!m) return { origin: "unknown", message: rest, embeddedStamp: false };
  if (m[2] !== "kernel") return { origin: "other", message: m[3], embeddedStamp: false };
  const embeddedStamp = EMBEDDED_STAMP_RE.test(m[3]);
  return { origin: "kernel", message: m[3].replace(EMBEDDED_STAMP_RE, ""), embeddedStamp };
}

/**
 * A timestamped line that is not "host ident: msg" (an application log, a
 * hand-trimmed excerpt) is not claimed as a journal or syslog format; its
 * text is still checked for kernel events like an un-prefixed line.
 */
function journalLine(
  j: JournalSplit,
  format: TriageFormat,
  time: string,
  timeKind: KernelLine["timeKind"],
  stampKey: string,
): KernelLine {
  if (j.origin === "unknown") return { format: null, time, timeKind, stampKey, fromKernel: true, message: j.message };
  return { format, time, timeKind, stampKey, fromKernel: j.origin === "kernel", message: j.message };
}

function classify(rawLine: string): KernelLine {
  const line = rawLine.replace(GREP_FILE_RE, "").replace(LEVEL_PREFIX_RE, "");

  const ct = line.match(CTIME_RE);
  if (ct) {
    const [, mon, day, time, year, rest] = ct;
    const [h, mi, s] = time.split(":");
    const ok = validDateTime(year, MONTHS[mon], day, h, mi, s);
    return {
      format: "dmesg",
      time: ok ? `${year}-${MONTHS[mon]}-${pad2(day)}T${time}` : "",
      timeKind: ok ? "local" : "unknown",
      stampKey: `ctime:${mon} ${day.trim()} ${time} ${year}`,
      fromKernel: true,
      message: rest,
    };
  }

  const rel = line.match(RELATIVE_RE);
  if (rel) {
    const [, secs, rest] = rel;
    const base = { time: "", timeKind: "unknown" as const, stampKey: `rel:${secs}` };
    // `journalctl -k -o short-monotonic` puts "host kernel:" after the stamp;
    // plain dmesg puts the message there ("nvme nvme0: ..."), so only an
    // ident of exactly "kernel" marks the journal form.
    const j = rest.match(HOST_IDENT_RE);
    if (j && j[2] === "kernel") {
      return { ...base, format: "journalctl_kernel", fromKernel: true, message: j[3] };
    }
    return { ...base, format: "dmesg", fromKernel: true, message: rest };
  }

  const reltime = line.match(RELTIME_RE);
  if (reltime) {
    // A delta repeats across lines, so it is no dedup key: such a line counts.
    return { format: "dmesg", time: "", timeKind: "unknown", stampKey: null, fromKernel: true, message: reltime[2] };
  }

  const iso = line.match(ISO_RE);
  if (iso) {
    const [, y, mo, d, h, mi, s, frac, zone, rest] = iso;
    const fraction = frac ? frac.replace(",", ".") : "";
    const stampKey = `iso:${y}-${mo}-${d}T${h}:${mi}:${s}${frac ?? ""}${zone ?? ""}`;
    let time = "";
    let timeKind: KernelLine["timeKind"] = "unknown";
    if (validDateTime(y, mo, d, h, mi, s)) {
      if (zone) {
        const offset = zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
        const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${fraction}${offset}`);
        if (Number.isFinite(t)) {
          time = new Date(t).toISOString();
          timeKind = "absolute";
        }
      } else {
        // No offset in the paste: keep the wall-clock time as printed rather
        // than guess a zone.
        time = `${y}-${mo}-${d}T${h}:${mi}:${s}${fraction}`;
        timeKind = "local";
      }
    }
    // `dmesg --time-format iso` always prints a comma fraction and no host.
    if (frac?.startsWith(",")) {
      return { format: "dmesg", time, timeKind, stampKey, fromKernel: true, message: rest };
    }
    const j = splitJournal(rest);
    // rsyslog's RFC 3339 template prints a dot fraction and a colon offset;
    // journalctl short-iso prints "+0200". Only the format label depends on it.
    const rsyslog = j.embeddedStamp || (frac?.startsWith(".") === true && /:\d{2}$/.test(zone ?? ""));
    return journalLine(j, rsyslog ? "syslog_kernel" : "journalctl_kernel", time, timeKind, stampKey);
  }

  const full = line.match(FULL_RE);
  if (full) {
    const [, y, mo, d, h, mi, s, rest] = full;
    const ok = validDateTime(y, mo, d, h, mi, s);
    // The zone is an abbreviation ("CEST"), which is ambiguous; keep local time.
    return journalLine(
      splitJournal(rest),
      "journalctl_kernel",
      ok ? `${y}-${mo}-${d}T${h}:${mi}:${s}` : "",
      ok ? "local" : "unknown",
      `full:${y}-${mo}-${d}T${h}:${mi}:${s}`,
    );
  }

  const bsd = line.match(BSD_RE);
  if (bsd) {
    const [, mon, day, time, rest] = bsd;
    const j = splitJournal(rest);
    // journalctl zero-pads the day ("Oct 03"); RFC 3164 syslog space-pads it.
    // Days 10 to 31 print the same in both, so only the label can be off.
    const syslog = j.embeddedStamp || !/^\d{2}$/.test(day);
    // No year in this format, so the event cannot be dated.
    return journalLine(j, syslog ? "syslog_kernel" : "journalctl_kernel", "", "unknown", `bsd:${mon} ${day.trim()} ${time}`);
  }

  return { format: null, time: "", timeKind: "unknown", stampKey: null, fromKernel: true, message: line };
}

// ---------------------------------------------------------------------------
// Event matchers
// ---------------------------------------------------------------------------

// Sense key names as the kernel prints them (drivers/scsi/constants.c,
// snstext[]), indexed by key value for kernels built without
// CONFIG_SCSI_CONSTANTS, which print "Sense Key : 0x3".
const SENSE_KEYS = [
  "No Sense", "Recovered Error", "Not Ready", "Medium Error",
  "Hardware Error", "Illegal Request", "Unit Attention", "Data Protect",
  "Blank Check", "Vendor Specific", "Copy Aborted", "Aborted Command",
  "Equal", "Volume Overflow", "Miscompare", "Completed",
] as const;
const MAJOR_SENSE_KEYS = new Set(["Medium Error", "Hardware Error", "Aborted Command"]);

// Ported from Crucible src/collect/dmesg-events.ts SCSI_SENSE_HANDLER, widened
// for the "tag#N" token and trailing "[descriptor]" modern kernels print.
const SCSI_SENSE_RE = /\bsd \d+:\d+:\d+:\d+:\s+\[([A-Za-z0-9]{1,32})\]\s+(?:tag#\d+\s+)?Sense Key\s*:\s*(.*)$/;
// Not errors: "No Sense" and "Completed" report success, and the kernel prints
// them only alongside another status.
const NON_ERROR_SENSE_KEYS = new Set(["No Sense", "Completed"]);
// The kernel follows a sense key line with "Add. Sense:" and "CDB:" lines for
// the same disk (scsi_print_sense, scsi_print_command).
const SCSI_DETAIL_RE = /\bsd \d+:\d+:\d+:\d+:\s+\[([A-Za-z0-9]{1,32})\]\s+(?:tag#\d+\s+)?(Add\. Sense|CDB):\s*(.{0,160})/;
const SCSI_DISABLE_RE = /\bsd \d+:\d+:\d+:\d+:\s+\[([A-Za-z0-9]{1,32})\]\s+.{0,80}\bdisabling (?:write same|discard)\b/i;
/** How many lines after a sense key line to read its Add. Sense and CDB from. */
const SENSE_DETAIL_LINES = 4;

function senseKeyOf(text: string): string | null {
  const hex = text.match(/^0x([0-9a-fA-F])\b/);
  if (hex) return SENSE_KEYS[Number.parseInt(hex[1], 16)];
  // Only a known key is taken, never the rest of the line.
  for (const key of SENSE_KEYS) {
    if (text.startsWith(key) && !/^[A-Za-z0-9]/.test(text.slice(key.length))) return key;
  }
  return null;
}

// NVMe controller faults the driver answered with a reset, abort or disable
// (drivers/nvme/host/pci.c, core.c). Crucible's handler matches any
// "timeout|reset|aborting|disabling" after "nvme nvmeN:", which also catches
// the benign boot line "Shutdown timeout set to 8 seconds" and the lost-IRQ
// "timeout, completion polled"; those are not controller resets.
// nvme_wait_ready prints "Device not ready; aborting %s" for initialisation,
// reset and (6.x) shutdown: a controller that never comes ready at boot is
// the classic dead drive, and Crucible flags it (R2-5). "Removing after probe
// failure" is the driver giving the controller up; when the device has
// dropped off the bus it is the only line printed, so it counts too, beyond
// what Crucible's keywords catch.
const NVME_RE = /\bnvme (nvme\d{1,4}):\s+(.*)$/;
const NVME_FAULT_RE =
  /\btimeout, (?:reset controller|aborting|disable controller)\b|\bcontroller is down; will reset\b|\breset(?:ting)? controller\b|\bDevice not ready; aborting (?:reset|initiali[sz]ation|shutdown)\b|\bDisabling device after reset failure\b|\bRemoving after probe failure status: -?\d{1,5}\b/i;
const NVME_PROBE_REMOVAL_RE = /\bRemoving after probe failure\b/i;

// Ported from Crucible src/collect/dmesg-events.ts EXT4_READONLY_HANDLER, with
// the device name limited to block-device characters.
const EXT4_RO_RE = /\bEXT4-fs \(([A-Za-z0-9._:+-]{1,64})\):\s+Remounting filesystem read-only/;

// Ported from Crucible src/collect/gpu.ts parseXidEvents.
const XID_RE = /\bNVRM: Xid \(PCI:([0-9A-Fa-f]{4,8}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}(?:\.[0-7])?)\):\s*(\d{1,4})\b/;
// Ported verbatim from Crucible src/collect/gpu.ts (origin/main, 154 added 2026-09-16).
const XID_CRITICAL = new Set([
  13, 31, 43, 45, 48, 56, 57, 58, 62, 63, 64,
  65, 66, 68, 69, 71, 72, 73, 74, 76, 78,
  79, // GPU has fallen off the bus
  92, 94, 95, 96, 100, 101, 110, 111, 119, 120,
  154, // "GPU Reset Required" recovery action
]);
const XID_WARNING = new Set([8, 14, 22, 25, 32, 38, 39, 42, 44, 46, 60, 67]);

// Ported from Crucible src/lib/privileged.ts "dmesg-io" grep and
// src/collect/io-errors.ts device extraction.
const IO_ERROR_RE = /I\/O error|blk_update_request.*error/i;
// Kernels from 5.19 print the block-layer error without the
// "blk_update_request:" prefix (blk_print_req_error), and an NVMe or SCSI
// media failure reads "critical medium error, dev nvme0n1, ...". Crucible's
// grep misses these lines too; only the statuses that mean the disk failed
// the request are taken (R1-18).
const BLOCK_ERROR_RE = /^(?:critical medium|critical target|device offline) error, dev [A-Za-z0-9_-]{1,32},/;
// The per-command NVMe line (CONFIG_NVME_VERBOSE_ERRORS) for a media error
// (status code type 0x2). Counted only for a device with no block-layer line,
// which reports the same failed command.
const NVME_MEDIA_RE = /^(nvme\d{1,4}n\d{1,4}): [A-Za-z ]{1,40}\(0x[0-9a-f]{1,2}\) @ LBA \d{1,20}, \d{1,10} blocks, [^()]{1,64} \(sct 0x2 \/ sc 0x[0-9a-f]{1,2}\)/;
// A drive or controller that does not support discard or write zeroes fails
// the kernel's probe for it once at setup. That says nothing about the media.
const PROBE_OP_RE = /\bop 0x[0-9a-f]{1,2}:\((?:DISCARD|WRITE_ZEROES|SECURE_ERASE)\)/;
const IO_DEV_RE = /\bdev\s+([A-Za-z0-9_-]{1,32})/;
const IO_ON_DEVICE_RE = /\bon device\s+([A-Za-z0-9_-]{1,32})/;
// Floppy (fd0 on most VMs), optical and loop devices are not disks, and
// network or virtual block devices (nbd, Ceph rbd, zram, ram, DRBD) have no
// local media: probing an unconnected /dev/nbdN logs I/O errors by design
// (R2-15). An I/O error on them says nothing about storage hardware. dm-N and
// md devices stay counted: their errors come with the member disk's.
const NON_DISK_RE = /^(?:fd|sr|loop|nbd|rbd|zram|ram|drbd)\d+(?:p\d+)?$/;
// Distinct device names kept for disk_io_errors, which joins each one against
// every SMART entry in the paste. The count stays exact (R2-11).
const MAX_IO_DEVICES = 256;

// EDAC core report (drivers/edac/edac_mc.c): "EDAC MC0: 1 CE <msg> on <label> (<location> ...)".
const EDAC_RE = /\bEDAC MC(\d{1,3}): (\d{1,9}) (CE|UE)\b(.*)$/;
// A label with spaces ("unknown memory", some SMBIOS strings) is left out
// rather than risk carrying free text into a title.
const EDAC_LABEL_RE = / on ([A-Za-z0-9_#.:/-]{1,64}) \(/;

// Hardware lines the kernel prints that no rule here reads (R2-2). They are
// only counted, never copied or decoded: the answer says they were seen and
// not evaluated, and the matching rule is not reported as "ran and found no
// matching signal" on a paste whose headline is a fatal machine check.
//   - x86 MCE (arch/x86/kernel/cpu/mce), the AMD decoder's "[Hardware
//     Error]:" lines, APEI/GHES "{N}[Hardware Error]:" records, and the
//     panic a fatal one causes. ecc_errors and mce_uncorrected read EDAC
//     "N CE / N UE" lines only.
const MCE_RE =
  /\bmce: (?:\[Hardware Error\]|Uncorrected hardware memory error\b)|^(?:\{\d{1,3}\})?\[Hardware Error\]:|\bnot syncing: (?:Fatal (?:local )?)?[Mm]achine check\b/;
//   - btrfs forcing itself read-only and XFS shutting a filesystem down.
//     filesystem_readonly reads the ext4 remount line only.
const FS_FAIL_RE =
  /\bBTRFS\b[^\n]{0,120}\bforced readonly\b|\bXFS \([^)\s]{1,64}\):[^\n]{0,200}\b(?:Shutting down filesystem|Filesystem has been shut down)\b/;
//   - a libata uncorrectable read. With the whole dmesg the SCSI sense and
//     block-layer lines that follow it feed disk_io_errors; a paste trimmed
//     to the ata lines has only this one.
const LIBATA_UNC_RE = /\bata\d{1,3}(?:\.\d{2})?: error: \{[^}]{0,80}\bUNC\b/;

// ---------------------------------------------------------------------------
// detect / parse
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function matchesUnevaluated(message: string): boolean {
  return MCE_RE.test(message) || FS_FAIL_RE.test(message) || LIBATA_UNC_RE.test(message);
}

// A line with no kernel prefix (dmesg -t, journalctl -o cat, a hand-trimmed
// excerpt) counts only when it starts the way the kernel prints an event a
// matcher below reads. Matched anywhere in the line, a pasted command
// ("dmesg | grep -i 'I/O error'"), a sentence about one, or a grep under a
// prompt no prompt pattern knows came back as a critical disk error (R2-3).
const BARE_KERNEL_LINE_RE =
  /^(?:(?:blk_update_request|print_req_error|end_request): |(?:I\/O|critical medium|critical target|device offline) error, dev |Buffer I\/O error on dev|lost page write due to I\/O error|(?:EXT[234]-fs|XFS|BTRFS|JBD2|F2FS-fs|FAT-fs)\b[^:]{0,80}: |sd \d{1,4}:\d{1,4}:\d{1,4}:\d{1,9}: |nvme nvme\d|nvme\d{1,4}n\d{1,4}: |NVRM: Xid |EDAC MC\d|mce: |(?:\{\d{1,3}\})?\[Hardware Error\]:|Kernel panic - not syncing: |ata\d{1,3}(?:\.\d{2})?: )/;

function kernelShaped(line: KernelLine): boolean {
  return line.format !== null || BARE_KERNEL_LINE_RE.test(line.message);
}

function matchesAnyEvent(message: string): boolean {
  return (
    SCSI_SENSE_RE.test(message) ||
    (NVME_RE.test(message) && NVME_FAULT_RE.test(message)) ||
    EXT4_RO_RE.test(message) ||
    XID_RE.test(message) ||
    IO_ERROR_RE.test(message) ||
    BLOCK_ERROR_RE.test(message) ||
    NVME_MEDIA_RE.test(message) ||
    EDAC_RE.test(message)
  );
}

/**
 * A sense key that is the drive's normal answer to a feature probe, judged
 * from the Add. Sense and CDB lines that follow it for the same disk:
 *   - Recovered Error with "ATA pass through information available" is the
 *     status an ATA pass-through command (smartctl, hdparm, udisks) returns;
 *   - Illegal Request with "Invalid field in cdb" (or an unsupported opcode)
 *     on an ATA pass-through, WRITE SAME or UNMAP command, or followed by the
 *     kernel disabling write same or discard, is a feature the disk lacks.
 * Neither says anything about the media (R1-17).
 */
function isProbeResponse(senseKey: string, device: string, following: string[]): boolean {
  if (senseKey !== "Recovered Error" && senseKey !== "Illegal Request") return false;
  let addSense = "";
  let cdb = "";
  let disabled = false;
  for (const msg of following) {
    const detail = msg.match(SCSI_DETAIL_RE);
    if (detail && detail[1] === device) {
      if (detail[2] === "CDB") cdb ||= detail[3];
      else addSense ||= detail[3];
      continue;
    }
    const off = msg.match(SCSI_DISABLE_RE);
    if (off && off[1] === device) disabled = true;
  }
  if (senseKey === "Recovered Error") return /^ATA pass through information available\b/i.test(addSense);
  if (disabled) return true;
  return (
    /^(?:Invalid field in cdb|Invalid command operation code)\b/i.test(addSense) &&
    /^(?:ATA command pass through|Write same|Unmap)\b/i.test(cdb)
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const RULES = ["disk_io_errors", "filesystem_readonly", "gpu_xid_critical", "ecc_errors", "mce_uncorrected"] as const;

export const kernelLogParser: TriageParser = {
  domain: "kernel_log",
  rules: RULES,
  notDeterminable: [
    { signal: "Error trend over time", reason: "Whether I/O, NVMe or GPU errors are increasing needs repeated readings; one paste is a single point" },
    { signal: "Corrected memory error rate", reason: "Corrected ECC errors are judged by their rate over 24 hours, which needs readings over time" },
    { signal: "Events no longer in the log", reason: "The kernel ring buffer keeps only recent messages; older events may already be overwritten" },
    { signal: "Current read-only mount state", reason: "The log shows the remount event; whether the filesystem is still read-only needs findmnt output" },
    { signal: "Machine check and APEI hardware errors", reason: "The memory rules read EDAC CE/UE count lines only; machine check (mce:) and APEI ({N}[Hardware Error]) records are not decoded here. mcelog --ascii or rasdaemon (ras-mc-ctl --errors) decodes them" },
    { signal: "btrfs and XFS failures", reason: "The read-only check reads the ext4 remount line only; a btrfs forced read-only or an XFS shutdown is not evaluated. findmnt shows the current mount state" },
  ],

  detect(text: string): boolean {
    try {
      for (const raw of splitLines(text)) {
        const trimmed = raw.slice(0, MAX_LINE).trimEnd();
        if (!trimmed || PROMPT_RE.test(trimmed)) continue;
        const line = classify(trimmed);
        if (!line.fromKernel || !kernelShaped(line)) continue;
        if (line.format !== null) return true;
        if (matchesAnyEvent(line.message) || matchesUnevaluated(line.message)) return true;
      }
    } catch {
      return false;
    }
    return false;
  },

  parse(text: string): ParserResult {
    const notes: ParseNote[] = [];
    const formats = new Set<TriageFormat>();
    const events: DmesgEvent[] = [];
    const xids: XidEvent[] = [];
    const xidSeen = new Set<string>();
    const ioDevices = new Set<string>();
    const dimms = new Map<string, EdacDimm>();
    let ioCount = 0;
    let edacLines = 0;
    let edacCe = 0;
    let edacUe = 0;
    let kernelLines = 0;
    let unknownTimeLines = 0;
    let localTimeLines = 0;
    let nonKernelMatches = 0;
    let nonDiskIoLines = 0;
    let unknownSenseLines = 0;
    let probeSenseLines = 0;
    let probeIoLines = 0;
    let mceLines = 0;
    let fsFailLines = 0;
    let libataUncLines = 0;
    let ioDevicesCapped = false;
    const nvmeMediaByDevice = new Map<string, number>();

    try {
      const rawLines = splitLines(typeof text === "string" ? text : "");
      const messageAt = (i: number): string => {
        const t = rawLines[i].slice(0, MAX_LINE).trimEnd();
        return t ? classify(t).message : "";
      };
      for (let li = 0; li < rawLines.length; li++) {
        const trimmed = rawLines[li].slice(0, MAX_LINE).trimEnd();
        if (!trimmed || PROMPT_RE.test(trimmed)) continue;
        const line = classify(trimmed);
        const msg = line.message;

        if (!line.fromKernel) {
          if (matchesAnyEvent(msg)) nonKernelMatches++;
          continue;
        }
        if (!kernelShaped(line)) continue;
        if (line.format !== null) {
          kernelLines++;
          formats.add(line.format);
        }

        let matched = false;

        // dmesg_events: one handler per line, as in Crucible's parseDmesgOutput.
        let ev: Omit<DmesgEvent, "timestamp_iso" | "raw_line"> | null = null;
        const scsi = msg.match(SCSI_SENSE_RE);
        if (scsi) {
          const senseKey = senseKeyOf(scsi[2]);
          const device = safeIdent(scsi[1]);
          const following: string[] = [];
          if (senseKey === "Recovered Error" || senseKey === "Illegal Request") {
            for (let j = li + 1; j < rawLines.length && j <= li + SENSE_DETAIL_LINES; j++) following.push(messageAt(j));
          }
          if (senseKey && (NON_ERROR_SENSE_KEYS.has(senseKey) || isProbeResponse(senseKey, scsi[1], following))) {
            probeSenseLines++;
          } else if (senseKey) {
            ev = {
              event_type: "scsi_sense",
              severity: MAJOR_SENSE_KEYS.has(senseKey) ? "critical" : "warning",
              details: { device, sense_key: senseKey },
            };
          } else {
            unknownSenseLines++;
          }
        } else {
          const nvme = msg.match(NVME_RE);
          if (nvme && NVME_FAULT_RE.test(nvme[2])) {
            // Same action word Crucible derives, so titles match the live agent's.
            // The probe-failure removal has none of those words; it is the
            // driver disabling the controller, not a reset.
            const action = NVME_PROBE_REMOVAL_RE.test(nvme[2])
              ? "disabling"
              : (nvme[2].match(/(timeout|reset|aborting|disabling)/i)?.[1] ?? "reset").toLowerCase();
            ev = {
              event_type: "nvme_reset",
              severity: "critical",
              details: { controller: safeIdent(nvme[1]), action },
            };
          } else {
            const ext4 = msg.match(EXT4_RO_RE);
            if (ext4) {
              ev = {
                event_type: "ext4_remount_readonly",
                severity: "critical",
                details: { device: safeIdent(ext4[1]), remount_readonly: true },
              };
            }
          }
        }
        if (ev) {
          events.push({ timestamp_iso: line.time, raw_line: "", ...ev });
          matched = true;
        }

        const xid = msg.match(XID_RE);
        if (xid) {
          const code = Number.parseInt(xid[2], 10);
          const bdf = safeIdent(xid[1]);
          // Crucible dedups (timestamp, bdf, code) within one read. A line
          // without any timestamp cannot be told apart from a repeat, so it
          // always counts.
          const key = line.stampKey === null ? null : `${line.stampKey}|${bdf}|${code}`;
          if (key === null || !xidSeen.has(key)) {
            if (key !== null) xidSeen.add(key);
            xids.push({
              timestamp_iso: line.time,
              xid_code: code,
              pci_bdf: bdf,
              severity: XID_CRITICAL.has(code) ? "critical" : XID_WARNING.has(code) ? "warning" : "info",
              raw_message: "",
            });
          }
          matched = true;
        }

        const nvmeMedia = msg.match(NVME_MEDIA_RE);
        if (nvmeMedia) {
          const name = safeIdent(nvmeMedia[1], 32);
          nvmeMediaByDevice.set(name, (nvmeMediaByDevice.get(name) ?? 0) + 1);
          matched = true;
        }

        if (IO_ERROR_RE.test(msg) || BLOCK_ERROR_RE.test(msg)) {
          const dev = msg.match(IO_DEV_RE)?.[1] ?? msg.match(IO_ON_DEVICE_RE)?.[1] ?? null;
          if (dev !== null && NON_DISK_RE.test(dev)) {
            nonDiskIoLines++;
          } else if (PROBE_OP_RE.test(msg)) {
            probeIoLines++;
          } else {
            ioCount++;
            if (dev !== null) {
              const name = safeIdent(dev, 32);
              if (name && !ioDevices.has(name)) {
                if (ioDevices.size < MAX_IO_DEVICES) ioDevices.add(name);
                else ioDevicesCapped = true;
              }
            }
            matched = true;
          }
        }

        const edac = msg.match(EDAC_RE);
        if (edac) {
          const count = Number.parseInt(edac[2], 10);
          if (Number.isSafeInteger(count) && count > 0) {
            edacLines++;
            const ue = edac[3] === "UE";
            if (ue) edacUe += count;
            else edacCe += count;
            const labelRaw = edac[4].match(EDAC_LABEL_RE)?.[1];
            const label = labelRaw ? safeLabel(labelRaw) : "";
            if (label) {
              const key = `${edac[1]}|${label}`;
              const dimm = dimms.get(key) ?? { label, location: "", size_mb: null, ce_count: 0, ue_count: 0 };
              if (ue) dimm.ue_count += count;
              else dimm.ce_count += count;
              dimms.set(key, dimm);
            }
            matched = true;
          }
        }

        let unevaluated = true;
        if (MCE_RE.test(msg)) mceLines++;
        else if (FS_FAIL_RE.test(msg)) fsFailLines++;
        else if (LIBATA_UNC_RE.test(msg)) libataUncLines++;
        else unevaluated = false;

        if (matched || unevaluated) {
          // An un-prefixed matching line is dmesg -t / grep output.
          if (line.format === null) {
            kernelLines++;
            formats.add("dmesg");
          }
        }
        if (matched) {
          if (line.timeKind === "unknown") unknownTimeLines++;
          else if (line.timeKind === "local") localTimeLines++;
        }
      }
      // The verbose NVMe line and the block-layer line report the same failed
      // command; the per-command lines count only where no block-layer line did.
      for (const [name, n] of nvmeMediaByDevice) {
        if (ioDevices.has(name)) continue;
        ioCount += n;
        if (ioDevices.size < MAX_IO_DEVICES) ioDevices.add(name);
        else ioDevicesCapped = true;
      }
    } catch {
      // Never throw on hostile input; report what was read so far.
      notes.push({ level: "warning", message: "Part of the kernel log could not be read; findings cover the lines before that point." });
    }

    const snapshot: Partial<Snapshot> = {};
    if (formats.size > 0) {
      const byType: Record<string, number> = { scsi_sense: 0, nvme_reset: 0, ext4_remount_readonly: 0 };
      for (const e of events) byType[e.event_type]++;
      snapshot.dmesg_events = {
        available: true,
        events,
        events_by_type: byType,
        // 0: no time window was applied; every event in the paste counts.
        window_seconds: 0,
      };
    }
    if (ioCount > 0) {
      snapshot.io_errors = { count: ioCount, devices: Array.from(ioDevices) };
    }
    if (xids.length > 0) {
      // capabilities is left out on purpose: the kernel log cannot say whether
      // nvidia-smi or DCGM exist, no rule reads it, and the ingest schema
      // (snapshot-schema.ts) accepts a gpu block without it. gpus and
      // driver_version come from the nvidia_gpu domain when that output is
      // pasted too; analyze.ts merges the two.
      const gpu: Omit<GpuSlice, "capabilities"> = {
        available: true,
        tier1: { available: true, gpus: [], xid_events: xids, driver_version: "" },
      };
      snapshot.gpu = gpu as GpuSlice;
    }
    if (edacLines > 0) {
      snapshot.ecc_edac = {
        edac_corrected_total: edacCe,
        edac_uncorrected_total: edacUe,
        dimms: Array.from(dimms.values()),
      };
    }

    // A subject here is a kernel log record read from the paste, not only one
    // that matched: a clean log is still a log whose lines were checked, and
    // analyze.ts runs a domain's rules (and reports "no matching signal")
    // only for parsers with subjects > 0.
    const subjects = kernelLines;
    const matchedEvents = events.length + xids.length + ioCount + edacLines;

    // A rule whose evidence the paste shows in a form it does not read is left
    // out, unless what it does read is also present (then it runs and fires).
    const unread = new Set<string>();
    if (mceLines > 0 && edacUe === 0) {
      unread.add("ecc_errors");
      unread.add("mce_uncorrected");
    }
    if (fsFailLines > 0 && !events.some((e) => e.event_type === "ext4_remount_readonly")) unread.add("filesystem_readonly");
    const diskInput = ioCount > 0 || events.some((e) => e.event_type !== "ext4_remount_readonly");
    if (libataUncLines > 0 && !diskInput) unread.add("disk_io_errors");

    if (formats.size === 0) {
      notes.push({ level: "info", message: "No kernel log lines were recognised." });
    } else if (matchedEvents === 0) {
      notes.push({
        level: "info",
        message: `Read ${plural(kernelLines, "kernel log line", "kernel log lines")}; none matched a SCSI sense, NVMe controller fault, ext4 read-only remount, block I/O error, NVIDIA Xid or EDAC memory error line.`,
      });
    }
    if (mceLines > 0) {
      notes.push({
        level: "warning",
        message: `${plural(mceLines, "machine check or APEI hardware error line was", "machine check or APEI hardware error lines were")} seen but not decoded: the memory rules read EDAC CE/UE lines only. Decode them with mcelog --ascii or rasdaemon (ras-mc-ctl --errors).`,
      });
    }
    if (fsFailLines > 0) {
      notes.push({
        level: "warning",
        message: `${plural(fsFailLines, "btrfs or XFS filesystem failure line was", "btrfs or XFS filesystem failure lines were")} seen but not evaluated: the read-only check reads ext4 remount lines only. findmnt shows whether the filesystem is read-only now.`,
      });
    }
    if (unread.has("disk_io_errors")) {
      notes.push({
        level: "warning",
        message: `${plural(libataUncLines, "libata uncorrectable read (UNC) line was", "libata uncorrectable read (UNC) lines were")} seen but not evaluated: the disk I/O check reads SCSI sense and block I/O error lines, which this excerpt does not have. Paste the full dmesg, or run smartctl -a on the disk.`,
      });
    }
    if (unknownTimeLines > 0) {
      notes.push({
        level: "info",
        message: `Event times are unknown for ${plural(unknownTimeLines, "line", "lines")} (relative or year-less timestamps); no such event is treated as recent.`,
      });
    }
    if (localTimeLines > 0) {
      notes.push({
        level: "info",
        message: `Event times for ${plural(localTimeLines, "line", "lines")} carry no time zone and are reported as printed.`,
      });
    }
    if (nonKernelMatches > 0) {
      notes.push({
        level: "warning",
        message: `${plural(nonKernelMatches, "line was", "lines were")} logged by a process other than the kernel and not counted.`,
      });
    }
    if (nonDiskIoLines > 0) {
      notes.push({
        level: "info",
        message: `${plural(nonDiskIoLines, "I/O error line on a floppy, optical, loop, network or virtual block device was", "I/O error lines on floppy, optical, loop, network or virtual block devices were")} not counted.`,
      });
    }
    if (ioDevicesCapped) {
      notes.push({
        level: "info",
        message: `I/O errors name more than ${MAX_IO_DEVICES} devices; the count covers all of them and the first ${MAX_IO_DEVICES} are listed.`,
      });
    }
    if (unknownSenseLines > 0) {
      notes.push({
        level: "info",
        message: `${plural(unknownSenseLines, "SCSI sense line carries", "SCSI sense lines carry")} no standard sense key and ${unknownSenseLines === 1 ? "was" : "were"} not counted.`,
      });
    }
    if (probeSenseLines > 0) {
      notes.push({
        level: "info",
        message: `${plural(probeSenseLines, "SCSI sense report was", "SCSI sense reports were")} not counted: "No Sense", or a drive's normal answer to a feature probe (ATA pass-through status, or an unsupported WRITE SAME, UNMAP or pass-through command). None of these is a media error.`,
      });
    }
    if (probeIoLines > 0) {
      notes.push({
        level: "info",
        message: `${plural(probeIoLines, "block I/O error on a discard or write-zeroes request was", "block I/O errors on discard or write-zeroes requests were")} not counted: a disk or controller that lacks the feature fails the kernel's probe for it.`,
      });
    }
    if (edacLines > 0) {
      notes.push({
        level: "info",
        message: "Memory error counts are summed from EDAC lines in this paste; the kernel's own counters can be higher if logging was rate-limited or the log rotated.",
      });
    }
    if (edacCe > 0) {
      notes.push({
        level: "info",
        message: `${plural(edacCe, "corrected memory error was", "corrected memory errors were")} logged; whether that rate is a problem needs readings over time.`,
      });
    }

    const result: ParserResult = {
      domain: "kernel_log",
      formats: Array.from(formats),
      snapshot,
      subjects,
      notes,
    };
    if (unread.size > 0) result.rules_checked = RULES.filter((r) => !unread.has(r));
    return result;
  },
};
