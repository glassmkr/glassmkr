// Paste triage parser for Linux software RAID: /proc/mdstat and
// `mdadm --detail /dev/mdX` (one or several, in any order, with or without
// shell prompts between them). Fills Snapshot.raid with the same shape
// Crucible's collector sends, so the evaluator's raid_degraded rule and
// resolveFailedMembers() (raid-members.ts) name the failed member(s).
// /proc/mdstat logic ported from crucible src/collect/raid.ts (collectRaid).
//
// Failed member semantics, the part a user acts on (pulling the wrong drive is
// data-loss-grade):
//   - /proc/mdstat: only a member flagged (F) is failed. The kernel prints
//     (F) for every Faulty rdev still attached; a member that left the array
//     is not listed at all, so its empty slot cannot be named. A listed
//     member with no flag sitting in a "_" slot is attached but not yet in
//     sync: the rebuild target, which mdadm --detail calls "spare
//     rebuilding". Crucible maps "_" positions to the bracket number and
//     would name that member failed; here it is counted as rebuilding
//     instead. The bracket number is also the descriptor number, not the
//     slot, once a disk has been replaced, so it is never used to name one.
//   - mdadm --detail: a row whose state contains "faulty" is failed. A
//     "removed" row has no device and stays unnamed.
//   - An unnamed slot keeps the array degraded with no invented member name;
//     raid-members.ts then has nothing to resolve and the evaluator says
//     "unknown", which is the honest answer for that output.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent } from "../sanitize";
import type { ParseNote, ParserResult, TriageFormat, TriageParser } from "../types";

type RaidEntry = Snapshot["raid"][number];

interface ArrayFacts {
  entry: RaidEntry;
  /** An empty slot whose former member is not named anywhere in the output. */
  unnamedSlot: boolean;
  /** A member is attached to a slot but not yet in sync (rebuild target). */
  rebuilding: boolean;
  /** A failed or missing device the output does not name (truncated table). */
  unnamedFailed: boolean;
  /** A resync, recovery, check or reshape is running or queued. */
  syncActive: boolean;
  /** Nothing in the output gives per-member status (slot map, State, table). */
  statusMissing: boolean;
}

// md personalities as the kernel names them in /proc/mdstat and mdadm prints
// them in "Raid Level". "container" is an IMSM / DDF metadata container.
const LEVEL_RE = /^(?:raid(?:0|1|4|5|6|10)|linear|multipath|faulty|container)$/;
// Personalities whose mdstat entry never carries a "[n/m] [UU]" slot map.
const NO_SLOT_MAP_RE = /^(?:raid0|linear|faulty)$/;

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

// /proc/mdstat
const MDSTAT_ARRAY_RE = /^\s*(md[A-Za-z0-9_]+)\s*:\s*(active|inactive|broken)\b(.*)$/;
const MDSTAT_HEAD_RE = /^\s*Personalities\s*:/;
const MDSTAT_UNUSED_RE = /^\s*unused devices\s*:/;
// "sdb1[1]", "nvme1n1p3[1](W)(F)", "sdi1[2](S)". Whitespace-delimited so
// prose around a token on the same line never becomes part of a name.
const MEMBER_RE = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9._-]*)\[(\d{1,5})\]((?:\([A-Z]\))*)(?=\s|$)/g;
// "[4/3] [U_UU]": raid devices / in-sync devices, then one char per slot.
const SLOT_MAP_RE = /\[(\d{1,4})\/(\d{1,4})\]\s*\[([U_]{1,512})\]/;
const SYNC_RE = /\b(?:resync|recovery|recover|check|reshape|repair)\s*=\s*(?:\d|DELAYED|PENDING)/;
// An IMSM / DDF container line ("super external:imsm"); its volumes read
// "super external:/md127/0" and are real arrays.
const CONTAINER_RE = /\bsuper\s+external:(?:imsm|ddf)\b/;
// Continuation lines (blocks, progress, bitmap) a single mdstat array has.
const MDSTAT_MAX_CONTINUATION = 8;

