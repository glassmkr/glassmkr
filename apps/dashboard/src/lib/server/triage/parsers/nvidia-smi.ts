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
// One mapping goes beyond a field-for-field copy: "Pending Page Blacklist:
// Yes" (a flag, not a count) becomes 1. Remapped Rows (Ampere and newer, which
// print Retired Pages as N/A) are NOT copied into the retired-page fields:
// Crucible never reads them, so the dashboard sees null there, and a GPU that
// remapped a row successfully is healthy by NVIDIA's own RMA criteria. Copying
// them turned that GPU into a critical "replace it" (review 2026-10-03, R1-7).
// The remap counts are reported in a note instead.

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
  /** "GPU Slowdown Temp" in degrees; the relative T.Limit form (driver 550+) is a different key. */
  slowdownTemp?: Reading;
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
  /** "SRAM Threshold Exceeded: Yes", NVIDIA's RMA flag for uncorrectable SRAM errors. */
  sramThreshold?: boolean;
  /** GPU Reset Status: Reset Required or Drain and Reset Recommended is Yes. */
  resetRequired?: boolean;
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

// Matched per line, on lines already under MAX_LINE: unanchored over the whole
// paste, a 200 KB run of "=" cost 15 s in detect(), which runs on every paste
// (R1-5).
const BANNER_LINE_RE = /^={3,}[ \t]*NVSMI LOG[ \t]*={3,}$/;
/** nvidia-smi lines are short; a longer line is not its output, and no regex here sees it. */
const MAX_LINE = 4096;
/** A real host has a few dozen GPUs at most; past this the paste is not one host's output. */
const MAX_GPUS = 64;
const GPU_HEADER_RE = /^GPU\s+((?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7])$/;
const GPU_HEADER_LINE_RE =
  /^[ \t]*GPU[ \t]+(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7][ \t]*\r?$/m;
// `Key<padding>: value`. The whitespace before the colon is what tells a -q
// line from a prompt (`root@host:~#`), a bus id or a kernel log line.
const KV_RE = /^(\S(?:.*?\S)?)\s+:(?:\s+(.*))?$/;
const PADDED_KV_RE = /\S {2,}:/;
const TOP_LEVEL_KEYS = new Set(["timestamp", "driver version", "cuda version", "attached gpus"]);
// No stacked quantifiers over the same characters: the old form,
// `:\s*(.*?)\s*\(UUID:\s*([^)]*?)\s*\)`, backtracked cubically on a padded
// line and a 4 KB paste held the event loop for 45 s (R1-2). Groups are
// trimmed in code.
const NVLINK_GPU_RE = /^\s*GPU\s+(\d{1,3}):([^(]*)\(UUID:([^)]*)\)\s*$/;
const NVLINK_GPU_LINE_RE = /^[ \t]*GPU[ \t]+\d{1,3}:[^\r\n]{0,256}\(UUID:/m;
const NVLINK_LINK_RE = /^\s*Link\s+(\d{1,3}):(.*)$/;
const NVLINK_LINK_LINE_RE = /^[ \t]*Link[ \t]+\d{1,3}:/m;
// A `Link N:` row whose value carries its own label is a counter, not link
// state: `nvlink -e` prints "Link 0: Replay Errors: 0", `nvlink -gt d`
// "Link 0: Data Tx: 26737 KiB". A --status value never has a second label
// ("25 GB/s", "<inactive>"). Read as state, every healthy link was Down (R4-1).
const NVLINK_COUNTER_VALUE_RE = /^[A-Za-z][A-Za-z0-9 ]{0,40}:/;
const DRIVER_FAIL_RE = /NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver/i;
// Plain `nvidia-smi`: the summary table's banner row with the driver version,
// and its column header. Detected only so the answer can say the table is not
// read and ask for -q; came back "No supported command output was recognised"
// (R4-5). One whitespace run before the optional "|" keeps it linear.
const SUMMARY_BANNER_RE = /^[ \t]*(?:\|[ \t]*)?NVIDIA-SMI[ \t]+\d{1,4}\.\d{1,4}(?:\.\d{1,4})?[ \t]+Driver Version:/m;
const SUMMARY_ECC_HEADER = "Volatile Uncorr. ECC";
const SUMMARY_TABLE_NOTE =
  "nvidia-smi's default summary table is not read, so no GPU check ran on it. nvidia-smi -q prints the ECC, temperature, throttle-reason and PCIe fields the checks read.";
const NO_DEVICES_RE = /^[ \t]*No devices were found[ \t]*$/m;
// A GPU nvidia-smi cannot open: "Unable to determine the device handle for
// GPU0000:2A:00.0: Unknown Error" (or "...: GPU is lost. Reboot the system
// ..."), printed by plain nvidia-smi and by -q in place of that GPU's section.
const DEVICE_HANDLE_RE =
  /^[ \t]*Unable to determine the device handle for GPU ?((?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}):[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7]):/;
