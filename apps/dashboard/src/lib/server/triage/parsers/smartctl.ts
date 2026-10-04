// Paste triage parser for smartctl output (domain "smart"): `smartctl --json`
// (one object, a JSON array, or several objects back to back, with or without
// shell prompts between them) and the text of `smartctl -a` / `-x` / `-H -A`
// / `-i` from smartmontools 6.x and 7.x (ATA attribute table, NVMe health log,
// SCSI/SAS health page, ATA self-test log). Fills Snapshot.smart and
// Snapshot.smart_unreadable with the shape Crucible's collector sends, so
// smart_failing, nvme_wear_high, nvme_critical_warning and
// drive_smart_unreadable judge a paste the way they judge a live agent.
// Field mapping ported from crucible src/collect/smart.ts (parseSmartctlJson,
// decodeNvmeCriticalWarning, unpackSeagateCounter); the agent reads
// `smartctl --json --all <dev>` (crucible src/lib/privileged.ts).
//
// Where a paste differs from the agent's read, and what this parser does:
//   - Device path: smartctl's text output never prints one. It comes from the
//     JSON `device.name`, a prompt or command line, a loop header such as
//     "=== /dev/sda ===", or a smartctl error line naming the device. With none
//     of those the drive is labeled "unknown-device" (numbered when there are
//     several) and a note says to match it by serial. Never guessed.
//   - Health verdict: only "PASSED" / "FAILED" from the overall-health line
//     (ATA, NVMe), "SMART Health Status" (SCSI: OK is PASSED, anything else is
//     FAILED, as smartctl's own JSON records it) or JSON smart_status.passed.
//     A paste without one (`smartctl -A`) gets health "", which no rule reads
//     as a failure; Crucible's "missing passed = FAILED" fallback is never hit
//     on its --all read and would invent a failure here.
//   - Raw values: text RAW_VALUE reads as its leading number ("38 (Min/Max
//     24/45)" is 38, "12 (0 8)" is 12); a raw16 triple ("0 1 3", most
//     significant word first) is re-packed into the 48-bit raw the JSON
//     carries, so the Seagate 188 unpack and the non-Seagate pass-through
//     behave exactly as on the agent.
//   - Unreadable devices follow drive_smart_unreadable's semantics (fixed,
//     non-zero disks with no readable SMART): a controller that needs a `-d`
//     type, "SMART support is: Unavailable" and a device that stops answering
//     are "no_smart_data"; `smartctl: command not found` on a named device is
//     "no_smartctl_output". BMC virtual media, 0-byte devices, USB bridges,
//     optical drives and unsupported device types are never failed or
//     unreadable disks: they are dropped with an info note. As on the agent, a
//     controller virtual disk with no SMART is not flagged when the physical
//     drives behind the controller were read in the same paste.
//   - SAS "Elements in grown defect list" is not mapped: Crucible does not
//     send it and no rule reads it, so a non-zero count is reported as a note
//     rather than turned into a finding the dashboard would never raise.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent, safeLabel } from "../sanitize";
import type { ParseNote, ParserResult, TriageFormat, TriageParser } from "../types";

type SmartEntry = Snapshot["smart"][number];
type UnreadableEntry = NonNullable<Snapshot["smart_unreadable"]>[number];
type CriticalWarningFlags = NonNullable<SmartEntry["critical_warning_decoded"]>;
type SelfTestSummary = NonNullable<SmartEntry["self_test"]>;

interface AttrRow {
  id: number;
  name: string;
  /** Normalized VALUE column (0..253), null when smartctl prints "---". */
  value: number | null;
  /** WORST and THRESH columns, null when absent or "---". */
  worst: number | null;
  thresh: number | null;
  /** Raw counter, as the JSON raw.value would carry it. */
  raw: number | null;
}

interface SelfTestRow {
  type?: string;
  status: string;
  /** High nibble of the ATA self-test status byte, when known. */
  nibble: number | null;
  passed?: boolean;
  lifetime?: number;
  lba?: number;
}

interface NvmeLog {
  critical_warning?: number;
  temperature?: number;
  available_spare?: number;
  available_spare_threshold?: number;
  percentage_used?: number;
  media_errors?: number;
  num_err_log_entries?: number;
  power_on_hours?: number;
}

/** Everything one paste says about one device, before it becomes a snapshot entry. */
interface DeviceRead {
  offset: number;
  /** Sanitized /dev path as written in the paste. */
  path?: string;
  /** Validated controller passthrough selector, e.g. "sat+megaraid,8". */
  passthroughType?: string;
  model?: string;
  family?: string;
  vendor?: string;
  product?: string;
  serial?: string;
  firmware?: string;
  capacityBytes?: number;
  healthSeen: boolean;
  health?: "PASSED" | "FAILED";
  nvmeSeen: boolean;
  nvme: NvmeLog;
  attrs: Map<number, AttrRow>;
  /** Drive temperature outside the NVMe log: JSON temperature.current, SCSI, SCT, attr 194/190. */
  temperature?: number;
  powerOnHours?: number;
  selfTest?: SelfTestRow[];
  selfTestErrorCount?: number;
  grownDefects?: number;
  smartSupport?: "available" | "unavailable" | "disabled";
  usbBridge: boolean;
  usbVendor?: string;
  controllerNeedsType: boolean;
  pleaseSpecify: boolean;
  permissionDenied: boolean;
  noSuchDevice: boolean;
  commandNotFound: boolean;
  smartDisabled: boolean;
  optical: boolean;
  unsupportedType: boolean;
  identityFailed: boolean;
  truncated: boolean;
  // Text-block bookkeeping (block boundaries and the section a line is in).
  hasContent: boolean;
  infoSeen: boolean;
  dataSeen: boolean;
  inAttrTable: boolean;
  inSelfTest: boolean;
  inNvmeLog: boolean;
  /** Attribute 9 raw text, converted to hours once the table is read. */
  powerOnRaw?: { name: string; raw: string };
  sctTemperature?: number;
}

interface DevRef {
  path: string;
  type?: string;
}

interface Counters {
  virtualMedia: number;
  usbBridge: number;
  optical: number;
  permission: number;
  noDevice: number;
  unsupported: number;
  disabled: number;
  identityOnly: number;
  missingToolUnnamed: number;
  identityFailed: number;
  healthUnknown: number;
  unknownDevice: number;
  truncatedJson: number;
  unreadableJson: number;
  grownDefectDrives: number;
  grownDefectTotal: number;
  /** Drives whose self-test log holds a failed test (status 3..8), and the first one's newest failure. */
  failedSelfTestDrives: number;
  failedSelfTest?: { nibble: number; lba?: number; hours?: number };
  /** Drives with SMART 197 or 198 above zero, and the largest of each. */
  pendingDrives: number;
  maxPending: number;
  maxOfflineUncorrectable: number;
  vdSuppressed: number;
  hypervisorDisk: number;
  softwareBlock: number;
  sharedSerial: number;
  budgetHit: boolean;
  deviceCapHit: boolean;
  wdWearUnread: number;
}

// Crucible's passthrough grammar (privileged.ts isAllowedSmartType): an
// optional sat+, a controller family, a single numeric id.
const PASSTHROUGH_RE = /^(sat\+)?(megaraid|cciss|3ware|aacraid|areca|marvell),\d+$/;
const DEV_PATH_RE = /^\/dev\/[A-Za-z0-9_\/.+:-]{1,120}$/;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// smartctl lines are short; a longer line is not smartctl output and is
// skipped so no regex ever runs on a hostile 200 KB line.
const MAX_LINE = 4096;
const MAX_DEVICES = 1024;
const MAX_SELF_TEST_ROWS = 64;

