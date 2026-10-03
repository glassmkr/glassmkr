// nvidia_gpu paste triage: `nvidia-smi -q` (the full text query or any `-d`
// subset, one or many GPUs), `nvidia-smi nvlink --status`, and
// `nvidia-smi --query-gpu=... --format=csv` with its header row. Field
// mapping, throttle-reason labels and the NVLink up / inactive / down buckets
// are ported from Crucible src/collect/gpu.ts (NVIDIA_SMI_CSV_FIELDS,
// parseNvidiaSmiCsvRow, parseNvLinkStatus, enrichThrottleReasons); the npm
// agent package exports none of them, so the pure logic is copied here.
//
// Fields the paste does not show. The Snapshot GPU entry requires numbers a
// paste often lacks: `nvidia-smi -q -d PERFORMANCE` has no temperature or
// power, a CSV has only the columns someone picked, a long paste gets cut.
// A value nvidia-smi printed as N/A gets Crucible's own representation of
// "[N/A]" (0 for numbers, null for the nullable counters), so it behaves
// exactly as it would from the live agent. A value the paste does not contain
// at all gets one of two things, chosen per field by how every GPU rule reads
// it:
//   - NaN for temp_c, power_draw_w, power_limit_w, the corrected ECC counters
//     and the since-boot uncorrected counter. Each rule only compares these
//     with > / >= (false for NaN) or copies them into evidence, and
//     analyze.ts drops non-finite evidence, so a finding leaves the reading
//     out instead of showing an invented 0 (a -d PERFORMANCE paste can still
//     fire gpu_thermal_critical from its HW thermal slowdown; it no longer
//     reports "temp_c: 0").
//   - Crucible's 0 / null / "" / false / [] everywhere else, because NaN would
//     fire: gpu_uncorrected_ecc treats a NaN lifetime count as non-zero
//     (`=== 0` fails) and the PCIe idle gate treats NaN utilization as busy.
// The places where that 0 could still turn into a finding are closed here:
//   - PCIe: a generation or width pair counts only when the paste shows both
//     current and max; otherwise both are 0, which the rule reads as unknown.
//   - Load: the PCIe rule's idle gate needs utilization, power draw and power
//     limit (a value or N/A). If any line is missing, utilization_gpu_percent
//     is 0 so the GPU counts as idle. Nothing else reads that field.
//   - ECC: ecc_mode_current is true only when the paste does not show ECC as
//     disabled or N/A and shows at least one ECC counter, retired-page or
//     remapped-row number. Otherwise both ECC rules skip the GPU.
//   - VBIOS drift: if any GPU of a model has no VBIOS version in the paste,
//     every GPU of that model gets "", so a gap never reads as a second
//     version. A GPU with no product name gets "" too.
//   - NVLink: links come only from `Link N:` lines; no lines means [], never
//     down.
// A parser note says which readings were missing and for how many GPUs.
//
// Two mappings go beyond a field-for-field copy, both documented where made:
// "Pending Page Blacklist: Yes" (a flag, not a count) becomes 1, and on GPUs
// that report Retired Pages as N/A and Remapped Rows instead (Ampere and
// newer), the remapped-row counts fill the retired-page fields.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent, safeLabel } from "../sanitize";
import type { ParseNote, ParserResult, TriageFormat, TriageParser } from "../types";

type GpuSlice = NonNullable<Snapshot["gpu"]>;
type Tier1 = Extract<NonNullable<GpuSlice["tier1"]>, { available: true }>;
type SnapshotGpu = Tier1["gpus"][number];
type NvLinkBasic = SnapshotGpu["nvlink_links"][number];

/**
 * One reading from the paste: a number, null when nvidia-smi printed N/A
 * (or anything else that is not a number), undefined when the paste does
 * not show the field at all. The split drives the representation above,
 * the gates and the notes.
 */
type Reading = number | null | undefined;

interface RawGpu {
  index?: number;
  uuid?: string;
  name?: string;
  bdf?: string;
  vbios?: string;
  vramTotal?: Reading;
  vramUsed?: Reading;
  temp?: Reading;
  powerDraw?: Reading;
  powerLimit?: Reading;
  utilGpu?: Reading;
  utilMem?: Reading;
  clockGr?: Reading;
  clockSm?: Reading;
  clockMem?: Reading;
  pstate?: string;
  genCur?: Reading;
  genMax?: Reading;
  widthCur?: Reading;
  widthMax?: Reading;
  /** true Enabled, false Disabled, null N/A (ECC not supported). */
  eccMode?: boolean | null;
  eccCorrVol?: Reading;
  eccCorrAgg?: Reading;
  eccUncVol?: Reading;
  eccUncAgg?: Reading;
  retiredSbe?: Reading;
  retiredDbe?: Reading;
  retiredPending?: Reading;
  remapCorr?: Reading;
  remapUnc?: Reading;
  remapPending?: Reading;
  remapFailure?: boolean;
  fan?: Reading;
  reasons?: string[];
  links?: NvLinkBasic[];
  /** Which input produced the record first; for the unmatched-NVLink note. */
  source?: "query" | "csv" | "nvlink";
}

const RULES = [
  "gpu_uncorrected_ecc",
  "gpu_thermal_critical",
  "nvlink_link_down",
  "gpu_pcie_link_degraded",
  "gpu_power_cap_throttling",
  "gpu_driver_or_firmware_drift",
  "gpu_corrected_ecc_storm",
] as const;