const DEVICE_HANDLE_LINE_RE = new RegExp(DEVICE_HANDLE_RE.source, "m");
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
  /** GPU records past MAX_GPUS that matched nothing already read. */
  dropped = 0;
  // Lookups are indexed: a linear scan per upsert made a paste of thousands of
  // bare GPU headers quadratic, 4.7 s at 200 KB (R1-13).
  private readonly at = new Map<RawGpu, number>();
  private readonly byBdf = new Map<string, RawGpu>();
  private readonly byUuid = new Map<string, RawGpu[]>();

  /**
   * The first record in list order with the same PCI bus id, or with the same
   * UUID and no conflicting bus id. A UUID alone never merges two GPUs on
   * different buses: a paste where every UUID was replaced by one placeholder
   * would otherwise collapse every GPU into one (R1-11).
   */
  find(uuid: string | undefined, bdf: string | undefined): RawGpu | undefined {
    const key = bdf !== undefined ? bdfKey(bdf) : undefined;
    let best = key !== undefined ? this.byBdf.get(key) : undefined;
    if (uuid !== undefined) {
      for (const g of this.byUuid.get(uuid) ?? []) {
        if (g.bdf !== undefined && key !== undefined && bdfKey(g.bdf) !== key) continue;
        if (best === undefined || this.at.get(g)! < this.at.get(best)!) best = g;
        break;
      }
    }
    return best;
  }

  private index(g: RawGpu): void {
    if (g.bdf !== undefined) {
      const key = bdfKey(g.bdf);
      const cur = this.byBdf.get(key);
      if (cur === undefined || this.at.get(g)! < this.at.get(cur)!) this.byBdf.set(key, g);
    }
    if (g.uuid !== undefined) {
      const list = this.byUuid.get(g.uuid) ?? [];
      if (!list.includes(g)) {
        list.push(g);
        list.sort((a, b) => this.at.get(a)! - this.at.get(b)!);
        this.byUuid.set(g.uuid, list);
      }
    }
  }

  /** Merge into an existing record (first non-missing value wins) or append. */
  upsert(g: RawGpu): "merged" | "added" | "dropped" {
    const hit = this.find(g.uuid, g.bdf);
    if (!hit) {
      if (this.list.length >= MAX_GPUS) {
        this.dropped++;
        return "dropped";
      }
      this.at.set(g, this.list.length);
      this.list.push(g);
      this.index(g);
      return "added";
    }
    const into = hit as Record<string, unknown>;
    for (const [key, value] of Object.entries(g)) {
      if (value === undefined) continue;
      if (into[key] === undefined || (into[key] === null && value !== null)) into[key] = value;
    }
    this.index(hit);
    return "merged";
  }
}

// ---------------------------------------------------------------------------
// nvidia-smi -q
// ---------------------------------------------------------------------------

interface QueryBlock {
  bdf: string;
  indent: number;
  stack: Array<{ indent: number; name: string }>;
  /** Length of the stack's names joined with ">", plus one: kept as the stack changes. */
  pathLen: number;
  fields: Map<string, string>;
}