const BANNER_RE = /^smartctl\s+\d+\.\d+(?:\s|$)/;
const INFO_SECTION_RE = /^=== START OF INFORMATION SECTION ===/;
const DATA_SECTION_RE = /^=== START OF (?:READ )?SMART DATA SECTION ===/;
// A shell prompt: "root@host:~# ...", "user@host:~$ ...", "[root@host ~]# ...",
// "root@host ~ # ...", "bash-5.1# ...". Anything after it is the command.
const PROMPT_RE =
  /^\s*(?:\[[^\]\n]{1,120}\]|[A-Za-z0-9_.-]{1,64}@[A-Za-z0-9_.-]{1,128}(?::[^\s#$%]{0,256})?(?:\s+[^\s#$%]{1,256})?|(?:ba|z|k|da)?sh-\d[\d.]{0,8})\s?[#$%](?:\s+(.*))?$/;
// A bare "$ " / "# " prompt only counts when it runs smartctl or a loop: the
// ATA self-test log rows also start with "# 1".
const BARE_PROMPT_RE = /^\s*[#$%>]\s+((?:sudo\s+)?(?:smartctl|for|while)\b.*)$/;
const BARE_COMMAND_RE = /^\s*((?:sudo\s+(?:-\S+\s+)*)?smartctl\s+-.*)$/;
// smartmontools on Windows: "PS C:\Users\admin> smartctl -a /dev/sda", "C:\>".
const WINDOWS_PROMPT_RE = /^\s*(?:PS )?[A-Za-z]:\\[^>\n]{0,200}>\s?(.*)$/;
// Loop headers naming the device: "=== /dev/sda ===", "==> /dev/sda <==",
// "/dev/sda:", "Device: /dev/sda". A bare "/dev/sda" line only counts when a
// smartctl banner follows it. Each whitespace run has one owner: two
// quantifiers that could split the same run cost 10 ms per padded 4 KB line,
// 400 ms per paste (R2-8).
const DECORATED_HEADER_RE = /^\s*[=#*>-]+\s*(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})\s*(?:[=#*<-]+\s*)?$/;
const COLON_HEADER_RE = /^\s*(\/dev\/[A-Za-z0-9_\/.+:-]{1,120}):\s*$/;
const LABEL_HEADER_RE = /^\s*(?:Device|Disk|Drive)(?:\s*:\s+|\s+)(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})\s*$/i;
const BARE_HEADER_RE = /^\s*(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})\s*$/;

const HEALTH_ATA_RE = /^\s*SMART overall-health self-assessment test result:\s*(\S+)/;
const HEALTH_SCSI_RE = /^\s*SMART Health Status:\s*(\S.*)$/;
const NVME_LOG_RE = /^\s*SMART\/Health Information \(NVMe Log 0x02/;
const ATTR_HEADER_RE = /^\s*ID#\s+ATTRIBUTE_NAME\s+FLAGS?\b/;
// "  5 Reallocated_Sector_Ct   0x0033   100   100   010    Pre-fail  Always       -       0"
// and the -x brief form "  5 Reallocated_Sector_Ct   PO--CK   100   100   010    -    0".
const ATTR_ROW_RE =
  /^\s*(\d{1,3})\s+(\S+)\s+(0x[0-9a-fA-F]{4}|[P-][O-][S-][R-][C-][K-]\+?)\s+(\d{1,3}|---)\s+(\d{1,3}|---)\s+(\d{1,3}|---)\s+(\S.*)$/;
const ATTR_OLD_TAIL_RE = /^(?:Pre-fail|Old_age)\s+(?:Always|Offline)\s+\S+\s+(\S.*)$/;
const ATTR_BRIEF_TAIL_RE = /^\S+\s+(\S.*)$/;
const SELF_TEST_HEADER_RE = /^\s*Num\s+Test_Description\s+Status\s+Remaining\s+LifeTime\(hours\)\s+LBA_of_first_error/;
const SELF_TEST_ROW_RE = /^\s*#\s*(\d{1,2})\s+(\S.*?)\s+(\d{1,3})%\s+(\d{1,10})\s+(\S+)\s*$/;
const SMART_SUPPORT_RE = /^\s*SMART support is:\s*(\S.*)$/;
const POWER_ON_SCSI_RE = /^\s*Accumulated power on time, hours:minutes\s+(\d{1,9}):\d{1,2}\b/;
const KV_RE = /^\s*([A-Za-z][A-Za-z0-9 \/().,_-]{0,60}?)\s*:\s+(\S.*)$/;

const USB_BRIDGE_RE = /\bUSB bridge\b/i;
const USB_VENDOR_RE = /\[(0x[0-9a-fA-F]{4}):0x[0-9a-fA-F]{4}/;
const CONTROLLER_HINT_RE =
  /DELL or MegaRaid controller|please try adding '?-d (?:sat\+)?(?:megaraid|cciss|3ware|aacraid|areca|marvell|hpt)|requires option '?-d (?:sat\+)?(?:megaraid|cciss|3ware|aacraid|areca|marvell|hpt)/i;
const PLEASE_SPECIFY_RE = /Please specify device type with the -d option|Unable to detect device type/i;
const OPEN_FAILED_RE = /Smartctl open device:\s*(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})(?:\s*\[[^\]]{0,64}\])?\s+failed:\s*(.*)$/i;
const INLINE_DEVICE_RE = /^\s*(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})(?:\s*\[[^\]]{0,64}\])?:\s+\S/;
const PERMISSION_RE = /Permission denied|Operation not permitted/i;
const NO_DEVICE_RE = /No such device|No such file or directory/i;
const IDENTITY_FAILED_RE = /Read Device Identity failed|A mandatory SMART command failed|INQUIRY failed|Device Read Identity Failed/i;
const SMART_DISABLED_RE = /SMART Disabled\. Use option -s/i;
const OPTICAL_RE = /Packet Interface Devices|this device: CD\/DVD/i;
const UNSUPPORTED_RE = /Device type\b.{0,64}\b(?:unsupported|not supported)|\bunsupported (?:device|USB)\b/i;
const COMMAND_NOT_FOUND_RE = /\bsmartctl: (?:command )?not found\b|command not found: smartctl\b/;

// BMC virtual media ("AMI Virtual HDisk0", "ATEN Virtual CDROM", OpenBMC's
// "Linux File-Stor Gadget") and the USB vendor ids those BMCs present.
const VIRTUAL_MEDIA_RE =
  /\bVirtual[ _]?(?:HDisk|CDROM|CD\/DVD|Floppy|FDD|HDD|Media|Disk\d)|\bAMI\b.{0,24}\bVirtual\b|\bATEN\b.{0,24}\bVirtual\b|File-Stor Gadget|\biDRAC\b|\bVirtual_(?:CDROM|HDisk)/i;
const BMC_USB_VENDORS = new Set(["0x046b", "0x0557", "0x0624"]);

// Disks a hypervisor presents to a guest: QEMU/KVM, VMware, Hyper-V,
// VirtualBox, Xen. virtio-blk (/dev/vd*) and Xen (/dev/xvd*) disks are never
// probed by the agent, which lists only sd*, nvme* and hd* devices.
const HYPERVISOR_DISK_RE = /\bQEMU\b|\bVMware\b|\bMsft\b|\bVBOX\b|\bVirtualBox\b|\bXen\b|\bVirtIO\b/i;
const HYPERVISOR_PATH_RE = /^\/dev\/x?vd[a-z]+$/;
// Block devices that are not disks: md arrays, device-mapper and LVM volumes,
// loop, zvols, network and cache devices, optical, RAM disks. smartctl cannot
// map these names to a disk interface and prints "Unable to detect device
// type", which read as a disk whose SMART is unreadable and raised a warning
// even beside PASSED member disks (R2-13). The agent lists only sd*, nvme* and
// hd* devices, so it never probes them.
const SOFTWARE_BLOCK_PATH_RE =
  /^\/dev\/(?:md\d{1,4}|md_d\d{1,4}|md\/[^/]{1,64}|dm-\d{1,4}|mapper\/[^/]{1,128}|loop\d{1,4}|zd\d{1,5}|nbd\d{1,4}|rbd\d{1,4}|drbd\d{1,4}|bcache\d{1,4}|sr\d{1,3}|ram\d{1,3}|zram\d{1,3}|disk\/by-id\/(?:md|dm|lvm)-[^/]{1,128})$/;

const SMARTCTL_JSON_KEY_RE =
  /"(?:json_format_version|smartctl|model_name|serial_number|smart_status|ata_smart_attributes|nvme_smart_health_information_log)"\s*:/;

const DETECT_RE = new RegExp(
  [
    "^smartctl[ \\t]+\\d+\\.\\d+",
    "=== START OF (?:INFORMATION|READ SMART DATA|SMART DATA) SECTION ===",
    "SMART overall-health self-assessment test result",
    "^[ \\t]*SMART Health Status:",
    "SMART/Health Information \\(NVMe Log",
    "Vendor Specific SMART Attributes with Thresholds",
    '"json_format_version"\\s*:',
    '"(?:smart_status|ata_smart_attributes|nvme_smart_health_information_log)"\\s*:',
    "Unknown USB bridge",
    "Smartctl open device:",
    "smartctl: (?:command )?not found",
    "command not found: smartctl",
  ].join("|"),
  "m",
);

// Ported from crucible src/collect/smart.ts.
/** Seagate packs three 16-bit counters into some 48-bit raws (188); the low word is the count. */
export function unpackSeagateCounter(raw: number): number {
  return raw > 0xffff ? raw % 0x10000 : raw;
}