// Not gpu_xid_critical: Xid events come from the kernel log, which the
// kernel_log parser owns. Not gpu_driver_unsafe_reboot: it needs lsmod and
// the modprobe blacklist, which nvidia-smi output never shows.

const NOT_DETERMINABLE = [
  {
    signal: "Corrected ECC error rate",
    reason: "Needs two readings hours apart; one paste shows only the counter totals",
  },
  {
    signal: "Retired-page or remapped-row growth",
    reason: "Needs repeated readings over days; one paste is a single point",
  },
  {
    signal: "Sustained thermal or power throttling",
    reason: "One paste shows which throttle reasons were active at that moment, not for how long",
  },
  {
    signal: "Intermittent NVLink drops",
    reason: "nvlink --status shows link state at one moment; a link that flaps between readings looks up",
  },
] as const;

// Crucible enrichThrottleReasons labels, in its order. Keys are the -q text
// labels (lowercased); the CSV column suffixes are mapped in CSV_REASON_SUFFIX.
const REASON_ORDER = [
  "gpu_idle",
  "applications_clocks_setting",
  "sw_power_cap",
  "hw_slowdown",
  "hw_thermal_slowdown",
  "hw_power_brake",
  "sw_thermal_slowdown",
  "sync_boost",
  "display_clock_setting",
] as const;

const QUERY_REASON_LABEL: Record<string, string> = {
  idle: "gpu_idle",
  "gpu idle": "gpu_idle",
  "applications clocks setting": "applications_clocks_setting",
  "sw power cap": "sw_power_cap",
  "hw slowdown": "hw_slowdown",
  "hw thermal slowdown": "hw_thermal_slowdown",
  "hw power brake slowdown": "hw_power_brake",
  "sw thermal slowdown": "sw_thermal_slowdown",
  "sync boost": "sync_boost",
  "display clock setting": "display_clock_setting",
  // driver 550 plural, same rename Crucible handles in the XML
  "display clocks setting": "display_clock_setting",
};

const CSV_REASON_SUFFIX: Record<string, string> = {
  gpu_idle: "gpu_idle",
  applications_clocks_setting: "applications_clocks_setting",
  sw_power_cap: "sw_power_cap",
  hw_slowdown: "hw_slowdown",
  hw_thermal_slowdown: "hw_thermal_slowdown",
  hw_power_brake_slowdown: "hw_power_brake",
  sw_thermal_slowdown: "sw_thermal_slowdown",
  sync_boost: "sync_boost",
  display_clock_setting: "display_clock_setting",
  display_clocks_setting: "display_clock_setting",
};

// NVML nvmlClocksThrottleReason* / nvmlClocksEventReason* bits, for the
// `clocks_event_reasons.active` (or `clocks_throttle_reasons.active`) column.
const REASON_BITS: ReadonlyArray<[number, string]> = [
  [0x1, "gpu_idle"],
  [0x2, "applications_clocks_setting"],
  [0x4, "sw_power_cap"],
  [0x8, "hw_slowdown"],
  [0x10, "sync_boost"],
  [0x20, "sw_thermal_slowdown"],
  [0x40, "hw_thermal_slowdown"],
  [0x80, "hw_power_brake"],
  [0x100, "display_clock_setting"],
];

const BANNER_RE = /={3,}\s*NVSMI LOG\s*={3,}/;
const GPU_HEADER_RE = /^GPU\s+((?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7])$/;
const GPU_HEADER_LINE_RE =
  /^[ \t]*GPU[ \t]+(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7][ \t]*\r?$/m;