// Bounds on the key each field line builds from its section stack. Every key
// gpuFromQuery reads is under 80 characters and real section names are under
// 40. Section names were bounded only by the line cap, so ten nested
// 4,000-character names made every key 40 KB, past the 16,383 characters V8
// hashes: the field Map compared whole keys on each lookup and one anonymous
// 200 KB paste held the process for 42 s (R3-1). The length is tracked as the
// stack changes, so a deep stack is never joined only to be thrown away.
const MAX_SECTION_NAME = 64;
const MAX_FIELD_PATH = 256;

const INDENT_STEP = 4;
// The separator of a `Key<padding>: value` line, with KV_RE's lazy key, so the
// ':' column is the key's length plus its padding.
const KV_SEP_RE = /^(\S(?:.*?\S)?)(\s+):/;
// A -q section name: "MIG Mode", "GPU Link Info", "Clocks Event Reasons".
const SECTION_NAME_RE = /^[A-Za-z][A-Za-z0-9 ()\/.,+_-]{0,63}$/;

/**
 * The indent of every line. A paste whose leading whitespace was stripped (an
 * HTML email, a ticket field) put every key at column 0, so each GPU block
 * ended at its first section name and kept only the product name (R5-7).
 * nvidia-smi pads every key so its ':' lands in one column at every depth,
 * which gives the depth back: the alignment column (read from a top-level key
 * such as Timestamp, or one step past the widest key in the block) minus the
 * key's ':' column. A section name takes one step less than the key below it.
 */
function queryIndents(lines: string[]): { indents: number[]; stripped: number } {
  const indents = lines.map(leadingWidth);
  let align: number | null = null;
  let stripped = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    if (indents[i] === 0) {
      const sep = KV_SEP_RE.exec(text);
      if (sep && sep[2].length >= 2 && TOP_LEVEL_KEYS.has(normKey(sep[1]))) {
        align = sep[1].length + sep[2].length;
        continue;
      }
    }
    if (!GPU_HEADER_RE.test(text)) continue;
    const head = indents[i];
    const block: Array<{ line: number; col: number | null; padded: boolean }> = [];
    let widest = 0;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      // An indented line: the block kept its indentation, or this is not it.
      if (indents[j] > head || GPU_HEADER_RE.test(t)) break;
      const sep = KV_SEP_RE.exec(t);
      if (sep) {
        if (TOP_LEVEL_KEYS.has(normKey(sep[1]))) break;
        const col = sep[1].length + sep[2].length;
        const padded = sep[2].length >= 2;
        if (padded) widest = Math.max(widest, col);
        block.push({ line: j, col, padded });
      } else if (SECTION_NAME_RE.test(t)) {
        block.push({ line: j, col: null, padded: false });
      } else break;
    }
    if (block.length === 0 || widest === 0) continue;
    stripped++;
    const alignCol = align ?? widest + INDENT_STEP;
    let last = head + INDENT_STEP;
    let sections: number[] = [];
    for (const b of block) {
      if (b.col === null) {
        sections.push(b.line);
        continue;
      }
      // A key too long for its padding has no depth to read; it sits beside the key before it.
      let indent = b.padded ? head + alignCol - b.col : last;
      if (indent < head + INDENT_STEP) indent = last;
      sections.forEach((line, k) => {
        indents[line] = Math.max(head + INDENT_STEP, indent - INDENT_STEP * (sections.length - k));
      });
      sections = [];
      indents[b.line] = indent;
      last = indent;
    }
    for (const line of sections) indents[line] = last;
    i = j - 1;
  }
  return { indents, stripped };
}