// Ported from crucible src/collect/smart.ts.
/** NVMe Critical Warning byte per NVM Express spec section 5.21. */
export function decodeNvmeCriticalWarning(byte: number): CriticalWarningFlags {
  return {
    available_spare_low: (byte & 0x01) !== 0,
    temperature_threshold: (byte & 0x02) !== 0,
    reliability_degraded: (byte & 0x04) !== 0,
    read_only: (byte & 0x08) !== 0,
    volatile_memory_backup_failed: (byte & 0x10) !== 0,
    persistent_memory_readonly: (byte & 0x20) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Small value helpers

function newRead(offset: number): DeviceRead {
  return {
    offset,
    healthSeen: false,
    nvmeSeen: false,
    nvme: {},
    attrs: new Map(),
    usbBridge: false,
    controllerNeedsType: false,
    pleaseSpecify: false,
    permissionDenied: false,
    noSuchDevice: false,
    commandNotFound: false,
    smartDisabled: false,
    optical: false,
    unsupportedType: false,
    identityFailed: false,
    truncated: false,
    hasContent: false,
    infoSeen: false,
    dataSeen: false,
    inAttrTable: false,
    inSelfTest: false,
    inNvmeLog: false,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Leading integer with optional thousands separators ("12,345", "12.345", "4,000,787,030,016 bytes"). */
function groupedInt(value: string): number | undefined {
  const m = /^(\d{1,3}(?:([,.'  ])\d{3})(?:\2\d{3})*|\d{1,16})(?!\d)/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1].replace(/\D/g, ""));
  return Number.isSafeInteger(n) ? n : undefined;
}

function plausibleTemp(n: number | undefined): number | undefined {
  return n !== undefined && n >= 0 && n <= 150 ? n : undefined;
}

/**
 * RAW_VALUE text as the number the JSON raw.value carries. smartctl prints
 * raw16 as three words, most significant first, so they are re-packed into
 * the 48-bit raw; any other format reads as its leading number.
 */
function rawFromText(raw: string): number | null {
  const s = raw.trim();
  const words = /^(\d{1,5}) (\d{1,5}) (\d{1,5})$/.exec(s);
  if (words) {
    const hi = Number(words[1]);
    const mid = Number(words[2]);
    const lo = Number(words[3]);
    if (hi <= 0xffff && mid <= 0xffff && lo <= 0xffff) return hi * 2 ** 32 + mid * 2 ** 16 + lo;
  }
  const hex = /^0x([0-9a-fA-F]{1,12})\b/.exec(s);
  if (hex) return parseInt(hex[1], 16);
  const lead = /^(\d{1,15})/.exec(s);
  return lead ? Number(lead[1]) : null;
}

/** Attribute 9 in hours, whatever unit the drive counts in. */
function powerOnHoursFromAttr(name: string, raw: string): number | undefined {
  const s = raw.trim();
  const hm = /^(\d{1,9})h\+/.exec(s);
  if (hm) return Number(hm[1]);
  const lead = /^(\d{1,12})/.exec(s);
  if (!lead) return undefined;
  const n = Number(lead[1]);
  if (/half_?min/i.test(name)) return Math.floor(n / 120);
  if (/minute/i.test(name)) return Math.floor(n / 60);
  if (/second/i.test(name)) return Math.floor(n / 3600);
  return n;
}

function setPath(d: DeviceRead, rawPath: string | undefined, rawType?: string): void {
  if (!rawPath || !DEV_PATH_RE.test(rawPath)) return;
  const path = safeIdent(rawPath, 64);
  if (!path.startsWith("/dev/")) return;
  d.path = path;
  const type = rawType?.replace(/^['"]|['"]$/g, "");
  if (type && PASSTHROUGH_RE.test(type)) d.passthroughType = type;
}

/** Devices a command line names: every `smartctl ... /dev/X`, or a for-loop's explicit list. */
function commandDevices(cmd: string): DevRef[] {
  if (!/\bsmartctl\b/.test(cmd)) return [];
  const loop = /\bfor\s+\w+\s+in\s+([^;]{1,2000});/.exec(cmd);
  const loopPaths = loop ? loop[1].split(/\s+/).filter((t) => DEV_PATH_RE.test(t)) : [];
  const out: DevRef[] = [];
  for (const m of cmd.matchAll(/\bsmartctl\b([^;|&]{0,1000})/g)) {
    const args = m[1];
    const type = /(?:^|\s)(?:-d|--device)(?:\s+|=)(\S+)/.exec(args)?.[1];
    const path = /(?:^|\s)(\/dev\/[A-Za-z0-9_\/.+:-]{1,120})(?=\s|$)/.exec(args)?.[1];
    if (path) out.push({ path, type });
    else for (const p of loopPaths) out.push({ path: p, type });
    if (out.length >= MAX_DEVICES) break;
  }
  return out;
}

function promptCommand(line: string): string | null {
  const p = PROMPT_RE.exec(line);
  if (p) return p[1] ?? "";
  const b = BARE_PROMPT_RE.exec(line) ?? BARE_COMMAND_RE.exec(line) ?? WINDOWS_PROMPT_RE.exec(line);
  return b ? b[1] : null;
}

function headerPath(lines: string[], i: number): string | undefined {
  const line = lines[i];
  const m = DECORATED_HEADER_RE.exec(line) ?? COLON_HEADER_RE.exec(line) ?? LABEL_HEADER_RE.exec(line);
  if (m) return m[1];
  const bare = BARE_HEADER_RE.exec(line);
  if (!bare) return undefined;
  for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
    if (lines[j].trim() === "") continue;
    return BANNER_RE.test(lines[j]) ? bare[1] : undefined;
  }
  return undefined;
}

/** smartctl's own error and status messages, from text lines and JSON smartctl.messages alike. */
function applyMessage(d: DeviceRead, line: string): boolean {
  let hit = false;
  if (USB_BRIDGE_RE.test(line)) {
    d.usbBridge = true;
    const v = USB_VENDOR_RE.exec(line)?.[1]?.toLowerCase();
    if (v) d.usbVendor = v;
    hit = true;
  }
  if (CONTROLLER_HINT_RE.test(line)) {
    d.controllerNeedsType = true;
    hit = true;
  }
  if (PLEASE_SPECIFY_RE.test(line)) {
    d.pleaseSpecify = true;
    hit = true;
  }
  const open = OPEN_FAILED_RE.exec(line);
  if (open) {
    if (!d.path) setPath(d, open[1]);
    const why = open[2];
    if (PERMISSION_RE.test(why)) d.permissionDenied = true;
    else if (NO_DEVICE_RE.test(why)) d.noSuchDevice = true;
    else if (!CONTROLLER_HINT_RE.test(why) && !USB_BRIDGE_RE.test(why)) d.identityFailed = true;
    hit = true;
  } else if (PERMISSION_RE.test(line) && /smartctl|open device|\/dev\//i.test(line)) {
    d.permissionDenied = true;
    hit = true;
  }
  if (IDENTITY_FAILED_RE.test(line)) {
    d.identityFailed = true;
    hit = true;
  }
  if (SMART_DISABLED_RE.test(line)) {
    d.smartDisabled = true;
    hit = true;
  }
  if (OPTICAL_RE.test(line)) {
    d.optical = true;
    hit = true;
  }
  if (UNSUPPORTED_RE.test(line)) {
    d.unsupportedType = true;
    hit = true;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// JSON

/** One open bracket; `up` is the bracket it sits in. Immutable, so a cut can keep a pointer. */
interface Frame {
  c: "{" | "[";
  up: Frame | null;
  depth: number;
}

interface JsonCut {
  end: number;
  /** Innermost bracket still open at the cut. */
  top: Frame;
}

// smartctl's JSON nests fewer than ten levels. A deeper value is not its
// output, and stopping there bounds the scan.
const MAX_JSON_DEPTH = 64;

type ScanResult =
  | { kind: "balanced"; end: number; cost: number }
  | { kind: "truncated"; cuts: JsonCut[]; cost: number }
  | { kind: "invalid"; cost: number };

/**
 * Find the end of the JSON value starting at `start` without parsing it,
 * stopping at `limit`. When the value is cut off (the limit is reached, a
 * string runs into a newline, or a bracket closes the wrong container),
 * records every point where the text so far could be closed into valid JSON
 * (just before a comma or just after a nested close), with the brackets
 * still open there.
 */
function scanJson(text: string, start: number, limit: number): ScanResult {
  // The open brackets are a linked list, not a string: a string stack copied
  // into every cut held one copy per comma or close, and 198 KB of nested
  // brackets needed over 4 GB and killed the process (review round 1, R1-1).
  let top: Frame | null = null;
  let inString = false;
  let escaped = false;
  const cuts: JsonCut[] = [];
  const stop = (i: number): ScanResult =>
    cuts.length > 0 ? { kind: "truncated", cuts, cost: i - start } : { kind: "invalid", cost: i - start };
  for (let i = start; i < limit; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      else if (c === "\n") return { kind: "truncated", cuts, cost: i - start };
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      const depth: number = (top?.depth ?? 0) + 1;
      if (depth > MAX_JSON_DEPTH) return stop(i);
      top = { c, up: top, depth };
    } else if (c === "}" || c === "]") {
      if (top === null || (c === "}" && top.c !== "{") || (c === "]" && top.c !== "[")) return stop(i);
      top = top.up;
      if (top === null) return { kind: "balanced", end: i + 1, cost: i - start };
      cuts.push({ end: i + 1, top });
    } else if (c === "," && top !== null) cuts.push({ end: i, top });
  }
  return { kind: "truncated", cuts, cost: limit - start };
}

function closeAt(text: string, start: number, cut: JsonCut): unknown {
  let closers = "";
  for (let f: Frame | null = cut.top; f !== null; f = f.up) closers += f.c === "{" ? "}" : "]";
  try {
    return JSON.parse(text.slice(start, cut.end) + closers);
  } catch {
    return undefined;
  }
}

/** Largest prefix of a cut-off JSON value that parses (every cut before the real cut-off does). */
function repairJson(text: string, start: number, cuts: JsonCut[]): unknown {
  if (cuts.length === 0) return undefined;
  const last = closeAt(text, start, cuts[cuts.length - 1]);
  if (last !== undefined) return last;
  let lo = 0;
  let hi = cuts.length - 2;
  let best: unknown = undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = closeAt(text, start, cuts[mid]);
    if (v !== undefined) {
      best = v;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

interface JsonValue {
  value: unknown;
  offset: number;
  truncated: boolean;
}

/**
 * Pull every top-level JSON value out of the paste. A candidate starts at a
 * line whose first character is { or [ and may not run past the next line
 * that starts a new top-level value at column 0, a shell prompt or a smartctl
 * banner, so one cut-off object cannot swallow the next. Returns the paste
 * with the JSON spans blanked (newlines kept, so offsets still line up) for
 * the text pass.
 */
function extractJson(text: string, counters: Counters): { values: JsonValue[]; masked: string } {
  const values: JsonValue[] = [];
  const spans: Array<[number, number]> = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineEnd = (li: number) => (li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : text.length);
  let budget = text.length * 4 + 4096;

  // nextBoundary[li]: start offset of the first line after li that begins a
  // new top-level value at column 0, or is a prompt or a smartctl banner.
  // nextHardBoundary[li]: the same, counting prompts and banners only.
  const nextBoundary: number[] = new Array(lineStarts.length);
  const nextHardBoundary: number[] = new Array(lineStarts.length);
  let boundary = text.length;
  let hardBoundary = text.length;
  for (let lj = lineStarts.length - 1; lj >= 0; lj--) {
    nextBoundary[lj] = boundary;
    nextHardBoundary[lj] = hardBoundary;
    const first = text[lineStarts[lj]];
    const line = text.slice(lineStarts[lj], lineEnd(lj));
    if (line.length <= MAX_LINE && (BANNER_RE.test(line) || promptCommand(line) !== null)) {
      boundary = lineStarts[lj];
      hardBoundary = lineStarts[lj];
    } else if (first === "{" || first === "[") {
      boundary = lineStarts[lj];
    }
  }
  // Second chance for JSON whose indentation was stripped in the paste (a
  // nested { at column 0 looks like a new value): scan on to the next prompt
  // or banner, and accept it only if that parses whole.
  let wideBudget = text.length * 2 + 4096;

  let li = 0;
  while (li < lineStarts.length) {
    let p = lineStarts[li];
    const le = lineEnd(li);
    while (p < le && (text[p] === " " || text[p] === "\t")) p++;
    if (p >= le || (text[p] !== "{" && text[p] !== "[")) {
      li++;
      continue;
    }
    const regionEnd = nextBoundary[li];
    let consumedTo = -1;
    let start = p;
    while (start < regionEnd && (text[start] === "{" || text[start] === "[")) {
      if (budget <= 0) {
        counters.budgetHit = true;
        break;
      }
      let scan = scanJson(text, start, regionEnd);
      budget -= scan.cost + 1;
      const hardEnd = nextHardBoundary[li];
      if (scan.kind === "truncated" && regionEnd < hardEnd && wideBudget > 0) {
        const wide = scanJson(text, start, hardEnd);
        wideBudget -= wide.cost + 1;
        if (wide.kind === "balanced") {
          try {
            JSON.parse(text.slice(start, wide.end));
            scan = wide;
          } catch {
            // not one value after all: keep the cut-off reading
          }
        }
      }
      if (scan.kind === "balanced") {
        const slice = text.slice(start, scan.end);
        let parsed: unknown = undefined;
        try {
          parsed = JSON.parse(slice);
        } catch {
          parsed = undefined;
        }
        if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
          if (SMARTCTL_JSON_KEY_RE.test(slice)) counters.unreadableJson++;
          break;
        }
        values.push({ value: parsed, offset: start, truncated: false });
        spans.push([start, scan.end]);
        consumedTo = scan.end;
        let q = scan.end;
        while (q < regionEnd && /\s/.test(text[q])) q++;
        start = q;
      } else if (scan.kind === "truncated") {
        // Only what the scan read: keys past the cut cannot reach the
        // repaired value, and testing to the region's end re-read the rest of
        // the paste once per indented "{" line, outside the budget (R2-9).
        const slice = text.slice(start, Math.min(regionEnd, start + scan.cost + 1));
        if (SMARTCTL_JSON_KEY_RE.test(slice)) {
          const repaired = repairJson(text, start, scan.cuts);
          if (repaired !== undefined && typeof repaired === "object" && repaired !== null) {
            values.push({ value: repaired, offset: start, truncated: true });
            spans.push([start, regionEnd]);
            consumedTo = regionEnd;
          } else counters.unreadableJson++;
        }
        break;
      } else break;
    }
    if (counters.budgetHit) break;
    if (consumedTo > 0) {
      while (li < lineStarts.length && lineStarts[li] < consumedTo) li++;
    } else li++;
  }

  if (spans.length === 0) return { values, masked: text };
  let masked = "";
  let pos = 0;
  for (const [s, e] of spans) {
    masked += text.slice(pos, s) + text.slice(s, e).replace(/[^\n]/g, " ");
    pos = e;
  }
  masked += text.slice(pos);
  return { values, masked };
}

function isSmartctlJson(o: Record<string, unknown>): boolean {
  return (
    "json_format_version" in o ||
    isObj(o.smartctl) ||
    "smart_status" in o ||
    "ata_smart_attributes" in o ||
    "nvme_smart_health_information_log" in o ||
    ("model_name" in o && ("serial_number" in o || "device" in o))
  );
}

/** One smartctl JSON document as a DeviceRead (the JSON half of crucible's parseSmartctlJson). */
function readJsonDevice(o: Record<string, unknown>, offset: number, truncated: boolean): DeviceRead {
  const d = newRead(offset);
  d.truncated = truncated;
  d.hasContent = true;
  const envelope = isObj(o.smartctl) ? o.smartctl : undefined;
  const device = isObj(o.device) ? o.device : undefined;
  const argv = Array.isArray(envelope?.argv) ? envelope.argv.filter((a): a is string => typeof a === "string").join(" ") : "";
  const fromArgv = commandDevices(`smartctl ${argv.replace(/^smartctl\s*/, "")}`)[0];
  setPath(d, str(device?.name) ?? fromArgv?.path, str(device?.type) ?? fromArgv?.type);

  const vendor = str(o.scsi_vendor) ?? str(o.vendor);
  const product = str(o.scsi_product) ?? str(o.product);
  const model = str(o.model_name) ?? str(o.scsi_model_name) ?? (vendor && product ? `${vendor} ${product}` : undefined);
  if (model) d.model = model;
  if (str(o.model_family)) d.family = str(o.model_family);
  if (vendor) d.vendor = vendor;
  if (product) d.product = product;
  if (str(o.serial_number)) d.serial = str(o.serial_number);
  const fw = str(o.firmware_version) ?? str(o.scsi_revision) ?? str(o.revision);
  if (fw) d.firmware = fw;
  const cap = num(isObj(o.user_capacity) ? o.user_capacity.bytes : undefined) ?? num(o.nvme_total_capacity);
  if (cap !== undefined) d.capacityBytes = cap;

  if (o.smart_status !== undefined) {
    d.healthSeen = true;
    const passed = isObj(o.smart_status) ? o.smart_status.passed : undefined;
    if (passed === true) d.health = "PASSED";
    else if (passed === false) d.health = "FAILED";
  }

  const log = o.nvme_smart_health_information_log;
  if (isObj(log)) {
    d.nvmeSeen = true;
    const keys = ["critical_warning", "temperature", "available_spare", "available_spare_threshold", "percentage_used", "media_errors", "num_err_log_entries"] as const;
    for (const k of keys) {
      const v = num(log[k]);
      if (v !== undefined) d.nvme[k] = v;
    }
  }

  const attrs = isObj(o.ata_smart_attributes) ? o.ata_smart_attributes.table : undefined;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (!isObj(a)) continue;
      const id = num(a.id);
      if (id === undefined || !Number.isInteger(id)) continue;
      d.attrs.set(id, {
        id,
        name: str(a.name) ?? "",
        value: num(a.value) ?? null,
        worst: num(a.worst) ?? null,
        thresh: num(a.thresh) ?? null,
        raw: num(isObj(a.raw) ? a.raw.value : undefined) ?? null,
      });
    }
  }

  const temp = plausibleTemp(num(isObj(o.temperature) ? o.temperature.current : undefined));
  if (temp !== undefined) d.temperature = temp;
  const poh = num(isObj(o.power_on_time) ? o.power_on_time.hours : undefined);
  if (poh !== undefined) d.powerOnHours = poh;

  // Crucible reads the standard log of an --all read; an -x read may carry
  // only the extended one, which has the same row shape.
  const stLog = isObj(o.ata_smart_self_test_log) ? o.ata_smart_self_test_log : undefined;
  const st = isObj(stLog?.standard) ? stLog.standard : isObj(stLog?.extended) ? stLog.extended : undefined;
  if (st && Array.isArray(st.table)) {
    const rows: SelfTestRow[] = [];
    for (const e of st.table.slice(0, MAX_SELF_TEST_ROWS)) {
      if (!isObj(e)) continue;
      const status = isObj(e.status) ? e.status : {};
      const type = isObj(e.type) ? safeLabel(e.type.string, 48) : "";
      const value = num(status.value);
      const row: SelfTestRow = {
        status: safeLabel(status.string, 48),
        nibble: value === undefined ? null : value >> 4,
      };
      if (type) row.type = type;
      if (typeof status.passed === "boolean") row.passed = status.passed;
      const life = num(e.lifetime_hours);
      if (life !== undefined) row.lifetime = life;
      const lba = num(e.lba);
      if (lba !== undefined) row.lba = lba;
      rows.push(row);
    }
    if (rows.length > 0) d.selfTest = rows;
    const errs = num(st.error_count_total);
    if (errs !== undefined) d.selfTestErrorCount = errs;
  }

  const grown = num(o.scsi_grown_defect_list);
  if (grown !== undefined) d.grownDefects = grown;

  if (isObj(o.smart_support)) {
    if (o.smart_support.available === false) d.smartSupport = "unavailable";
    else if (o.smart_support.enabled === false) d.smartSupport = "disabled";
    else if (o.smart_support.available === true) d.smartSupport = "available";
  }
  if (Array.isArray(envelope?.messages)) {
    for (const m of envelope.messages.slice(0, 32)) {
      if (isObj(m) && typeof m.string === "string") applyMessage(d, m.string.slice(0, MAX_LINE));
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Text

const SELF_TEST_STATUSES: ReadonlyArray<[string, number]> = [
  ["Completed without error", 0x0],
  ["Aborted by host", 0x1],
  ["Interrupted (host reset)", 0x2],
  ["Fatal or unknown error", 0x3],
  ["Completed: unknown failure", 0x4],
  ["Completed: electrical failure", 0x5],
  ["Completed: servo/seek failure", 0x6],
  ["Completed: read failure", 0x7],
  ["Completed: handling damage??", 0x8],
  ["Self-test routine in progress", 0xf],
];

/** A self-test log row is under 120 characters; the row regex is quadratic in a longer one (R1-36). */
const MAX_SELF_TEST_LINE = 256;

function parseSelfTestRow(line: string): SelfTestRow | null {
  if (line.length > MAX_SELF_TEST_LINE) return null;
  const m = SELF_TEST_ROW_RE.exec(line);
  if (!m) return null;
  const middle = m[2];
  let type = "";
  let status = "";
  let nibble: number | null = null;
  for (const [phrase, code] of SELF_TEST_STATUSES) {
    const at = middle.indexOf(phrase);
    if (at < 0) continue;
    type = middle.slice(0, at).trim();
    status = phrase;
    nibble = code;
    break;
  }
  if (!status) {
    const parts = middle.split(/\s{2,}/);
    type = parts[0] ?? "";
    status = parts.slice(1).join(" ") || "unknown";
  }
  const row: SelfTestRow = { status: safeLabel(status, 48), nibble };
  if (type) row.type = safeLabel(type, 48);
  // smartmontools marks passed only for a clean completion and failed for
  // the completed-with-failure codes; aborts and fatal errors carry neither.
  if (nibble === 0) row.passed = true;
  else if (nibble !== null && nibble >= 4 && nibble <= 8) row.passed = false;
  row.lifetime = Number(m[4]);
  const lba = m[5];
  if (/^\d{1,16}$/.test(lba)) row.lba = Number(lba);
  else if (/^0x[0-9a-fA-F]{1,14}$/.test(lba)) row.lba = parseInt(lba.slice(2), 16);
  return row;
}

/** Lines that can only come from smartctl, so they may open a device block on their own. */
function isStrongLine(line: string): boolean {
  return (
    HEALTH_ATA_RE.test(line) ||
    HEALTH_SCSI_RE.test(line) ||
    NVME_LOG_RE.test(line) ||
    ATTR_HEADER_RE.test(line) ||
    SMART_SUPPORT_RE.test(line) ||
    (ATTR_ROW_RE.test(line) && /\s0x[0-9a-fA-F]{4}\s/.test(line) && /\s(?:Pre-fail|Old_age)\s/.test(line)) ||
    /^\s*(?:Device Model|Model Family|Critical Warning|Percentage Used|Available Spare Threshold|Media and Data Integrity Errors)\s*:/.test(line) ||
    USB_BRIDGE_RE.test(line) ||
    OPEN_FAILED_RE.test(line) ||
    CONTROLLER_HINT_RE.test(line) ||
    PLEASE_SPECIFY_RE.test(line) ||
    IDENTITY_FAILED_RE.test(line) ||
    SMART_DISABLED_RE.test(line)
  );
}

function applyKeyValue(d: DeviceRead, rawKey: string, value: string): boolean {
  const key = rawKey.toLowerCase().replace(/\s+/g, " ").trim();
  switch (key) {
    case "device model":
    case "model number":
      d.model = value;
      return true;
    case "model family":
      d.family = value;
      return true;
    case "vendor":
      d.vendor = value;
      return true;
    case "product":
      d.product = value;
      return true;
    case "serial number":
      d.serial = value;
      return true;
    case "firmware version":
      d.firmware = value;
      return true;
    case "revision":
      if (!d.firmware) d.firmware = value;
      return true;
    case "user capacity":
    case "total nvm capacity": {
      const n = groupedInt(value);
      if (n !== undefined) d.capacityBytes = n;
      return true;
    }
    case "namespace 1 size/capacity": {
      const n = groupedInt(value);
      if (n !== undefined && d.capacityBytes === undefined) d.capacityBytes = n;
      return true;
    }
    case "smart support is":
      if (/^Unavailable/i.test(value)) d.smartSupport = "unavailable";
      else if (/^Disabled/i.test(value)) d.smartSupport = "disabled";
      else if (/^(?:Available|Enabled)/i.test(value) && d.smartSupport === undefined) d.smartSupport = "available";
      if (OPTICAL_RE.test(value)) d.optical = true;
      return true;
    case "device type":
      if (/CD\/DVD|optical/i.test(value)) d.optical = true;
      return true;
    case "current drive temperature": {
      const t = plausibleTemp(groupedInt(value));
      if (t !== undefined && /^\d+\s*C\b/.test(value)) d.temperature = t;
      return true;
    }
    case "current temperature": {
      const t = plausibleTemp(groupedInt(value));
      if (t !== undefined && /Celsius/i.test(value)) d.sctTemperature = t;
      return true;
    }
    case "elements in grown defect list": {
      const n = groupedInt(value);
      if (n !== undefined) d.grownDefects = n;
      return true;
    }
    case "critical warning": {
      const m = /^0x([0-9a-fA-F]{1,2})\b/.exec(value);
      if (m) {
        d.nvme.critical_warning = parseInt(m[1], 16);
        d.nvmeSeen = true;
      }
      return true;
    }
    case "temperature": {
      const m = /^(\d{1,3})\s*Celsius/i.exec(value);
      if (m && (d.inNvmeLog || d.nvmeSeen)) {
        const t = plausibleTemp(Number(m[1]));
        if (t !== undefined) d.nvme.temperature = t;
      }
      return true;
    }
    case "available spare":
    case "available spare threshold":
    case "percentage used": {
      const m = /^(\d{1,3})%/.exec(value);
      if (m) {
        const n = Number(m[1]);
        if (key === "available spare") d.nvme.available_spare = n;
        else if (key === "available spare threshold") d.nvme.available_spare_threshold = n;
        else d.nvme.percentage_used = n;
        d.nvmeSeen = true;
      }
      return true;
    }
    case "power on hours": {
      const n = groupedInt(value);
      if (n !== undefined) d.nvme.power_on_hours = n;
      return true;
    }
    case "media and data integrity errors":
    case "error information log entries": {
      const n = groupedInt(value);
      if (n !== undefined) {
        if (key === "media and data integrity errors") d.nvme.media_errors = n;
        else d.nvme.num_err_log_entries = n;
        d.nvmeSeen = true;
      }
      return true;
    }
    default:
      return false;
  }
}

/** One line of a device block. */
function applyLine(d: DeviceRead, line: string): void {
  if (line.trim() === "") {
    d.inAttrTable = false;
    d.inSelfTest = false;
    d.inNvmeLog = false;
    return;
  }
  const ata = HEALTH_ATA_RE.exec(line);
  if (ata) {
    d.healthSeen = true;
    d.hasContent = true;
    if (/^PASSED\b/.test(ata[1])) d.health = "PASSED";
    else if (/^FAILED/.test(ata[1])) d.health = "FAILED";
    return;
  }
  const scsi = HEALTH_SCSI_RE.exec(line);
  if (scsi) {
    d.healthSeen = true;
    d.hasContent = true;
    d.health = /^OK\b/.test(scsi[1]) ? "PASSED" : "FAILED";
    return;
  }
  if (NVME_LOG_RE.test(line)) {
    d.inNvmeLog = true;
    d.nvmeSeen = true;
    d.hasContent = true;
    return;
  }
  if (ATTR_HEADER_RE.test(line)) {
    d.inAttrTable = true;
    d.hasContent = true;
    return;
  }
  if (SELF_TEST_HEADER_RE.test(line)) {
    d.inSelfTest = true;
    d.selfTest = [];
    return;
  }
  if (d.inSelfTest) {
    const row = parseSelfTestRow(line);
    if (row) {
      if (d.selfTest && d.selfTest.length < MAX_SELF_TEST_ROWS) d.selfTest.push(row);
      return;
    }
  }
  const attr = ATTR_ROW_RE.exec(line);
  if (attr) {
    const brief = !attr[3].startsWith("0x");
    const tail = (brief ? ATTR_BRIEF_TAIL_RE : ATTR_OLD_TAIL_RE).exec(attr[7]);
    // Brief rows only inside the table; full rows carry enough structure
    // (flag word, Pre-fail/Old_age) to be read even from a grep.
    if (tail && (!brief || d.inAttrTable)) {
      const id = Number(attr[1]);
      const name = attr[2];
      const rawText = tail[1];
      if (!d.attrs.has(id)) {
        d.attrs.set(id, {
          id,
          name,
          value: attr[4] === "---" ? null : Number(attr[4]),
          worst: attr[5] === "---" ? null : Number(attr[5]),
          thresh: attr[6] === "---" ? null : Number(attr[6]),
          raw: rawFromText(rawText),
        });
      }
      if (id === 9) d.powerOnRaw = { name, raw: rawText };
      d.hasContent = true;
      return;
    }
  }
  const poh = POWER_ON_SCSI_RE.exec(line);
  if (poh) {
    d.powerOnHours = Number(poh[1]);
    return;
  }
  if (applyMessage(d, line)) {
    d.hasContent = true;
    return;
  }
  const kv = KV_RE.exec(line);
  if (kv && applyKeyValue(d, kv[1], kv[2].trim())) d.hasContent = true;
}

/** Text device blocks, split on prompts, smartctl banners, repeated sections and loop headers. */
function parseText(text: string): DeviceRead[] {
  const lines = text.split("\n");
  const reads: DeviceRead[] = [];
  let sectionDevices: DevRef[] = [];
  let sectionBlocks: DeviceRead[] = [];
  let cur: DeviceRead | null = null;
  let pendingHint: string | undefined;
  let offset = 0;

  // A command that named N devices and produced exactly N blocks maps them in
  // order; any other count is ambiguous and leaves the blocks unnamed.
  const closeSection = () => {
    const blocks = sectionBlocks.filter((b) => b.hasContent);
    if (sectionDevices.length > 0 && blocks.length === sectionDevices.length) {
      blocks.forEach((b, i) => {
        if (!b.path) setPath(b, sectionDevices[i].path, sectionDevices[i].type);
      });
    }
    sectionDevices = [];
    sectionBlocks = [];
  };
  const startBlock = (at: number): DeviceRead => {
    const d = newRead(at);
    if (pendingHint) setPath(d, pendingHint);
    pendingHint = undefined;
    if (reads.length < MAX_DEVICES) reads.push(d);
    sectionBlocks.push(d);
    return d;
  };

  for (let i = 0; i < lines.length; i++) {
    const at = offset;
    offset += lines[i].length + 1;
    if (lines[i].length > MAX_LINE) continue;
    const line = lines[i].replace(ANSI_RE, "");

    const cmd = promptCommand(line);
    if (cmd !== null) {
      closeSection();
      cur = null;
      pendingHint = undefined;
      sectionDevices = commandDevices(cmd);
      continue;
    }
    const header = headerPath(lines, i);
    if (header) {
      cur = null;
      pendingHint = header;
      continue;
    }
    if (BANNER_RE.test(line)) {
      if (cur?.hasContent) cur = null;
      cur ??= startBlock(at);
      cur.hasContent = true;
      continue;
    }
    if (INFO_SECTION_RE.test(line)) {
      if (cur?.infoSeen) cur = null;
      cur ??= startBlock(at);
      cur.infoSeen = true;
      cur.hasContent = true;
      continue;
    }
    if (DATA_SECTION_RE.test(line)) {
      if (cur?.dataSeen) cur = null;
      cur ??= startBlock(at);
      cur.dataSeen = true;
      cur.hasContent = true;
      continue;
    }
    if (COMMAND_NOT_FOUND_RE.test(line)) {
      // One line per invocation: each is its own block so a loop over N
      // named devices maps one-to-one.
      const d = startBlock(at);
      d.commandNotFound = true;
      d.hasContent = true;
      cur = null;
      continue;
    }
    if (!cur) {
      if (line.trim() === "" || !isStrongLine(line)) continue;
      cur = startBlock(at);
    }
    if (!cur.path) {
      const inline = INLINE_DEVICE_RE.exec(line);
      if (inline && (USB_BRIDGE_RE.test(line) || PLEASE_SPECIFY_RE.test(line) || CONTROLLER_HINT_RE.test(line) || /requires option/i.test(line))) {
        setPath(cur, inline[1]);
      }
    }
    applyLine(cur, line);
  }
  closeSection();

  for (const d of reads) {
    if (d.powerOnRaw && d.powerOnHours === undefined) {
      const h = powerOnHoursFromAttr(d.powerOnRaw.name, d.powerOnRaw.raw);
      if (h !== undefined) d.powerOnHours = h;
    }
    if (d.temperature === undefined) {
      const t194 = d.attrs.get(194);
      const t190 = d.attrs.get(190);
      const fromAttr = (a: AttrRow | undefined) =>
        a && /temp/i.test(a.name) && a.raw !== null ? plausibleTemp(a.raw > 0xffff ? undefined : a.raw) : undefined;
      const t = d.sctTemperature ?? fromAttr(t194) ?? fromAttr(t190);
      if (t !== undefined) d.temperature = t;
    }
    if (d.nvme.power_on_hours !== undefined && d.powerOnHours === undefined) d.powerOnHours = d.nvme.power_on_hours;
  }
  return reads.filter((d) => d.hasContent);
}

// ---------------------------------------------------------------------------
// From reads to snapshot entries

function hasSurface(d: DeviceRead): boolean {
  return d.healthSeen || d.nvmeSeen || d.attrs.size > 0;
}

/** A guest's virtual disk with no SMART: the physical disks are on the host. */
function isHypervisorDisk(d: DeviceRead): boolean {
  if (d.path && HYPERVISOR_PATH_RE.test(d.path)) return true;
  const ident = [d.model, d.family, d.vendor, d.product].filter(Boolean).join(" ");
  return ident !== "" && HYPERVISOR_DISK_RE.test(ident);
}

function isVirtualMedia(d: DeviceRead): boolean {
  if (d.capacityBytes === 0) return true;
  if (d.usbVendor && BMC_USB_VENDORS.has(d.usbVendor)) return true;
  const ident = [d.model, d.family, d.vendor, d.product].filter(Boolean).join(" ");
  return ident !== "" && VIRTUAL_MEDIA_RE.test(ident);
}

/** Same device seen twice in one paste (`-i` then `-A`, or text and JSON): later values win. */
function mergeReads(a: DeviceRead, b: DeviceRead): DeviceRead {
  const out: DeviceRead = { ...a };
  for (const [k, v] of Object.entries(b) as Array<[keyof DeviceRead, unknown]>) {
    if (v === undefined || k === "offset" || k === "attrs" || k === "nvme") continue;
    if (typeof v === "boolean") (out as unknown as Record<string, unknown>)[k] = Boolean(a[k]) || v;
    else (out as unknown as Record<string, unknown>)[k] = v;
  }
  out.attrs = new Map([...a.attrs, ...b.attrs]);
  out.nvme = { ...a.nvme, ...b.nvme };
  if (b.health === undefined && a.health !== undefined) out.health = a.health;
  out.offset = Math.min(a.offset, b.offset);
  return out;
}

/** Serial numbers and firmware revisions are single tokens; anything after the first is not part of them. */
function firstToken(value: string | undefined): string | undefined {
  return value?.trim().split(/\s+/)[0];
}

function serialOf(d: DeviceRead): string {
  return safeIdent(firstToken(d.serial), 40);
}

// Attributes smartctl's drive database names for an SSD's life remaining.
const LIFE_LEFT_NAME_RE =
  /^(?:SSD_Life_Left|Percent_Lifetime_Remain|Wear_Leveling_Count|Media_Wearout_Indicator|Remaining_Lifetime_Perc|Perc_Rated_Life_Remain|Percent_Life_Remaining)$/i;
// Crucible's generic wear names, and the counters they also match
// (Lifetime_Writes_GiB, Host_Writes_GiB, NAND_GB_Written_TLC).
const WEAR_NAME_RE = /wear.?level|wearout|life.?left|life.?time|percent.?life|ssd.?life|endurance/;
const WEAR_COUNTER_RE = /writes|reads|written|gib|_gb\b|_mb\b|lbas/;
// smartctl's name for an attribute its drive database does not know.
const UNNAMED_ATTR_RE = /^(?:Unknown_(?:SSD_)?Attribute)?$/i;

/**
 * WD Blue / Red / Green SATA SSDs. Their 230 Media_Wearout_Indicator counts
 * up from 0 on some firmware and down from 100 on others, and smartctl gives
 * it no defined meaning, so it says nothing reliable about wear (R2-2).
 */
function isWdSataSsd(d: DeviceRead): boolean {
  return /\bWD Blue \/ Red \/ Green SSDs\b/i.test(d.family ?? "") || /^WDC\s+WDS/i.test(d.model ?? "");
}

/** Crucible's parseSmartctlJson field mapping, applied to a read from either format. */
function toSmartEntry(d: DeviceRead, device: string): SmartEntry {
  // ATA and NVMe print a model; SCSI prints vendor and product, which
  // smartctl's own JSON joins into model_name.
  const vendorProduct = d.vendor && d.product ? `${d.vendor} ${d.product}` : d.product;
  const model = safeLabel(d.model ?? vendorProduct, 40) || safeLabel(d.family, 64) || "unknown";
  const entry: SmartEntry = { device, model, health: d.health ?? "" };
  const serial = serialOf(d);
  if (serial) entry.serial = serial;
  const firmware = safeIdent(firstToken(d.firmware), 16);
  if (firmware) entry.firmware = firmware;
  if (d.passthroughType && d.path) {
    entry.transport = d.passthroughType.split(",")[0].replace(/^sat\+/, "");
    entry.backing_device = d.path;
  }
  if (d.temperature !== undefined) entry.temperature_c = d.temperature;
  if (d.powerOnHours !== undefined) entry.power_on_hours = d.powerOnHours;

  if (d.nvmeSeen) {
    const n = d.nvme;
    if (n.percentage_used !== undefined) entry.percentage_used = n.percentage_used;
    if (n.temperature !== undefined) entry.temperature_c = n.temperature;
    if (n.critical_warning !== undefined) {
      entry.critical_warning_raw = n.critical_warning;
      entry.critical_warning_decoded = decodeNvmeCriticalWarning(n.critical_warning);
    }
    if (n.available_spare !== undefined) entry.nvme_available_spare = n.available_spare;
    if (n.available_spare_threshold !== undefined) entry.nvme_available_spare_threshold = n.available_spare_threshold;
    if (n.media_errors !== undefined) entry.media_errors = n.media_errors;
    if (n.num_err_log_entries !== undefined) entry.num_err_log_entries = n.num_err_log_entries;
  }

  if (d.attrs.size > 0) {
    // SATA SSD wear: a life attribute's normalized VALUE is life remaining.
    // An attribute smartctl names for life remaining decides it; the generic
    // name match and the 202/233/177/173 id fallback (Crucible smart.ts) are
    // read only when there is none. Ported as-is, the most-worn of every
    // candidate won, and a healthy SandForce drive (177 Wear_Range_Delta,
    // 233 SandForce_Internal and 241 Lifetime_Writes_GiB always 000, 231
    // SSD_Life_Left 100) or a WD Blue whose 230 counts up read as 98-100%
    // worn, a critical "replace immediately" (R2-2). So the id fallback
    // covers attributes smartctl could not name, counters are never wear, an
    // attribute whose VALUE, WORST and THRESH are all 0 is not reported as a
    // percentage, and a WD Blue / Red / Green SSD's 230 is not read at all.
    let explicitUsed: number | null = null;
    let genericUsed: number | null = null;
    const wdSsd = isWdSataSsd(d);
    const modelStr = `${d.model ?? ""} ${d.family ?? ""} ${d.vendor ?? ""}`.toLowerCase();
    const isSeagate = /seagate|\bst\d{3,}/.test(modelStr);
    for (const a of d.attrs.values()) {
      const raw = a.raw;
      if (raw !== null) {
        if (a.id === 5 || a.name === "Reallocated_Sector_Ct") entry.reallocated_sectors = raw;
        if (a.id === 197 || a.name === "Current_Pending_Sector") entry.pending_sectors = raw;
        if (a.id === 187 || a.name === "Reported_Uncorrect") entry.reported_uncorrectable = raw;
        if (a.id === 188 || a.name === "Command_Timeout") entry.command_timeout = isSeagate ? unpackSeagateCounter(raw) : raw;
        // 189 is name-gated: on some SATA SSDs id 189 is a health-flags bitfield.
        if (a.name === "High_Fly_Writes") entry.high_fly_writes = raw;
        if (a.id === 10 || a.name === "Spin_Retry_Count") entry.spin_retries = raw;
        if (a.id === 196 || a.name === "Reallocated_Event_Count") entry.reallocation_events = raw;
        if (a.id === 198 || a.name === "Offline_Uncorrectable") entry.offline_uncorrectable = raw;
        if (a.id === 199 || a.name === "UDMA_CRC_Error_Count") entry.udma_crc_errors = raw;
      }
      const name = a.name.toLowerCase();
      if (a.value === null || name.includes("temp")) continue;
      if (a.value === 0 && a.worst === 0 && a.thresh === 0) continue;
      if (wdSsd && a.id === 230) continue;
      const used = Math.min(100, Math.max(0, 100 - a.value));
      if (LIFE_LEFT_NAME_RE.test(a.name)) {
        if (explicitUsed === null || used > explicitUsed) explicitUsed = used;
        continue;
      }
      const isWearName = WEAR_NAME_RE.test(name) && !WEAR_COUNTER_RE.test(name);
      const isWearId = (a.id === 202 || a.id === 233 || a.id === 177 || a.id === 173) && UNNAMED_ATTR_RE.test(a.name);
      if ((isWearName || isWearId) && (genericUsed === null || used > genericUsed)) genericUsed = used;
    }
    const wearUsed = explicitUsed ?? genericUsed;
    if (wearUsed !== null && entry.percentage_used === undefined) entry.percentage_used = wearUsed;
  }

  // Self-test summary: newest entry, plus the newest FAILED one (status high
  // nibble 3..8) kept separately so a later passing short test cannot mask it.
  if (d.selfTest && d.selfTest.length > 0) {
    const newest = d.selfTest[0];
    const failed = d.selfTest.find((r) => r.nibble !== null && r.nibble >= 3 && r.nibble <= 8);
    const st: SelfTestSummary = { last_status: newest.status || "unknown" };
    if (newest.type) st.last_type = newest.type;
    if (newest.passed !== undefined) st.last_passed = newest.passed;
    if (newest.lifetime !== undefined) st.last_lifetime_hours = newest.lifetime;
    if (failed) {
      if (failed.lifetime !== undefined) st.last_failed_lifetime_hours = failed.lifetime;
      if (failed.lba !== undefined) st.last_failed_lba = failed.lba;
    }
    if (d.selfTestErrorCount !== undefined) st.error_count_total = d.selfTestErrorCount;
    entry.self_test = st;
  }
  return entry;
}

type Outcome =
  | { kind: "drive"; read: DeviceRead }
  | { kind: "unreadable"; read: DeviceRead; reason: "no_smart_data" | "no_smartctl_output" }
  | { kind: "skip" };

function classify(d: DeviceRead, c: Counters): Outcome {
  if (hasSurface(d)) return { kind: "drive", read: d };
  if (d.commandNotFound) {
    if (d.path) return { kind: "unreadable", read: d, reason: "no_smartctl_output" };
    c.missingToolUnnamed++;
    return { kind: "skip" };
  }
  if (isVirtualMedia(d)) c.virtualMedia++;
  else if (isHypervisorDisk(d)) c.hypervisorDisk++;
  else if (d.path && SOFTWARE_BLOCK_PATH_RE.test(d.path)) c.softwareBlock++;
  else if (d.optical) c.optical++;
  else if (d.usbBridge) c.usbBridge++;
  else if (d.permissionDenied) c.permission++;
  else if (d.noSuchDevice) c.noDevice++;
  else if (d.unsupportedType) c.unsupported++;
  else if (d.smartDisabled || d.smartSupport === "disabled") c.disabled++;
  else if (d.controllerNeedsType || d.pleaseSpecify || d.smartSupport === "unavailable" || d.identityFailed) {
    if (d.identityFailed && !d.controllerNeedsType && !d.pleaseSpecify) c.identityFailed++;
    return { kind: "unreadable", read: d, reason: "no_smart_data" };
  } else if (d.model || d.family || d.serial || d.vendor || d.product) c.identityOnly++;
  return { kind: "skip" };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function buildNotes(c: Counters, subjects: number): ParseNote[] {
  const notes: ParseNote[] = [];
  const info = (message: string) => notes.push({ level: "info", message });
  const warn = (message: string) => notes.push({ level: "warning", message });
  if (c.unknownDevice === 1) {
    info("1 drive has no device path in the paste and is labeled unknown-device: identify it by serial number before acting.");
  } else if (c.unknownDevice > 1) {
    info(`${c.unknownDevice} drives have no device path in the paste and are labeled unknown-device-N by their order among the drives in the paste: identify them by serial number before acting.`);
  }
  if (c.healthUnknown > 0) {
    info(`${c.healthUnknown} ${plural(c.healthUnknown, "drive has", "drives have")} no overall-health verdict in the paste, so only the counters shown were checked: smartctl -H or -a output includes the verdict.`);
  }
  if (c.virtualMedia > 0) {
    info(`Skipped ${c.virtualMedia} BMC virtual media ${plural(c.virtualMedia, "device", "devices")}: virtual drives presented by the server's management controller are not disks and never report SMART.`);
  }
  if (c.hypervisorDisk > 0) {
    info(`Skipped ${c.hypervisorDisk} virtual ${plural(c.hypervisorDisk, "disk", "disks")} presented by a hypervisor: ${plural(c.hypervisorDisk, "it has", "they have")} no SMART. Check the physical disks on the host instead.`);
  }
  if (c.softwareBlock > 0) {
    info(`Skipped ${c.softwareBlock} software or virtual block ${plural(c.softwareBlock, "device", "devices")} (md RAID, device-mapper or LVM, loop, zvol and similar): they have no SMART. Run smartctl on the member disks; lsblk -s lists them.`);
  }
  if (c.sharedSerial > 0) {
    info(`${c.sharedSerial} ${plural(c.sharedSerial, "drive shares", "drives share")} a serial number with another drive in the paste (for example the same redaction placeholder) and ${plural(c.sharedSerial, "was", "were")} counted as a separate drive.`);
  }
  if (c.usbBridge > 0) {
    info(`Skipped ${c.usbBridge} ${plural(c.usbBridge, "device", "devices")} behind a USB bridge smartctl did not recognize; that is not a drive failure. To read SMART through the bridge, retry with smartctl -d sat.`);
  }
  if (c.optical > 0) info(`Skipped ${c.optical} optical ${plural(c.optical, "drive", "drives")}: they do not report SMART.`);
  if (c.unsupported > 0) {
    info(`Skipped ${c.unsupported} ${plural(c.unsupported, "device", "devices")} whose device type smartctl does not support; not counted as failed.`);
  }
  if (c.permission > 0) {
    warn(`smartctl was denied access to ${c.permission} ${plural(c.permission, "device", "devices")}: run it with sudo and paste the output again.`);
  }
  if (c.noDevice > 0) info(`smartctl reported ${c.noDevice} device ${plural(c.noDevice, "path", "paths")} as not present on the host.`);
  if (c.disabled > 0) {
    warn(`SMART is disabled on ${c.disabled} ${plural(c.disabled, "device", "devices")}, so no health data was read: enable it with smartctl -s on and paste the output again.`);
  }
  if (c.identityOnly > 0) {
    info(`${c.identityOnly} ${plural(c.identityOnly, "device shows", "devices show")} identity information only (smartctl -i): paste smartctl -a or smartctl -x output to check health.`);
  }
  if (c.missingToolUnnamed > 0) {
    warn("smartctl is not installed on this host (command not found): install the smartmontools package and paste the output again.");
  }
  if (c.identityFailed > 0) {
    warn(`smartctl could not complete identify or SMART commands on ${c.identityFailed} ${plural(c.identityFailed, "device", "devices")}. A drive that stops answering commands can be failing: check dmesg for I/O errors on it.`);
  }
  if (c.vdSuppressed > 0) {
    info(`${c.vdSuppressed} RAID controller virtual ${plural(c.vdSuppressed, "disk", "disks")} without SMART ${plural(c.vdSuppressed, "was", "were")} not flagged: the physical drives behind the controller were read in the same paste.`);
  }
  if (c.grownDefectDrives > 0) {
    warn(`${c.grownDefectDrives} SAS ${plural(c.grownDefectDrives, "drive reports", "drives report")} a non-empty grown defect list (${c.grownDefectTotal} ${plural(c.grownDefectTotal, "entry", "entries")} in total). Glassmkr's rules do not evaluate this SCSI counter, so it raised no finding on its own.`);
  }
  // A failed self-test and held pending sectors are the strongest evidence in
  // the most common failing-disk paste (health PASSED, nothing reallocated),
  // and no rule reads either, so the answer said only "no rule matched" (R2-3).
  // The status is the smartmontools phrase for the status code, not paste text.
  if (c.failedSelfTestDrives > 0 && c.failedSelfTest) {
    const f = c.failedSelfTest;
    const status = SELF_TEST_STATUSES.find(([, code]) => code === f.nibble)?.[0] ?? "failed";
    const where = [f.lba !== undefined ? `at LBA ${f.lba}` : "", f.hours !== undefined ? `${f.hours} power-on hours` : ""].filter(Boolean).join(", ");
    const lead = c.failedSelfTestDrives === 1 ? "1 drive records" : `${c.failedSelfTestDrives} drives record`;
    const which = c.failedSelfTestDrives === 1 ? "newest failure" : "the first one's newest failure";
    warn(`${lead} a failed SMART self-test (${which}: "${status}"${where ? ` ${where}` : ""}). No Glassmkr rule evaluates the self-test log, so it raised no finding on its own.`);
  }
  if (c.pendingDrives > 0) {
    const lead = c.pendingDrives === 1
      ? `1 drive reports ${c.maxPending} pending and ${c.maxOfflineUncorrectable} offline-uncorrectable sectors (SMART 197/198)`
      : `${c.pendingDrives} drives report pending or offline-uncorrectable sectors (SMART 197/198; highest ${c.maxPending} pending, ${c.maxOfflineUncorrectable} offline-uncorrectable)`;
    warn(`${lead}. Glassmkr judges these over days of readings, so one paste raised no finding on its own.`);
  }
  if (c.truncatedJson > 0) {
    warn(`${c.truncatedJson} smartctl JSON ${plural(c.truncatedJson, "block was", "blocks were")} cut off: only the fields before the cut were read.`);
  }
  if (c.unreadableJson > 0) warn(`${c.unreadableJson} smartctl JSON ${plural(c.unreadableJson, "block", "blocks")} could not be read.`);
  if (c.budgetHit) warn("Part of the paste was not scanned for smartctl JSON: it holds too many JSON-like lines.");
  if (c.deviceCapHit) warn(`Only the first ${MAX_DEVICES} drive reads in this paste were read.`);
  if (c.wdWearUnread > 0) {
    info(`${c.wdWearUnread} WD Blue, Red or Green ${plural(c.wdWearUnread, "SSD reports", "SSDs report")} attribute 230 (Media_Wearout_Indicator), which counts up on some firmware and down on others, so it was not read as wear: wear is not determinable from this paste.`);
  }
  if (subjects === 0 && notes.length === 0) info("No smartctl device output was recognized in this paste.");
  return notes;
}

function emptyResult(note: string): ParserResult {
  return { domain: "smart", formats: [], snapshot: {}, subjects: 0, notes: [{ level: "info", message: note }] };
}

function parseSmartctl(input: string): ParserResult {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const counters: Counters = {
    virtualMedia: 0,
    usbBridge: 0,
    optical: 0,
    permission: 0,
    noDevice: 0,
    unsupported: 0,
    disabled: 0,
    identityOnly: 0,
    missingToolUnnamed: 0,
    identityFailed: 0,
    healthUnknown: 0,
    unknownDevice: 0,
    truncatedJson: 0,
    unreadableJson: 0,
    grownDefectDrives: 0,
    grownDefectTotal: 0,
    failedSelfTestDrives: 0,
    pendingDrives: 0,
    maxPending: 0,
    maxOfflineUncorrectable: 0,
    vdSuppressed: 0,
    hypervisorDisk: 0,
    softwareBlock: 0,
    sharedSerial: 0,
    budgetHit: false,
    deviceCapHit: false,
    wdWearUnread: 0,
  };
  const formats: TriageFormat[] = [];

  const { values, masked } = extractJson(text, counters);
  const reads: DeviceRead[] = [];
  // MAX_DEVICES bounds the whole paste, not each JSON value: one small value
  // per line made 10,000 drives, and rules that join other output against
  // every drive cost the product of the two (R2-11).
  for (const v of values) {
    const docs = Array.isArray(v.value) ? v.value : [v.value];
    let any = false;
    for (const doc of docs) {
      if (!isObj(doc) || !isSmartctlJson(doc)) continue;
      if (reads.length >= MAX_DEVICES) {
        counters.deviceCapHit = true;
        break;
      }
      reads.push(readJsonDevice(doc, v.offset, v.truncated));
      any = true;
    }
    if (any && v.truncated) counters.truncatedJson++;
  }
  if (reads.length > 0) formats.push("smartctl_json");
  const textReads = parseText(masked);
  if (textReads.length > 0) formats.push("smartctl_text");
  reads.push(...textReads);
  reads.sort((a, b) => a.offset - b.offset);
  if (reads.length > MAX_DEVICES || textReads.length >= MAX_DEVICES) counters.deviceCapHit = true;
  if (reads.length > MAX_DEVICES) reads.length = MAX_DEVICES;

  // Merge repeated reads of one device: same path (and passthrough selector),
  // or the same serial when no path is known. A serial alone only joins an
  // identity-only read (`-i`) to a data read: two reads that each carry SMART
  // data are two drives. Pastes with every serial replaced by one placeholder
  // otherwise merged a failing drive into a healthy one and reported nothing
  // (R1-11).
  const byKey = new Map<string, number>();
  const merged: DeviceRead[] = [];
  for (const d of reads) {
    const serial = serialOf(d);
    const key = d.path ? `path:${d.path}|${d.passthroughType ?? ""}` : serial ? `serial:${serial}` : null;
    let at = key ? byKey.get(key) : undefined;
    if (at !== undefined && !d.path && hasSurface(merged[at]) && hasSurface(d)) {
      counters.sharedSerial++;
      at = undefined;
    }
    if (at !== undefined) {
      merged[at] = mergeReads(merged[at], d);
    } else if (key && byKey.has(key)) {
      merged.push(d);
    } else {
      if (key) byKey.set(key, merged.length);
      merged.push(d);
    }
  }

  const outcomes = merged.map((d) => classify(d, counters));
  // Crucible's VD suppression: once physical drives behind a controller were
  // read, a direct device with no SMART surface is the controller's own
  // virtual disk, already covered by its members.
  const passthroughRead = outcomes.some((o) => o.kind === "drive" && o.read.passthroughType);
  const kept = outcomes.filter((o): o is Exclude<Outcome, { kind: "skip" }> => {
    if (o.kind === "skip") return false;
    if (o.kind === "unreadable" && o.reason === "no_smart_data" && passthroughRead && !o.read.passthroughType) {
      counters.vdSuppressed++;
      return false;
    }
    return true;
  });

  const unnamed = kept.filter((o) => !o.read.path).length;
  counters.unknownDevice = unnamed;
  const smart: SmartEntry[] = [];
  const unreadable: UnreadableEntry[] = [];
  kept.forEach((o, i) => {
    const d = o.read;
    const device = d.path
      ? d.passthroughType
        ? `${d.path}[${d.passthroughType}]`
        : d.path
      : unnamed === 1
        ? "unknown-device"
        : `unknown-device-${i + 1}`;
    if (o.kind === "unreadable") {
      unreadable.push({ device, reason: o.reason });
      return;
    }
    if (d.health === undefined) counters.healthUnknown++;
    if (d.grownDefects !== undefined && d.grownDefects > 0) {
      counters.grownDefectDrives++;
      counters.grownDefectTotal += d.grownDefects;
    }
    const entry = toSmartEntry(d, device);
    if (entry.percentage_used === undefined && isWdSataSsd(d) && d.attrs.has(230)) counters.wdWearUnread++;
    const failedTest = d.selfTest?.find((r) => r.nibble !== null && r.nibble >= 3 && r.nibble <= 8);
    if (failedTest && failedTest.nibble !== null) {
      counters.failedSelfTestDrives++;
      counters.failedSelfTest ??= { nibble: failedTest.nibble, lba: failedTest.lba, hours: failedTest.lifetime };
    }
    const pending = entry.pending_sectors ?? 0;
    const offline = entry.offline_uncorrectable ?? 0;
    if (pending > 0 || offline > 0) {
      counters.pendingDrives++;
      counters.maxPending = Math.max(counters.maxPending, pending);
      counters.maxOfflineUncorrectable = Math.max(counters.maxOfflineUncorrectable, offline);
    }
    smart.push(entry);
  });

  const snapshot: Partial<Snapshot> = {};
  if (smart.length > 0) snapshot.smart = smart;
  if (unreadable.length > 0) snapshot.smart_unreadable = unreadable;
  const subjects = smart.length + unreadable.length;
  // A rule is reported as checked only when some drive in the paste carried
  // its input: an HDD has no wear figure, and only NVMe has the critical
  // warning byte. drive_smart_unreadable judges every device that was read.
  const rules_checked = ["drive_smart_unreadable"];
  if (smart.length > 0) rules_checked.push("smart_failing");
  if (smart.some((e) => e.percentage_used !== undefined)) rules_checked.push("nvme_wear_high");
  if (smart.some((e) => e.critical_warning_decoded !== undefined)) rules_checked.push("nvme_critical_warning");
  return { domain: "smart", formats, snapshot, subjects, notes: buildNotes(counters, subjects), rules_checked };
}

export const smartctlParser: TriageParser = {
  domain: "smart",
  // Every rule that reads snap.smart / snap.smart_unreadable as a trigger.
  // disk_io_errors and raid_degraded only join SMART for identity.
  rules: ["smart_failing", "nvme_wear_high", "nvme_critical_warning", "drive_smart_unreadable"],
  notDeterminable: [
    {
      signal: "Pending and offline-uncorrectable sector trend (SMART 197/198)",
      reason: "One reading cannot show whether these counts are holding, rising or clearing (some firmware toggles the pending count between 0 and 1 on drives with no fault); Glassmkr judges them across days of readings, and one paste is a single point",
    },
    {
      signal: "Reallocated and reported-uncorrectable growth (SMART 5/187)",
      reason: "Growth is measured over 7 and 30 days of readings; one paste shows only the current count",
    },
    {
      signal: "UDMA CRC error growth (SMART 199)",
      reason: "This counter never resets, so it is judged by growth between readings, not by its lifetime total",
    },
    {
      signal: "Command timeout and high-fly-write bursts (SMART 188/189)",
      reason: "Needs the change between readings a week apart",
    },
    {
      signal: "NVMe media error growth",
      reason: "Needs a reading from a week earlier to compare against",
    },
    {
      signal: "Disks missing from the paste",
      reason: "A paste covers only the devices smartctl was run on; a disk that was skipped or dropped off the bus does not appear at all",
    },
  ],
  detect(text: string): boolean {
    try {
      return typeof text === "string" && DETECT_RE.test(text);
    } catch {
      return false;
    }
  },
  parse(text: string): ParserResult {
    if (typeof text !== "string") return emptyResult("No smartctl device output was recognized in this paste.");
    try {
      return parseSmartctl(text);
    } catch {
      return emptyResult("The smartctl output could not be read.");
    }
  },
};