// mdadm --detail
const DETAIL_HEAD_RE = /^\s*\/dev\/(md(?:\/[A-Za-z0-9_.:+-]+|[A-Za-z0-9_]*))\s*:\s*$/;
// Another device's header, e.g. `mdadm --examine /dev/sda1` output.
const FOREIGN_HEAD_RE = /^\s*\/dev\/(?!md)[A-Za-z0-9_.\/-]+\s*:\s*$/;
// Value is trimmed in code: a lazy "(.*?)\s*$" backtracks quadratically on a
// long run of spaces.
const DETAIL_KV_RE = /^\s*([A-Z][A-Za-z ]{1,30}?)\s*:(.*)$/;
const DETAIL_TABLE_RE = /^\s*Number\s+Major\s+Minor\s+RaidDevice\b/;
const DETAIL_ROW_RE = /^\s*(\d{1,5}|-)\s+(\d{1,5}|-)\s+(\d{1,7}|-)\s+(\d{1,5}|-)(?:\s+(.*))?$/;
const DEV_PATH_RE = /(?:^|\s)\/dev\/([A-Za-z0-9][A-Za-z0-9._\/-]*)/;
const DETAIL_MAX_LINES = 1024;
// Far above any real host (mdadm 1.x metadata allows 384 members per array);
// only there to bound work on a hostile 200 KB paste.
const MAX_MEMBERS = 512;
const MAX_ARRAYS = 512;
const SYNC_STATUS_KEYS = ["Rebuild Status", "Resync Status", "Check Status", "Reshape Status"];