function parseQuery(lines: string[], table: GpuTable): { gpus: number; driver?: string; stripped: number } {
  let driver: string | undefined;
  let gpus = 0;
  let cur: QueryBlock | null = null;
  const { indents, stripped } = queryIndents(lines);
  const finish = () => {
    if (!cur) return;
    table.upsert(gpuFromQuery(cur.fields, cur.bdf));
    gpus++;
    cur = null;
  };

  for (let li = 0; li < lines.length; li++) {
    const text = lines[li].trim();
    if (!text) continue;
    const indent = indents[li];
    const header = text.match(GPU_HEADER_RE);
    if (header) {
      finish();
      cur = { bdf: header[1], indent, stack: [], pathLen: 0, fields: new Map() };
      continue;
    }
    const kv = text.match(KV_RE);
    const key = kv ? normKey(kv[1]) : null;
    if (cur && indent <= cur.indent) {
      // A stripped paste whose depth queryIndents could not read still
      // carries the padded `Key    : value` lines; keep those (flat) and end
      // the block on anything else, such as a prompt or another tool's output.
      const continues = kv !== null && PADDED_KV_RE.test(text) && !TOP_LEVEL_KEYS.has(key ?? "");
      if (!continues) finish();
    }
    if (!cur) {
      if (key === "driver version") driver ??= identValue(kv?.[2]);
      continue;
    }
    const block: QueryBlock = cur;
    const eff = Math.max(indent, block.indent + 1);
    while (block.stack.length > 0 && block.stack[block.stack.length - 1].indent >= eff) {
      block.pathLen -= block.stack.pop()!.name.length + 1;
    }
    if (kv && key !== null) {
      if (block.pathLen + key.length <= MAX_FIELD_PATH) {
        const path = [...block.stack.map((s) => s.name), key].join(">");
        if (!block.fields.has(path)) block.fields.set(path, kv[2] ?? "");
      }
    } else {
      const name = normKey(text).slice(0, MAX_SECTION_NAME);
      block.stack.push({ indent: eff, name });
      block.pathLen += name.length + 1;
    }
  }
  finish();
  return { gpus, driver, stripped };
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
  set("slowdownTemp", reading(get("temperature>gpu slowdown temp")));
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
  // RMA and recovery flags no rule reads, reported in notes (R3-11).
  const sram = get("ecc errors>aggregate>sram threshold exceeded");
  if (sram !== undefined) g.sramThreshold = /^yes\b/i.test(sram.trim());
  const reset = [get("gpu reset status>reset required"), get("gpu reset status>drain and reset recommended")];
  if (reset.some((v) => v !== undefined)) g.resetRequired = reset.some((v) => v !== undefined && /^yes\b/i.test(v.trim()));

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

/**
 * Header cell without its unit suffix ("memory.total [MiB]"). Done without a
 * regex: `\s*\[[^\]]*\]$` backtracked quadratically on a cell of spaces or
 * brackets, and detect() runs it on every comma line of every paste (R1-5).
 */
function csvColumnName(cell: string): string {
  let c = cell.trim();
  if (c.endsWith("]")) {
    // The first "[" after the last other "]": the same span the regex took.
    const open = c.indexOf("[", c.lastIndexOf("]", c.length - 2) + 1);
    if (open >= 0 && open < c.length - 1) c = c.slice(0, open).trimEnd();
  }
  return c.toLowerCase();
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
  // Bounded, and never starting inside a number: "\d+" retried from every
  // digit of a long run cost 0.3 s per 200 KB paste (R2b-10).
  const bw = value.match(/(?<![\d.])(\d{1,7}(?:\.\d{1,6})?)\s*GB\/s/i);
  if (bw) {
    const speed = Number(bw[1]);
    return { link_id: linkId, state: speed > 0 ? "up" : "inactive", speed_gbps: speed };
  }
  if (/inactive/i.test(value)) return { link_id: linkId, state: "inactive", speed_gbps: 0 };
  return { link_id: linkId, state: "down", speed_gbps: 0 };
}

function parseNvLink(lines: string[], table: GpuTable): { gpus: number; unmatched: number; counterRows: number } {
  const blocks: RawGpu[] = [];
  let cur: RawGpu | null = null;
  let counterRows = 0;
  for (const line of lines) {
    const header = line.match(NVLINK_GPU_RE);
    if (header) {
      cur = {
        index: Number(header[1]),
        name: labelValue(header[2].trim()),
        uuid: uuidValue(header[3].trim()),
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
      const value = link[2].trim();
      // Counters never set state, so a status row decides in either order.
      if (NVLINK_COUNTER_VALUE_RE.test(value)) counterRows++;
      else if (!cur.links!.some((l) => l.link_id === id)) cur.links!.push(classifyLink(id, value));
      continue;
    }
    if (line.trim()) cur = null;
  }
  // A header with no Link lines is `nvidia-smi -L`, or a GPU without NVLink
  // (Crucible's L4 case: empty output); one with only counter rows is
  // `nvlink -e` or `-gt`. None of them says anything about link state.
  const withLinks = blocks.filter((b) => b.links!.length > 0);
  const hadOtherGpus = table.list.some((g) => g.source !== "nvlink");
  let unmatched = 0;
  for (const b of withLinks) {
    if (table.upsert(b) === "added" && hadOtherGpus) unmatched++;
  }
  return { gpus: withLinks.length, unmatched, counterRows };
}

const NVLINK_COUNTERS_NOTE =
  "NVLink error or traffic counters (nvidia-smi nvlink -e or -gt) are in this paste; they are not evaluated. Link state comes from nvidia-smi nvlink --status.";

// ---------------------------------------------------------------------------
// Raw records -> Snapshot entries
// ---------------------------------------------------------------------------

interface BuildCounts {
  tempMissing: number;
  powerMissing: number;
  reasonsMissing: number;
  pcieSkipped: number;
  eccSkipped: number;
  /** GPUs with a non-zero remapped-row count or a pending remap. */
  remapGpus: number;
  remapUncorrectable: number;
  remapCorrectable: number;
  remapPending: number;
  remapFailure: number;
  sramThreshold: number;
  resetRequired: number;
  vbiosSkipped: number;
  /** GPUs whose link width is below the card's max while the generation is not. */
  widthOnly: number;
  /** GPUs with neither a temperature nor throttle reasons: the thermal check has nothing to read. */
  thermalBlind: number;
  /** GPUs at or above the GPU Slowdown Temp the paste prints for them. */
  atSlowdown: number;
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
    const genDown = genOk && num0(r.genCur) < num0(r.genMax);
    if (widthOk && num0(r.widthCur) < num0(r.widthMax) && !genDown) counts.widthOnly++;

    // Remapped rows stay out of the retired-page fields (see the header).
    const sbe = r.retiredSbe;
    const dbe = r.retiredDbe;
    const pending = r.retiredPending;
    const remapUnc = num0(r.remapUnc);
    const remapCorr = num0(r.remapCorr);
    const remapPending = num0(r.remapPending) > 0;
    if (remapUnc > 0 || remapCorr > 0 || remapPending) {
      counts.remapGpus++;
      counts.remapUncorrectable += remapUnc;
      counts.remapCorrectable += remapCorr;
      if (remapPending) counts.remapPending++;
    }
    if (r.remapFailure) counts.remapFailure++;
    if (r.sramThreshold) counts.sramThreshold++;
    if (r.resetRequired) counts.resetRequired++;

    const eccNumbers = [
      r.eccCorrVol, r.eccCorrAgg, r.eccUncVol, r.eccUncAgg, sbe, dbe, pending, r.remapCorr, r.remapUnc, r.remapPending,
    ].some((n) => typeof n === "number");
    const eccOn = (r.eccMode === true || r.eccMode === undefined) && eccNumbers;
    if (!eccOn) counts.eccSkipped++;

    if (r.temp === undefined) counts.tempMissing++;
    if (r.powerDraw === undefined || r.powerLimit === undefined) counts.powerMissing++;
    if (r.reasons === undefined) counts.reasonsMissing++;
    if (r.temp === undefined && r.reasons === undefined) counts.thermalBlind++;
    if (typeof r.temp === "number" && typeof r.slowdownTemp === "number" && r.slowdownTemp > 0 && r.temp >= r.slowdownTemp) counts.atSlowdown++;

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

function unopenedNote(n: number): ParseNote {
  return {
    level: "warning",
    message: `nvidia-smi could not open ${gpuCount(n)} (Unable to determine the device handle), so this paste has no readings for ${n === 1 ? "it" : "them"}.`,
  };
}

/** Distinct GPUs nvidia-smi printed "Unable to determine the device handle" for. */
function unopenedGpus(lines: string[]): number {
  const seen = new Set<string>();
  for (const line of lines) {
    const m = DEVICE_HANDLE_RE.exec(line);
    if (m) seen.add(m[1].toLowerCase());
  }
  return seen.size;
}

function buildNotes(
  total: number,
  counts: BuildCounts,
  nvlinkGpus: number,
  unmatched: number,
  dropped: number,
  downLinks: readonly number[],
): ParseNote[] {
  const notes: ParseNote[] = [{ level: "info", message: `Read ${gpuCount(total)} from nvidia-smi output.` }];
  if (dropped > 0) {
    notes.push({
      level: "warning",
      message: `${dropped} more GPU entries past the first ${MAX_GPUS} were not read; paste one host's output at a time.`,
    });
  }
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
  if (counts.widthOnly > 0) {
    // Two notes: analyze.ts cuts a note at 240 characters, and one note cut
    // this command off mid-quote (R2b-14).
    notes.push({
      level: "info",
      message: `The PCIe link width is below the card's maximum on ${gpuCount(counts.widthOnly)}. nvidia-smi's maximum is the card's, not the slot's, so this output cannot tell a slot wired for fewer lanes from a link that trained down.`,
    });
    notes.push({
      level: "info",
      message: `The slot's own width: cat "$(readlink -f /sys/bus/pci/devices/<bus id>)/../max_link_width", with the GPU's bus id as lspci -D prints it.`,
    });
  }
  // The thermal rule fires at a fixed 92 C, not at the card's own slowdown
  // temperature: an A100 at 90 C against its printed 89 C was listed only as
  // "ran and found no matching signal" (R4-3).
  if (counts.atSlowdown > 0) {
    notes.push({
      level: "warning",
      message: `The GPU temperature is at or above the GPU Slowdown Temp nvidia-smi printed for it on ${gpuCount(counts.atSlowdown)}. The thermal check fires on a hardware thermal slowdown or at a fixed 92 C, not at each card's own slowdown temperature.`,
    });
  }
  if (counts.vbiosSkipped > 0) {
    notes.push({
      level: "info",
      message: `VBIOS drift check skipped for ${gpuCount(counts.vbiosSkipped)}: the paste does not show a product name and VBIOS version for every GPU of the model.`,
    });
  }
  if (counts.remapGpus > 0) {
    notes.push({
      level: "info",
      message: `Remapped rows on ${gpuCount(counts.remapGpus)}: ${counts.remapUncorrectable} uncorrectable and ${counts.remapCorrectable} correctable in total. A successful remap retires the faulty memory row; no rule in this check reads remapped-row counts, so they are listed here rather than as a finding.`,
    });
    // Its own note, so the 240-character cut cannot drop it (R2b-14).
    if (counts.remapPending > 0) {
      notes.push({
        level: "info",
        message: `A row remap is pending on ${gpuCount(counts.remapPending)}: it takes effect after a GPU reset.`,
      });
    }
  }
  if (counts.remapFailure > 0) {
    notes.push({
      level: "warning",
      message: `Remapping Failure Occurred: Yes on ${gpuCount(counts.remapFailure)}. No rule in this check reads that field, so it is listed here rather than as a finding.`,
    });
  }
  // The ECC rule saw only the counters, and called the GPU's uncorrected
  // errors historical at info (R3-11).
  if (counts.sramThreshold > 0) {
    notes.push({
      level: "warning",
      message: `SRAM Threshold Exceeded: Yes on ${gpuCount(counts.sramThreshold)}. NVIDIA treats this as meeting its RMA criteria for uncorrectable SRAM errors; no rule in this check reads that field, so it is listed here rather than as a finding.`,
    });
  }
  if (counts.resetRequired > 0) {
    notes.push({
      level: "warning",
      message: `GPU Reset Status shows Reset Required or Drain and Reset Recommended: Yes on ${gpuCount(counts.resetRequired)}. No rule in this check reads that field, so it is listed here rather than as a finding.`,
    });
  }
  if (nvlinkGpus > 0 && total < 2 && downLinks.length > 0) {
    // A warning, so the text block prints it: the rule never looked at these
    // links, and the answer must not read like a clean NVLink (R2b-5).
    const ids = downLinks.slice(0, 8).join(", ") + (downLinks.length > 8 ? ` and ${downLinks.length - 8} more` : "");
    notes.push({
      level: "warning",
      message: `NVLink ${downLinks.length === 1 ? "link" : "links"} ${ids} report Down on the only GPU in this paste. The NVLink check needs output covering two or more GPUs, so it did not run: paste nvidia-smi nvlink --status for all GPUs.`,
    });
  } else if (nvlinkGpus > 0 && total < 2) {
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
    if (line.length <= MAX_LINE && line.includes(",") && csvHeader(line.replace(/\r$/, ""))) return true;
  }
  return false;
}

function hasSummaryTable(text: string): boolean {
  return text.includes(SUMMARY_ECC_HEADER) && text.includes("NVIDIA-SMI") && SUMMARY_BANNER_RE.test(text);
}

function hasBanner(text: string): boolean {
  if (!text.includes("NVSMI LOG")) return false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length <= MAX_LINE && line.includes("NVSMI LOG") && BANNER_LINE_RE.test(line.trim())) return true;
  }
  return false;
}

function parseUnsafe(text: string): ParserResult {
  // A dropped line becomes blank rather than vanishing, so a block around it
  // still ends where it did.
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => (l.length > MAX_LINE ? "" : l));
  const table = new GpuTable();
  const query = parseQuery(lines, table);
  const csv = parseCsv(lines, table);
  const nvlink = parseNvLink(lines, table);

  const formats: TriageFormat[] = [];
  // TriageFormat has no CSV member; the CSV is a `--query-gpu` query, so it
  // reports as nvidia_smi_query (see the integrator note).
  if (query.gpus > 0 || csv.gpus > 0) formats.push("nvidia_smi_query");
  if (nvlink.gpus > 0) formats.push("nvidia_smi_nvlink_status");

  const unopened = unopenedGpus(lines);
  if (table.list.length === 0) {
    // nvidia-smi's own failure output is read in full and reports why there
    // are no readings; it is not a cut-off paste to capture again (R2-9).
    let note: ParseNote | null = null;
    if (DRIVER_FAIL_RE.test(text)) {
      note = {
        level: "warning",
        message: "nvidia-smi reported that it could not communicate with the NVIDIA driver, so this paste has no GPU readings.",
      };
    } else if (unopened > 0) {
      note = unopenedNote(unopened);
    } else if (NO_DEVICES_RE.test(text)) {
      note = { level: "warning", message: "nvidia-smi reported no devices, so this paste has no GPU readings." };
    }
    if (note) return { domain: "nvidia_gpu", formats: [], snapshot: {}, subjects: 0, notes: [note], nothing_to_report: true };
    // Not nothing_to_report: that points at the kernel log, and the GPU
    // capture is the one this paste needs.
    if (hasSummaryTable(text)) {
      return {
        domain: "nvidia_gpu",
        formats: [],
        snapshot: {},
        subjects: 0,
        notes: [
          { level: "warning", message: SUMMARY_TABLE_NOTE },
          ...(nvlink.counterRows > 0 ? [{ level: "info" as const, message: NVLINK_COUNTERS_NOTE }] : []),
        ],
        recapture_why: "nvidia-smi -q prints every field the GPU checks read; the default summary table is not read.",
      };
    }
    if (nvlink.counterRows > 0) {
      return {
        domain: "nvidia_gpu",
        formats: [],
        snapshot: {},
        subjects: 0,
        notes: [{ level: "info", message: NVLINK_COUNTERS_NOTE }],
        recapture_goal: "nvlink",
        recapture_why: "nvidia-smi nvlink -e and -gt print counters, not link state; nvlink --status shows whether each link is up.",
      };
    }
    return {
      domain: "nvidia_gpu",
      formats: [],
      snapshot: {},
      subjects: 0,
      notes: [{ level: "info", message: "No GPU section with readable fields was found in the nvidia-smi output." }],
    };
  }

  const counts: BuildCounts = {
    tempMissing: 0,
    powerMissing: 0,
    reasonsMissing: 0,
    pcieSkipped: 0,
    eccSkipped: 0,
    remapGpus: 0,
    remapUncorrectable: 0,
    remapCorrectable: 0,
    remapPending: 0,
    remapFailure: 0,
    sramThreshold: 0,
    resetRequired: 0,
    vbiosSkipped: 0,
    widthOnly: 0,
    thermalBlind: 0,
    atSlowdown: 0,
  };
  const gpus = buildGpus(table.list, counts);
  const driver = query.driver ?? csv.driver;
  const n = gpus.length;
  const downLinks = n < 2 ? gpus.flatMap((g) => g.nvlink_links.filter((l) => l.state === "down").map((l) => l.link_id)) : [];
  const notes = buildNotes(n, counts, nvlink.gpus, nvlink.unmatched, table.dropped, downLinks);
  if (query.stripped > 0) {
    notes.push({
      level: "info",
      message: "The nvidia-smi -q output lost its indentation; its sections were read from the column its ':' separators line up in.",
    });
  }
  if (unopened > 0) notes.push(unopenedNote(unopened));
  if (nvlink.counterRows > 0) notes.push({ level: "info", message: NVLINK_COUNTERS_NOTE });
  // A rule is checked only when some GPU carries what it reads; a memory-only
  // CSV said six GPU rules "ran and found no matching signal" while its own
  // notes said each check was skipped (R2-17). nvlink_link_down returns
  // without reading any link below two GPUs in total (R2b-5).
  const fed: Record<(typeof RULES)[number], boolean> = {
    nvlink_link_down: nvlink.gpus > 0 && n >= 2,
    gpu_uncorrected_ecc: counts.eccSkipped < n,
    gpu_corrected_ecc_storm: counts.eccSkipped < n,
    gpu_thermal_critical: counts.thermalBlind < n,
    gpu_pcie_link_degraded: counts.pcieSkipped < n,
    gpu_power_cap_throttling: counts.reasonsMissing < n,
    gpu_driver_or_firmware_drift: driftComparable(table.list),
  };
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
    notes,
    // Link state comes only from `nvidia-smi nvlink --status`; every other
    // rule reads fields only -q or the CSV query carry, and only some GPUs or
    // some columns may have them.
    rules_checked: RULES.filter((r) => fed[r]),
  };
}

/** Two or more GPUs of one model, each with a product name and a VBIOS version: the drift check has something to compare. */
function driftComparable(raws: RawGpu[]): boolean {
  const byModel = new Map<string, { n: number; complete: boolean }>();
  for (const r of raws) {
    if (r.name === undefined) continue;
    const g = byModel.get(r.name) ?? { n: 0, complete: true };
    g.n++;
    if (r.vbios === undefined) g.complete = false;
    byModel.set(r.name, g);
  }
  return [...byModel.values()].some((g) => g.n >= 2 && g.complete);
}

export const nvidiaSmiParser: TriageParser = {
  domain: "nvidia_gpu",
  rules: RULES,
  notDeterminable: NOT_DETERMINABLE,
  detect(text: string): boolean {
    try {
      if (typeof text !== "string" || text.length === 0) return false;
      return (
        hasBanner(text) ||
        GPU_HEADER_LINE_RE.test(text) ||
        (NVLINK_GPU_LINE_RE.test(text) && NVLINK_LINK_LINE_RE.test(text)) ||
        DRIVER_FAIL_RE.test(text) ||
        hasSummaryTable(text) ||
        DEVICE_HANDLE_LINE_RE.test(text) ||
        NO_DEVICES_RE.test(text) ||
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