// `Key<padding>: value`. The whitespace before the colon is what tells a -q
// line from a prompt (`root@host:~#`), a bus id or a kernel log line.
const KV_RE = /^(\S(?:.*?\S)?)\s+:(?:\s+(.*))?$/;
const PADDED_KV_RE = /\S {2,}:/;
const TOP_LEVEL_KEYS = new Set(["timestamp", "driver version", "cuda version", "attached gpus"]);
const NVLINK_GPU_RE = /^\s*GPU\s+(\d{1,3}):\s*(.*?)\s*\(UUID:\s*([^)]*?)\s*\)\s*$/;
const NVLINK_GPU_LINE_RE = /^[ \t]*GPU[ \t]+\d{1,3}:[^\n]*\(UUID:/m;
const NVLINK_LINK_RE = /^\s*Link\s+(\d{1,3}):\s*(.+?)\s*$/;
const NVLINK_LINK_LINE_RE = /^[ \t]*Link[ \t]+\d{1,3}:/m;
const DRIVER_FAIL_RE = /NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver/i;
const NO_DEVICES_RE = /^\s*No devices were found\s*$/m;
const CSV_NAME_RE = /^[a-z][a-z0-9_.]*$/;

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function reading(raw: string | undefined): Reading {
  if (raw === undefined) return undefined;
  const m = raw.trim().match(/^[-+]?\d+(?:\.\d+)?/);
  if (!m) return null; // N/A, [Not Supported], Unknown Error, ...
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Counts nvidia-smi sometimes prints as a flag: Yes means at least one. */
function countReading(raw: string | undefined): Reading {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (/^yes\b/i.test(v)) return 1;
  if (/^no\b/i.test(v)) return 0;
  return reading(v);
}

function isNa(v: string): boolean {
  return v === "" || /^\[?(n\/a|not supported|unknown error|unknown|insufficient permissions)\]?$/i.test(v);
}

function firstToken(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().split(/\s+/)[0] ?? "";
  return isNa(t) ? undefined : t;
}

function identValue(raw: string | undefined): string | undefined {
  const t = firstToken(raw);
  if (t === undefined) return undefined;
  return safeIdent(t) || undefined;
}

function uuidValue(raw: string | undefined): string | undefined {
  const t = firstToken(raw);
  if (t === undefined || !/^(?:GPU|MIG)-[0-9A-Za-z-]+$/.test(t)) return undefined;
  return safeIdent(t) || undefined;
}

function labelValue(raw: string | undefined): string | undefined {
  if (raw === undefined || isNa(raw.trim())) return undefined;
  return safeLabel(raw) || undefined;
}

function pstateValue(raw: string | undefined): string | undefined {
  const t = firstToken(raw);
  return t !== undefined && /^P\d{1,2}$/.test(t) ? t : undefined;
}

function eccModeValue(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (/^enabled\b/i.test(v)) return true;
  if (/^disabled\b/i.test(v)) return false;
  return null;
}

/** Sum of the readings seen: undefined if none, null if only N/A. */
function addReading(acc: Reading, n: Reading): Reading {
  if (n === undefined) return acc;
  if (n === null) return acc === undefined ? null : acc;
  return (typeof acc === "number" ? acc : 0) + n;
}

function normKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function leadingWidth(line: string): number {
  const ws = line.match(/^[ \t]*/)?.[0] ?? "";
  return ws.replace(/\t/g, "    ").length;
}

function bdfKey(bdf: string): string {
  return bdf.toLowerCase().replace(/^0{4}(?=[0-9a-f]{4}:)/, "");
}

function sortReasons(reasons: Iterable<string>): string[] {
  const set = new Set(reasons);
  return REASON_ORDER.filter((r) => set.has(r));
}

// ---------------------------------------------------------------------------
// GPU table: one record per GPU, merged across the outputs in one paste
// ---------------------------------------------------------------------------

class GpuTable {
  readonly list: RawGpu[] = [];

  find(uuid: string | undefined, bdf: string | undefined): RawGpu | undefined {
    return this.list.find(
      (g) =>
        (uuid !== undefined && g.uuid === uuid) ||
        (bdf !== undefined && g.bdf !== undefined && bdfKey(g.bdf) === bdfKey(bdf)),
    );
  }

  /** Merge into an existing record (first non-missing value wins) or append. */
  upsert(g: RawGpu): boolean {
    const hit = this.find(g.uuid, g.bdf);
    if (!hit) {
      this.list.push(g);
      return false;
    }
    const into = hit as Record<string, unknown>;
    for (const [key, value] of Object.entries(g)) {
      if (value === undefined) continue;
      if (into[key] === undefined || (into[key] === null && value !== null)) into[key] = value;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// nvidia-smi -q
// ---------------------------------------------------------------------------

interface QueryBlock {
  bdf: string;
  indent: number;
  stack: Array<{ indent: number; name: string }>;
  fields: Map<string, string>;
}

function parseQuery(lines: string[], table: GpuTable): { gpus: number; driver?: string } {
  let driver: string | undefined;
  let gpus = 0;
  let cur: QueryBlock | null = null;
  const finish = () => {
    if (!cur) return;
    table.upsert(gpuFromQuery(cur.fields, cur.bdf));
    gpus++;
    cur = null;
  };

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const indent = leadingWidth(line);
    const header = text.match(GPU_HEADER_RE);
    if (header) {
      finish();
      cur = { bdf: header[1], indent, stack: [], fields: new Map() };
      continue;
    }
    const kv = text.match(KV_RE);
    const key = kv ? normKey(kv[1]) : null;
    if (cur && indent <= cur.indent) {
      // A paste whose leading whitespace was stripped still carries the
      // padded `Key    : value` lines; keep those (flat) and end the block on
      // anything else, such as a prompt or another tool's output.
      const continues = kv !== null && PADDED_KV_RE.test(text) && !TOP_LEVEL_KEYS.has(key ?? "");
      if (!continues) finish();
    }
    if (!cur) {
      if (key === "driver version") driver ??= identValue(kv?.[2]);
      continue;
    }
    const block: QueryBlock = cur;
    const eff = Math.max(indent, block.indent + 1);
    while (block.stack.length > 0 && block.stack[block.stack.length - 1].indent >= eff) block.stack.pop();
    if (kv && key !== null) {
      const path = [...block.stack.map((s) => s.name), key].join(">");
      if (!block.fields.has(path)) block.fields.set(path, kv[2] ?? "");
    } else {
      block.stack.push({ indent: eff, name: normKey(text) });
    }
  }
  finish();
  return { gpus, driver };
}

function gpuFromQuery(f: Map<string, string>, bdf: string): RawGpu {
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = f.get(k);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const g: RawGpu = { bdf: safeIdent(bdf), source: "query" };
  const set = <K extends keyof RawGpu>(k: K, v: RawGpu[K]) => {
    if (v !== undefined) g[k] = v;
  };

  set("name", labelValue(get("product name")));
  set("uuid", uuidValue(get("gpu uuid")));
  set("vbios", identValue(get("vbios version")));
  set("pstate", pstateValue(get("performance state")));
  set("fan", reading(get("fan speed")));
  set("vramTotal", reading(get("fb memory usage>total")));
  set("vramUsed", reading(get("fb memory usage>used")));
  set("utilGpu", reading(get("utilization>gpu")));
  set("utilMem", reading(get("utilization>memory")));
  set("temp", reading(get("temperature>gpu current temp")));
  set("clockGr", reading(get("clocks>graphics")));
  set("clockSm", reading(get("clocks>sm")));
  set("clockMem", reading(get("clocks>memory")));
  set("genMax", reading(get("pci>gpu link info>pcie generation>max")));
  set("genCur", reading(get("pci>gpu link info>pcie generation>current")));
  set("widthMax", reading(get("pci>gpu link info>link width>max")));
  set("widthCur", reading(get("pci>gpu link info>link width>current")));
  // Driver <= 525 prints "Power Readings", 530+ "GPU Power Readings" next to
  // "GPU Memory Power Readings" and "Module Power Readings", which also have
  // a "Power Draw" line and must not be read as the GPU's.
  const pw = ["gpu power readings", "power readings"];
  set("powerDraw", reading(get(...["power draw", "average power draw", "instantaneous power draw"].flatMap((k) => pw.map((p) => `${p}>${k}`)))));
  set("powerLimit", reading(get(...["current power limit", "power limit", "enforced power limit"].flatMap((k) => pw.map((p) => `${p}>${k}`)))));
  set("eccMode", eccModeValue(get("ecc mode>current")));

  // ECC counters. Driver 525+ splits SRAM / DRAM (550+ further splits SRAM
  // uncorrectable into Parity and SEC-DED); older drivers print Single Bit
  // (corrected) and Double Bit (uncorrected) blocks with a Total line. The
  // "Aggregate Uncorrectable SRAM Sources" breakdown is a sibling of
  // Aggregate, so it is never double counted.
  for (const scope of ["volatile", "aggregate"] as const) {
    const prefix = `ecc errors>${scope}>`;
    let corr: Reading = undefined;
    let unc: Reading = undefined;
    const legacyTotal: { corr: Reading; unc: Reading } = { corr: undefined, unc: undefined };
    const legacySum: { corr: Reading; unc: Reading } = { corr: undefined, unc: undefined };
    for (const [k, v] of f) {
      if (!k.startsWith(prefix)) continue;
      const parts = k.slice(prefix.length).split(">");
      if (parts[0] === "single bit" || parts[0] === "double bit") {
        const bucket = parts[0] === "single bit" ? "corr" : "unc";
        if (parts[1] === "total") legacyTotal[bucket] = reading(v);
        else if (parts.length === 2) legacySum[bucket] = addReading(legacySum[bucket], reading(v));
      } else if (parts.length === 1) {
        if (/uncorrectable/.test(parts[0])) unc = addReading(unc, reading(v));
        else if (/correctable/.test(parts[0])) corr = addReading(corr, reading(v));
      }
    }
    corr = addReading(corr, legacyTotal.corr !== undefined ? legacyTotal.corr : legacySum.corr);
    unc = addReading(unc, legacyTotal.unc !== undefined ? legacyTotal.unc : legacySum.unc);
    if (scope === "volatile") {
      set("eccCorrVol", corr);
      set("eccUncVol", unc);
    } else {
      set("eccCorrAgg", corr);
      set("eccUncAgg", unc);
    }
  }

  set("retiredSbe", countReading(get("retired pages>single bit ecc")));
  set("retiredDbe", countReading(get("retired pages>double bit ecc")));
  // "Pending Page Blacklist" (most drivers), "Pending" (older), or
  // "Pending Page Retirement": Yes / No, which countReading maps to 1 / 0.
  for (const [k, v] of f) {
    if (k.startsWith("retired pages>pending")) {
      set("retiredPending", countReading(v));
      break;
    }
  }
  set("remapCorr", countReading(get("remapped rows>correctable error")));
  set("remapUnc", countReading(get("remapped rows>uncorrectable error")));
  set("remapPending", countReading(get("remapped rows>pending")));
  const failure = get("remapped rows>remapping failure occurred");
  if (failure !== undefined) g.remapFailure = /^yes\b/i.test(failure.trim());

  // Throttle / event reasons. Driver 535- prints "Clocks Throttle Reasons",
  // 550+ "Clocks Event Reasons" (Crucible matches the same rename in the
  // XML). "Clocks Event Reasons Counters" (microsecond totals) is a different
  // section and never matches. Only an exact "Active" counts.
  for (const [k, v] of f) {
    const m = k.match(/^clocks (?:event|throttle) reasons>(.+)$/);
    if (!m) continue;
    const reasons = (g.reasons ??= []);
    const label = QUERY_REASON_LABEL[m[1]];
    if (label && /^active$/i.test(v.trim())) reasons.push(label);
  }
  if (g.reasons) g.reasons = sortReasons(g.reasons);
  return g;
}

// ---------------------------------------------------------------------------
// nvidia-smi --query-gpu=... --format=csv (header row required)
// ---------------------------------------------------------------------------

type CsvSetter = (g: RawGpu, v: string) => void;

function setNumber(key: Exclude<keyof RawGpu, "index">): CsvSetter {
  return (g, v) => {
    const cur = g[key];
    if (typeof cur === "number") return; // first numeric alias wins
    const n = reading(v);
    if (n !== undefined) (g as Record<string, unknown>)[key] = n;
  };
}

function setCount(key: keyof RawGpu): CsvSetter {
  return (g, v) => {
    const n = countReading(v);
    if (n !== undefined && typeof g[key] !== "number") (g as Record<string, unknown>)[key] = n;
  };
}

// Column names as nvidia-smi echoes them in the header (units in brackets
// are stripped first). Crucible's NVIDIA_SMI_CSV_FIELDS plus the aliases
// `--help-query-gpu` lists for the same values.
const CSV_COLUMNS: Record<string, CsvSetter> = {
  index: (g, v) => {
    const n = reading(v);
    if (typeof n === "number") g.index = n;
  },
  uuid: (g, v) => (g.uuid = uuidValue(v) ?? g.uuid),
  gpu_uuid: (g, v) => (g.uuid = uuidValue(v) ?? g.uuid),
  name: (g, v) => (g.name = labelValue(v) ?? g.name),
  gpu_name: (g, v) => (g.name = labelValue(v) ?? g.name),
  "pci.bus_id": (g, v) => (g.bdf = busIdValue(v) ?? g.bdf),
  gpu_bus_id: (g, v) => (g.bdf = busIdValue(v) ?? g.bdf),
  vbios_version: (g, v) => (g.vbios = identValue(v) ?? g.vbios),
  "memory.total": setNumber("vramTotal"),
  "memory.used": setNumber("vramUsed"),
  "temperature.gpu": setNumber("temp"),
  "power.draw": setNumber("powerDraw"),
  "power.draw.average": setNumber("powerDraw"),
  "power.draw.instant": setNumber("powerDraw"),
  "power.limit": setNumber("powerLimit"),
  "enforced.power.limit": setNumber("powerLimit"),
  "utilization.gpu": setNumber("utilGpu"),
  "utilization.memory": setNumber("utilMem"),
  "clocks.gr": setNumber("clockGr"),
  "clocks.current.graphics": setNumber("clockGr"),
  "clocks.sm": setNumber("clockSm"),
  "clocks.current.sm": setNumber("clockSm"),
  "clocks.mem": setNumber("clockMem"),
  "clocks.current.memory": setNumber("clockMem"),
  pstate: (g, v) => (g.pstate = pstateValue(v) ?? g.pstate),
  "pcie.link.gen.current": setNumber("genCur"),
  "pcie.link.gen.gpucurrent": setNumber("genCur"),
  "pcie.link.gen.max": setNumber("genMax"),
  "pcie.link.width.current": setNumber("widthCur"),
  "pcie.link.width.max": setNumber("widthMax"),
  "ecc.mode.current": (g, v) => {
    const m = eccModeValue(v);
    if (m !== undefined) g.eccMode = m;
  },
  "ecc.errors.corrected.volatile.total": setNumber("eccCorrVol"),
  "ecc.errors.corrected.aggregate.total": setNumber("eccCorrAgg"),
  "ecc.errors.uncorrected.volatile.total": setNumber("eccUncVol"),
  "ecc.errors.uncorrected.aggregate.total": setNumber("eccUncAgg"),
  "retired_pages.single_bit_ecc.count": setCount("retiredSbe"),
  "retired_pages.sbe": setCount("retiredSbe"),
  "retired_pages.double_bit.count": setCount("retiredDbe"),
  "retired_pages.dbe": setCount("retiredDbe"),
  "retired_pages.pending": setCount("retiredPending"),
  "remapped_rows.correctable": setCount("remapCorr"),
  "remapped_rows.uncorrectable": setCount("remapUnc"),
  "remapped_rows.pending": setCount("remapPending"),
  "remapped_rows.failure": (g, v) => {
    const n = countReading(v);
    if (typeof n === "number") g.remapFailure = n > 0;
  },
  "fan.speed": setNumber("fan"),
};

function busIdValue(raw: string | undefined): string | undefined {
  const t = firstToken(raw);
  if (t === undefined || !/^(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7]$/.test(t)) return undefined;
  return t;
}

function csvReasonColumn(name: string): { kind: "label"; label: string } | { kind: "mask" } | null {
  const m = name.match(/^clocks_(?:event|throttle)_reasons\.(.+)$/);
  if (!m) return null;
  if (m[1] === "active") return { kind: "mask" };
  const label = CSV_REASON_SUFFIX[m[1]];
  return label ? { kind: "label", label } : null;
}

function csvColumnName(cell: string): string {
  return cell.trim().replace(/\s*\[[^\]]*\]$/, "").toLowerCase();
}

function isKnownCsvColumn(name: string): boolean {
  return name in CSV_COLUMNS || name === "driver_version" || csvReasonColumn(name) !== null;
}

/** A header row: every cell a query-field name, at least one beyond index / name. */
function csvHeader(line: string): string[] | null {
  if (!line.includes(",")) return null;
  const names = line.split(",").map(csvColumnName);
  if (names.length < 2 || !names.every((n) => CSV_NAME_RE.test(n))) return null;
  const known = names.filter(isKnownCsvColumn);
  const specific = known.filter((n) => n !== "index" && n !== "name");
  return known.length >= 2 && specific.length >= 1 ? names : null;
}

function parseCsv(lines: string[], table: GpuTable): { gpus: number; driver?: string } {
  let driver: string | undefined;
  let gpus = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = csvHeader(lines[i]);
    if (!header) continue;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (csvHeader(lines[j])) break;
      const cells = lines[j].split(",").map((c) => c.trim());
      if (cells.length !== header.length) break;
      const g: RawGpu = { source: "csv" };
      let mask: number | undefined;
      const reasons: string[] = [];
      let sawReasonColumn = false;
      header.forEach((name, col) => {
        const v = cells[col];
        if (name === "driver_version") {
          driver ??= identValue(v);
          return;
        }
        const reason = csvReasonColumn(name);
        if (reason) {
          if (reason.kind === "mask") {
            if (/^0x[0-9a-f]{1,16}$/i.test(v)) {
              sawReasonColumn = true;
              mask = Number(BigInt.asUintN(16, BigInt(v)));
            }
          } else if (!isNa(v)) {
            sawReasonColumn = true;
            if (/^active$/i.test(v)) reasons.push(reason.label);
          }
          return;
        }
        CSV_COLUMNS[name]?.(g, v);
      });
      if (mask !== undefined) {
        for (const [bit, label] of REASON_BITS) if (mask & bit) reasons.push(label);
      }
      if (sawReasonColumn) g.reasons = sortReasons(reasons);
      table.upsert(g);
      gpus++;
    }
    i = j - 1;
  }
  return { gpus, driver };
}

// ---------------------------------------------------------------------------
// nvidia-smi nvlink --status
// ---------------------------------------------------------------------------

// Ported from Crucible parseNvLinkStatus: a bandwidth above 0 is up, 0 GB/s
// or "<inactive>" is inactive (idle, not a fault), anything else is the
// fault bucket.
function classifyLink(linkId: number, value: string): NvLinkBasic {
  const bw = value.match(/(\d+(?:\.\d+)?)\s*GB\/s/i);
  if (bw) {
    const speed = Number(bw[1]);
    return { link_id: linkId, state: speed > 0 ? "up" : "inactive", speed_gbps: speed };
  }
  if (/inactive/i.test(value)) return { link_id: linkId, state: "inactive", speed_gbps: 0 };
  return { link_id: linkId, state: "down", speed_gbps: 0 };
}

function parseNvLink(lines: string[], table: GpuTable): { gpus: number; unmatched: number } {
  const blocks: RawGpu[] = [];
  let cur: RawGpu | null = null;
  for (const line of lines) {
    const header = line.match(NVLINK_GPU_RE);
    if (header) {
      cur = {
        index: Number(header[1]),
        name: labelValue(header[2]),
        uuid: uuidValue(header[3]),
        links: [],
        source: "nvlink",
      };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const link = line.match(NVLINK_LINK_RE);
    if (link) {
      const id = Number(link[1]);
      if (!cur.links!.some((l) => l.link_id === id)) cur.links!.push(classifyLink(id, link[2]));
      continue;
    }
    if (line.trim()) cur = null;
  }
  // A header with no Link lines is `nvidia-smi -L`, or a GPU without NVLink
  // (Crucible's L4 case: empty output). Neither says anything about links.
  const withLinks = blocks.filter((b) => b.links!.length > 0);
  const hadOtherGpus = table.list.some((g) => g.source !== "nvlink");
  let unmatched = 0;
  for (const b of withLinks) {
    const merged = table.upsert(b);
    if (!merged && hadOtherGpus) unmatched++;
  }
  return { gpus: withLinks.length, unmatched };
}

// ---------------------------------------------------------------------------
// Raw records -> Snapshot entries
// ---------------------------------------------------------------------------

interface BuildCounts {
  tempMissing: number;
  powerMissing: number;
  reasonsMissing: number;
  pcieSkipped: number;
  eccSkipped: number;
  remapUsed: number;
  remapFailure: number;
  vbiosSkipped: number;
}

function num0(r: Reading): number {
  return typeof r === "number" ? r : 0;
}

function nullable(r: Reading): number | null {
  return typeof r === "number" ? r : null;
}

/** N/A stays Crucible's 0; a reading the paste lacks is NaN (see the header). */
function nanIfAbsent(r: Reading): number {
  if (typeof r === "number") return r;
  return r === undefined ? Number.NaN : 0;
}

function buildGpus(raws: RawGpu[], counts: BuildCounts): SnapshotGpu[] {
  // VBIOS drift guard: blank a model group's versions when any member lacks one.
  const incompleteModels = new Set<string>();
  for (const r of raws) if (r.name !== undefined && r.vbios === undefined) incompleteModels.add(r.name);

  return raws.map((r, i) => {
    let vbios = r.vbios ?? "";
    if (r.name === undefined || incompleteModels.has(r.name)) {
      if (vbios !== "") counts.vbiosSkipped++;
      vbios = "";
    }

    const genOk = typeof r.genCur === "number" && typeof r.genMax === "number";
    const widthOk = typeof r.widthCur === "number" && typeof r.widthMax === "number";
    const loadKnown = r.utilGpu !== undefined && r.powerDraw !== undefined && r.powerLimit !== undefined;
    if (!(genOk || widthOk) || !loadKnown) counts.pcieSkipped++;

    // Ampere and newer print Retired Pages as N/A and report Remapped Rows
    // instead; use those counts only when no retired-page number is shown.
    const retiredShown = [r.retiredSbe, r.retiredDbe].some((n) => typeof n === "number");
    const remapShown = [r.remapCorr, r.remapUnc, r.remapPending].some((n) => typeof n === "number");
    const useRemap = !retiredShown && remapShown;
    if (useRemap) counts.remapUsed++;
    const sbe = useRemap ? r.remapCorr : r.retiredSbe;
    const dbe = useRemap ? r.remapUnc : r.retiredDbe;
    const pending = useRemap ? r.remapPending : r.retiredPending;
    if (r.remapFailure) counts.remapFailure++;

    const eccNumbers = [r.eccCorrVol, r.eccCorrAgg, r.eccUncVol, r.eccUncAgg, sbe, dbe, pending].some(
      (n) => typeof n === "number",
    );
    const eccOn = (r.eccMode === true || r.eccMode === undefined) && eccNumbers;
    if (!eccOn) counts.eccSkipped++;

    if (r.temp === undefined) counts.tempMissing++;
    if (r.powerDraw === undefined || r.powerLimit === undefined) counts.powerMissing++;
    if (r.reasons === undefined) counts.reasonsMissing++;

    const reasons = r.reasons ?? [];
    return {
      index: r.index ?? i,
      uuid: r.uuid ?? "",
      name: r.name ?? "",
      pci_bdf: r.bdf ?? "",
      vbios_version: vbios,
      vram_total_mib: num0(r.vramTotal),
      vram_used_mib: num0(r.vramUsed),
      temp_c: nanIfAbsent(r.temp),
      power_draw_w: nanIfAbsent(r.powerDraw),
      power_limit_w: nanIfAbsent(r.powerLimit),
      utilization_gpu_percent: loadKnown ? num0(r.utilGpu) : 0,
      utilization_mem_percent: num0(r.utilMem),
      clock_graphics_mhz: num0(r.clockGr),
      clock_sm_mhz: num0(r.clockSm),
      clock_mem_mhz: num0(r.clockMem),
      pstate: r.pstate ?? "",
      pcie_link_gen_current: genOk ? num0(r.genCur) : 0,
      pcie_link_gen_max: genOk ? num0(r.genMax) : 0,
      pcie_link_width_current: widthOk ? num0(r.widthCur) : 0,
      pcie_link_width_max: widthOk ? num0(r.widthMax) : 0,
      // Slot width comes from sysfs on the host, never from nvidia-smi.
      pcie_slot_max_width: null,
      ecc_mode_current: eccOn,
      ecc_errors_corrected_volatile: nanIfAbsent(r.eccCorrVol),
      ecc_errors_corrected_aggregate: nanIfAbsent(r.eccCorrAgg),
      ecc_errors_uncorrected_volatile: nanIfAbsent(r.eccUncVol),
      // Never NaN: the rule's `=== 0` would read it as a lifetime error.
      ecc_errors_uncorrected_aggregate: num0(r.eccUncAgg),
      retired_pages_single_bit: nullable(sbe),
      retired_pages_double_bit: nullable(dbe),
      retired_pages_pending: nullable(pending),
      // Same derivation as Crucible enrichThrottleReasons.
      thermal_slowdown_active:
        reasons.includes("hw_slowdown") ||
        reasons.includes("hw_thermal_slowdown") ||
        reasons.includes("sw_thermal_slowdown"),
      // Tier 2 (DCGM) values in Crucible; not in nvidia-smi tier 1 output.
      thermal_violation_total_ms: null,
      power_violation_total_ms: null,
      fan_speed_percent: nullable(r.fan),
      nvlink_links: r.links ?? [],
      performance_state_reasons: reasons,
    };
  });
}

function gpuCount(n: number): string {
  return `${n} GPU${n === 1 ? "" : "s"}`;
}

function buildNotes(total: number, counts: BuildCounts, nvlinkGpus: number, unmatched: number): ParseNote[] {
  const notes: ParseNote[] = [{ level: "info", message: `Read ${gpuCount(total)} from nvidia-smi output.` }];
  const missing: string[] = [];
  if (counts.tempMissing > 0) missing.push(`GPU temperature (${gpuCount(counts.tempMissing)})`);
  if (counts.powerMissing > 0) missing.push(`power draw or limit (${gpuCount(counts.powerMissing)})`);
  if (missing.length > 0) {
    notes.push({
      level: "info",
      message: `Not in this paste, so no finding reports them: ${missing.join(", ")}.`,
    });
  }
  if (counts.reasonsMissing > 0) {
    notes.push({
      level: "info",
      message: `Clock throttle (event) reasons are not in this paste for ${gpuCount(counts.reasonsMissing)}; the power-cap check could not run for them and the thermal check used temperature alone.`,
    });
  }
  if (counts.eccSkipped > 0) {
    notes.push({
      level: "info",
      message: `ECC checks skipped for ${gpuCount(counts.eccSkipped)}: ECC is disabled or not supported, or the paste shows no ECC counters for them.`,
    });
  }
  if (counts.pcieSkipped > 0) {
    notes.push({
      level: "info",
      message: `PCIe link check skipped for ${gpuCount(counts.pcieSkipped)}: it needs the current and max link generation or width, plus utilization, power draw and power limit.`,
    });
  }
  if (counts.vbiosSkipped > 0) {
    notes.push({
      level: "info",
      message: `VBIOS drift check skipped for ${gpuCount(counts.vbiosSkipped)}: the paste does not show a product name and VBIOS version for every GPU of the model.`,
    });
  }
  if (counts.remapUsed > 0) {
    notes.push({
      level: "info",
      message: `Remapped-row counts were used as retired-page counts for ${gpuCount(counts.remapUsed)}, which report Retired Pages as N/A and Remapped Rows instead.`,
    });
  }
  if (counts.remapFailure > 0) {
    notes.push({
      level: "warning",
      message: `Remapping Failure Occurred: Yes on ${gpuCount(counts.remapFailure)}. No rule in this check reads that field, so it is listed here rather than as a finding.`,
    });
  }
  if (nvlinkGpus > 0 && total < 2) {
    notes.push({
      level: "info",
      message: "NVLink state was read, but the NVLink check only runs when the paste covers two or more GPUs.",
    });
  }
  if (unmatched > 0) {
    notes.push({
      level: "info",
      message: `NVLink entries for ${gpuCount(unmatched)} did not match a GPU UUID elsewhere in the paste, so they are counted as separate GPUs.`,
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function hasCsvHeader(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.includes(",") && csvHeader(line.replace(/\r$/, ""))) return true;
  }
  return false;
}

function parseUnsafe(text: string): ParserResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const table = new GpuTable();
  const query = parseQuery(lines, table);
  const csv = parseCsv(lines, table);
  const nvlink = parseNvLink(lines, table);

  const formats: TriageFormat[] = [];
  // TriageFormat has no CSV member; the CSV is a `--query-gpu` query, so it
  // reports as nvidia_smi_query (see the integrator note).
  if (query.gpus > 0 || csv.gpus > 0) formats.push("nvidia_smi_query");
  if (nvlink.gpus > 0) formats.push("nvidia_smi_nvlink_status");

  if (table.list.length === 0) {
    const notes: ParseNote[] = [];
    if (DRIVER_FAIL_RE.test(text)) {
      notes.push({
        level: "warning",
        message: "nvidia-smi reported that it could not communicate with the NVIDIA driver, so this paste has no GPU readings.",
      });
    } else if (NO_DEVICES_RE.test(text)) {
      notes.push({ level: "warning", message: "nvidia-smi reported no devices, so this paste has no GPU readings." });
    } else {
      notes.push({ level: "info", message: "No GPU section with readable fields was found in the nvidia-smi output." });
    }
    return { domain: "nvidia_gpu", formats: [], snapshot: {}, subjects: 0, notes };
  }

  const counts: BuildCounts = {
    tempMissing: 0,
    powerMissing: 0,
    reasonsMissing: 0,
    pcieSkipped: 0,
    eccSkipped: 0,
    remapUsed: 0,
    remapFailure: 0,
    vbiosSkipped: 0,
  };
  const gpus = buildGpus(table.list, counts);
  const driver = query.driver ?? csv.driver;
  return {
    domain: "nvidia_gpu",
    formats,
    snapshot: {
      gpu: {
        available: true,
        capabilities: {
          nvidia_smi: true,
          nvidia_driver_version: driver ?? null,
          dcgm: false,
          dcgmi_version: null,
          redfish_endpoint: null,
          redfish_oem_schema: null,
          // Required by the type; nothing was probed, no rule reads it.
          probe_duration_ms: 0,
        },
        tier1: {
          available: true,
          gpus,
          // Xid events come from the kernel log (kernel_log domain).
          xid_events: [],
          // Crucible's value when the driver version is unreadable.
          driver_version: driver ?? "unknown",
        },
      },
    },
    subjects: gpus.length,
    notes: buildNotes(gpus.length, counts, nvlink.gpus, nvlink.unmatched),
    // Link state comes only from `nvidia-smi nvlink --status`, and every other
    // rule reads fields only -q or the CSV query carry. Each half is checked
    // only when its output is in the paste.
    rules_checked: RULES.filter((r) =>
      r === "nvlink_link_down" ? nvlink.gpus > 0 : query.gpus > 0 || csv.gpus > 0,
    ),
  };
}

export const nvidiaSmiParser: TriageParser = {
  domain: "nvidia_gpu",
  rules: RULES,
  notDeterminable: NOT_DETERMINABLE,
  detect(text: string): boolean {
    try {
      if (typeof text !== "string" || text.length === 0) return false;
      return (
        BANNER_RE.test(text) ||
        GPU_HEADER_LINE_RE.test(text) ||
        (NVLINK_GPU_LINE_RE.test(text) && NVLINK_LINK_LINE_RE.test(text)) ||
        DRIVER_FAIL_RE.test(text) ||
        hasCsvHeader(text)
      );
    } catch {
      return false;
    }
  },
  parse(text: string): ParserResult {
    try {
      return parseUnsafe(typeof text === "string" ? text : "");
    } catch {
      return {
        domain: "nvidia_gpu",
        formats: [],
        snapshot: {},
        subjects: 0,
        notes: [{ level: "warning", message: "The nvidia-smi parser stopped on unexpected input; no GPU readings were taken from this paste." }],
      };
    }
  },
};