// A shell prompt ends the output block above it: "root@host:~# ...",
// "[root@host ~]# ...", "user@host:~$ ...", "$ ...", "# ...".
const PROMPT_RE = /^\s*(?:(?:\[[^\]]{1,120}\]|[^\s#$%]{1,120}@[^\s#$%]{1,120})\s*[#$%]|[#$])(?:\s|$)/;

// Cheap multiline sniffs for detect().
const DETECT_MDSTAT_ARRAY = /^[ \t]*md[A-Za-z0-9_]+[ \t]*:[ \t]*(?:active|inactive|broken)\b/m;
const DETECT_MDSTAT_HEAD = /^[ \t]*Personalities[ \t]*:/m;
const DETECT_DETAIL_TABLE = /^[ \t]*Number[ \t]+Major[ \t]+Minor[ \t]+RaidDevice\b/m;
const DETECT_DETAIL_HEAD = /^[ \t]*\/dev\/md[^\s:]*[ \t]*:[ \t]*\r?$/m;
const DETECT_DETAIL_KEY = /^[ \t]*(?:Raid Level|State)[ \t]*:/m;

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

function intField(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^(\d{1,6})\b/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** First whitespace token, validated against the md personality list. */
function validLevel(value: string | undefined): string | null {
  const token = (value ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return LEVEL_RE.test(token) ? token : null;
}

function endsBlock(line: string): boolean {
  return (
    MDSTAT_ARRAY_RE.test(line) ||
    MDSTAT_HEAD_RE.test(line) ||
    DETAIL_HEAD_RE.test(line) ||
    FOREIGN_HEAD_RE.test(line) ||
    PROMPT_RE.test(line)
  );
}

/** One /proc/mdstat array: the "mdN : ..." line plus its continuation lines. */
function readMdstatArray(lines: string[], start: number, match: RegExpExecArray): { facts: ArrayFacts | null; next: number } {
  const device = safeIdent(match[1]);
  const state = match[2];
  let rest = match[3].replace(/^\s*\((?:auto-)?read-only\)/, "");

  let level = "unknown";
  const lm = /^\s*([A-Za-z0-9]+)(?=\s|$)/.exec(rest);
  const lv = lm ? validLevel(lm[1]) : null;
  if (lm && lv) {
    level = lv;
    rest = rest.slice(lm[0].length);
  }

  const members: Array<{ name: string; flags: Set<string> }> = [];
  const seen = new Set<string>();
  for (const m of rest.matchAll(MEMBER_RE)) {
    const name = safeIdent(m[1]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    members.push({ name, flags: new Set(m[3].match(/[A-Z]/g) ?? []) });
    if (members.length >= MAX_MEMBERS) break;
  }

  let slotMap: { total: number; inSync: number; map: string } | null = null;
  let syncActive = false;
  let container = false;
  let j = start + 1;
  for (; j < lines.length && j <= start + MDSTAT_MAX_CONTINUATION; j++) {
    const line = lines[j];
    if (line.trim() === "" || MDSTAT_UNUSED_RE.test(line) || endsBlock(line)) break;
    if (!slotMap) {
      const s = SLOT_MAP_RE.exec(line);
      if (s) slotMap = { total: Number(s[1]), inSync: Number(s[2]), map: s[3] };
    }
    if (SYNC_RE.test(line)) syncActive = true;
    if (CONTAINER_RE.test(line)) container = true;
  }
  if (!device) return { facts: null, next: j };
  if (container && state === "inactive") level = "container";

  const failed = members.filter((m) => m.flags.has("F")).map((m) => m.name);
  // Members holding a slot: not failed, not a spare, not a raid5 journal.
  const slotted = members.filter((m) => !m.flags.has("F") && !m.flags.has("S") && !m.flags.has("J")).length;
  let missing = 0;
  let rebuildingCount = 0;
  if (slotMap) {
    const holes = slotMap.map.split("").filter((c) => c === "_").length;
    missing = Math.max(holes, slotMap.total - slotMap.inSync, 0);
    rebuildingCount = Math.max(0, slotted - slotMap.inSync);
  }

  return {
    facts: {
      entry: {
        device,
        level,
        status: state,
        // Crucible semantics: a missing slot OR any (F) member. A failed
        // member already replaced by an in-sync spare still needs a swap.
        degraded: missing > 0 || failed.length > 0 || state === "broken",
        disks: members.map((m) => m.name),
        failed_disks: failed,
      },
      unnamedSlot: missing > rebuildingCount + failed.length,
      rebuilding: rebuildingCount > 0,
      unnamedFailed: false,
      syncActive,
      // Cut off before the "[n/m] [UU]" line: a missing slot is invisible.
      statusMissing: !slotMap && state === "active" && !NO_SLOT_MAP_RE.test(level),
    },
    next: j,
  };
}

interface DetailRow {
  raidDevice: string;
  name: string;
  faulty: boolean;
  removed: boolean;
  rebuilding: boolean;
}

/** One `mdadm --detail` block: the "/dev/mdX:" header, key lines, device table. */
function readDetailBlock(lines: string[], start: number, rawName: string): { facts: ArrayFacts | null; next: number } {
  const device = safeIdent(rawName);
  const kv = new Map<string, string>();
  const rows: DetailRow[] = [];
  let tableSeen = false;
  let j = start + 1;
  for (; j < lines.length && j <= start + DETAIL_MAX_LINES; j++) {
    const line = lines[j];
    if (endsBlock(line)) break;
    if (line.trim() === "") continue;
    if (DETAIL_TABLE_RE.test(line)) {
      tableSeen = true;
      continue;
    }
    if (tableSeen) {
      const r = DETAIL_ROW_RE.exec(line);
      if (!r) break; // the first non-row line after the table is other output
      const rest = r[5] ?? "";
      const pm = DEV_PATH_RE.exec(rest);
      const name = pm ? safeIdent(pm[1]) : "";
      const words = (pm ? rest.slice(0, pm.index) : rest).toLowerCase().split(/[\s,]+/).filter(Boolean);
      const faulty = words.includes("faulty");
      if (rows.length >= MAX_MEMBERS) continue;
      rows.push({
        raidDevice: r[4],
        name,
        faulty,
        removed: !name && words.includes("removed"),
        rebuilding: !faulty && words.includes("rebuilding"),
      });
      continue;
    }
    const m = DETAIL_KV_RE.exec(line);
    if (m && !kv.has(m[1])) kv.set(m[1], m[2].trim());
  }

  const recognized = kv.has("Raid Level") || kv.has("State") || kv.has("Raid Devices") || rows.length > 0;
  if (!device || !recognized) return { facts: null, next: j };

  const stateRaw = kv.get("State");
  const stateWords = (stateRaw ?? "").toLowerCase().split(/[\s,()]+/).filter(Boolean);
  const inactive = stateWords.includes("inactive");
  const broken = stateWords.includes("broken");

  let level = validLevel(kv.get("Raid Level")) ?? "unknown";
  // mdadm reports a misleading level (often raid0) for an array that is not
  // running, so only a container keeps its level when inactive.
  if (inactive && level !== "container") level = "unknown";

  const failed: string[] = [];
  const disks: string[] = [];
  for (const row of rows) {
    if (row.name) pushUnique(disks, row.name);
    if (row.faulty && row.name) pushUnique(failed, row.name);
  }
  const namelessFaulty = rows.filter((r) => r.faulty && !r.name).length;
  const removedSlots = rows.filter((r) => r.removed).length;
  // mdadm 4.x prints a detached faulty member below the slot table with
  // RaidDevice "-" and shows its old slot as "removed": that pair is one
  // named failure, not an unnamed one.
  const detachedFaulty = rows.filter((r) => r.faulty && r.name && r.raidDevice === "-").length;
  const failedDevices = intField(kv.get("Failed Devices"));
  const raidDevices = intField(kv.get("Raid Devices"));
  const activeDevices = intField(kv.get("Active Devices"));
  const countedNotNamed = namelessFaulty > 0 || (failedDevices !== null && failedDevices > failed.length);

  const degraded =
    stateWords.includes("degraded") ||
    stateWords.includes("failed") ||
    broken ||
    removedSlots > 0 ||
    failed.length > 0 ||
    countedNotNamed ||
    (stateRaw === undefined && raidDevices !== null && activeDevices !== null && activeDevices < raidDevices);
  // Degraded with no device table at all (paste cut before it): the affected
  // member exists but this output does not say which it is.
  const unnamedFailed = countedNotNamed || (!tableSeen && degraded && failed.length === 0);

  const syncActive =
    stateWords.some((w) => w === "recovering" || w === "resyncing" || w === "checking" || w === "reshaping") ||
    SYNC_STATUS_KEYS.some((k) => kv.has(k)) ||
    rows.some((r) => r.rebuilding);

  return {
    facts: {
      entry: {
        device,
        level,
        status: inactive ? "inactive" : broken ? "broken" : stateRaw !== undefined ? "active" : "unknown",
        degraded,
        disks,
        failed_disks: failed,
      },
      unnamedSlot: removedSlots > detachedFaulty,
      rebuilding: rows.some((r) => r.rebuilding),
      unnamedFailed,
      syncActive,
      statusMissing: stateRaw === undefined && rows.length === 0,
    },
    next: j,
  };
}

function mergeFacts(into: ArrayFacts, add: ArrayFacts): void {
  const a = into.entry;
  const b = add.entry;
  if (a.level === "unknown") a.level = b.level;
  if (a.status === "unknown") a.status = b.status;
  for (const d of b.disks) pushUnique(a.disks, d);
  for (const d of b.failed_disks) pushUnique(a.failed_disks, d);
  a.degraded = a.degraded || b.degraded;
  into.unnamedSlot = into.unnamedSlot || add.unnamedSlot;
  into.rebuilding = into.rebuilding || add.rebuilding;
  // One source naming the failed member (mdstat's (F)) settles a truncated
  // table in the other; two sources that both leave it unnamed do not.
  into.unnamedFailed =
    (into.unnamedFailed && add.unnamedFailed) || ((into.unnamedFailed || add.unnamedFailed) && a.failed_disks.length === 0);
  into.syncActive = into.syncActive || add.syncActive;
  into.statusMissing = into.statusMissing && add.statusMissing;
}

/** Same array within one source: same name (the output was pasted twice). */
function mergeByName(list: ArrayFacts[], add: ArrayFacts): boolean {
  const hit = list.find((x) => x.entry.device === add.entry.device);
  if (hit) mergeFacts(hit, add);
  else if (list.length < MAX_ARRAYS) list.push(add);
  else return false;
  return true;
}

/**
 * Join an mdadm --detail array onto its /proc/mdstat line: same name, or (for
 * /dev/md/NAME vs the kernel's mdNNN) a shared member, since a block device
 * belongs to one array at a time. Containers share disks with their volumes,
 * so they only ever join by name.
 */
function findSameArray(list: ArrayFacts[], add: ArrayFacts): ArrayFacts | undefined {
  const byName = list.find((x) => x.entry.device === add.entry.device);
  if (byName || add.entry.level === "container") return byName;
  const disks = new Set(add.entry.disks);
  return list.find((x) => x.entry.level !== "container" && x.entry.disks.some((d) => disks.has(d)));
}

function arrays(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 array ${singular}` : `${n} arrays ${plural}`;
}

function parse(text: string): ParserResult {
  const empty = (notes: ParseNote[]): ParserResult => ({ domain: "mdraid", formats: [], snapshot: {}, subjects: 0, notes });
  if (typeof text !== "string" || text.length === 0) {
    return empty([{ level: "info", message: "No /proc/mdstat or mdadm --detail output was recognized." }]);
  }

  const lines = text.replace(ANSI_RE, "").replace(/\r\n?/g, "\n").split("\n");
  const formats = new Set<TriageFormat>();
  const mdstat: ArrayFacts[] = [];
  const detail: ArrayFacts[] = [];
  let orphanDetail = false;
  let foreignHeader = false;
  let dropped = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (MDSTAT_HEAD_RE.test(line)) {
      formats.add("proc_mdstat");
      foreignHeader = false;
      i++;
      continue;
    }
    const am = MDSTAT_ARRAY_RE.exec(line);
    if (am) {
      formats.add("proc_mdstat");
      foreignHeader = false;
      const { facts, next } = readMdstatArray(lines, i, am);
      if (facts && !mergeByName(mdstat, facts)) dropped = true;
      i = Math.max(next, i + 1);
      continue;
    }
    const dh = DETAIL_HEAD_RE.exec(line);
    if (dh) {
      foreignHeader = false;
      const { facts, next } = readDetailBlock(lines, i, dh[1]);
      if (facts) {
        formats.add("mdadm_detail");
        if (!mergeByName(detail, facts)) dropped = true;
      }
      i = Math.max(next, i + 1);
      continue;
    }
    if (FOREIGN_HEAD_RE.test(line)) foreignHeader = true;
    else if (PROMPT_RE.test(line)) foreignHeader = false;
    else if (!foreignHeader && (DETAIL_TABLE_RE.test(line) || /^\s*Raid Level\s*:/.test(line))) {
      // mdadm --detail content whose "/dev/mdX:" line was cut off: the
      // array cannot be named, so it is reported, not evaluated.
      orphanDetail = true;
      formats.add("mdadm_detail");
    }
    i++;
  }

  const merged = mdstat.slice();
  for (const d of detail) {
    const hit = findSameArray(merged, d);
    if (hit) mergeFacts(hit, d);
    else if (merged.length < MAX_ARRAYS) merged.push(d);
    else dropped = true;
  }

  if (formats.size === 0) {
    return empty([{ level: "info", message: "No /proc/mdstat or mdadm --detail output was recognized." }]);
  }

  const notes: ParseNote[] = [];
  const count = (pick: (a: ArrayFacts) => boolean) => merged.filter(pick).length;
  const unnamedSlot = count((a) => a.unnamedSlot);
  if (unnamedSlot > 0) {
    notes.push({
      level: "warning",
      message: `${arrays(unnamedSlot, "has", "have")} an empty slot whose former member is not named in this output (the device was removed), so that failed disk cannot be identified from this paste.`,
    });
  }
  const unnamedFailed = count((a) => a.unnamedFailed);
  if (unnamedFailed > 0) {
    notes.push({
      level: "warning",
      message: `${arrays(unnamedFailed, "reports", "report")} a failed or missing device that this output does not name; paste the complete mdadm --detail output to see it.`,
    });
  }
  const statusMissing = count((a) => a.statusMissing);
  if (statusMissing > 0) {
    notes.push({
      level: "warning",
      message: `${arrays(statusMissing, "has", "have")} no member status line in this output (it may be cut off), so a missing or failed member cannot be ruled out.`,
    });
  }
  const broken = count((a) => a.entry.status === "broken");
  if (broken > 0) {
    notes.push({
      level: "warning",
      message: `${arrays(broken, "is", "are")} marked broken by the kernel: a member device the array needs is missing.`,
    });
  }
  const inactive = count((a) => a.entry.status === "inactive" && a.entry.level !== "container");
  if (inactive > 0) {
    notes.push({
      level: "warning",
      message: `${arrays(inactive, "is", "are")} inactive (not running); this output cannot show whether all of its members are present.`,
    });
  }
  const rebuilding = count((a) => a.rebuilding);
  if (rebuilding > 0) {
    notes.push({
      level: "info",
      message: `${arrays(rebuilding, "has", "have")} a member attached but not yet in sync (rebuilding or waiting to rebuild); it is not counted as a failed disk.`,
    });
  }
  const syncActive = count((a) => a.syncActive);
  if (syncActive > 0) {
    notes.push({
      level: "info",
      message: `${arrays(syncActive, "has", "have")} a resync, recovery, check or reshape running or queued.`,
    });
  }
  if (orphanDetail) {
    notes.push({
      level: "warning",
      message: "Part of an mdadm --detail output was found without its /dev/mdX header line, so it was not evaluated; paste the output from its first line.",
    });
  }
  if (dropped) {
    notes.push({ level: "warning", message: `Only the first ${MAX_ARRAYS} md arrays in this paste were read.` });
  }
  if (formats.has("proc_mdstat") && mdstat.length === 0) {
    notes.push({ level: "info", message: "The /proc/mdstat output in this paste lists no md arrays." });
  }

  return {
    domain: "mdraid",
    formats: [...formats],
    snapshot: { raid: merged.map((a) => a.entry) },
    subjects: merged.length,
    notes,
  };
}

export const mdraidParser: TriageParser = {
  domain: "mdraid",
  // Verified against evaluator.ts: raid_degraded is the only rule that reads
  // snap.raid to fire (disk_latency_high reads it only to suppress, and needs
  // disk_io from another source). It needs no history.
  rules: ["raid_degraded"],
  notDeterminable: [
    {
      signal: "Rebuild or resync progress rate",
      reason: "Whether a recovery is advancing or stalled needs two readings minutes apart; one paste is a single point",
    },
    {
      signal: "Members that dropped out and re-joined",
      reason: "A member that failed and was re-added before this output was captured leaves no trace in it; that needs continuous readings",
    },
    {
      signal: "When the array became degraded",
      reason: "Neither /proc/mdstat nor mdadm --detail records when a member failed; that needs continuous readings or the timestamped kernel log",
    },
  ],
  detect(text: string): boolean {
    if (typeof text !== "string" || text.length === 0) return false;
    return (
      DETECT_MDSTAT_ARRAY.test(text) ||
      DETECT_MDSTAT_HEAD.test(text) ||
      DETECT_DETAIL_TABLE.test(text) ||
      (DETECT_DETAIL_HEAD.test(text) && DETECT_DETAIL_KEY.test(text))
    );
  },
  parse(text: string): ParserResult {
    try {
      return parse(text);
    } catch {
      // Contract: parse() never throws. Nothing above should, but a paste is
      // arbitrary input and the caller must always get a result.
      return {
        domain: "mdraid",
        formats: [],
        snapshot: {},
        subjects: 0,
        notes: [{ level: "warning", message: "The mdraid output could not be read." }],
      };
    }
  },
};
