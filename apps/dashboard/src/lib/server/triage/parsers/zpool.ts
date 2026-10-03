// Paste triage parser for `zpool status` (plain, -v, -x, and the -P / -L / -s /
// -t / -D variants: their extra columns and tables never put a zpool state in
// the second column, so rows are still keyed on NAME and STATE). Pool names are
// read as one token; ZFS allows spaces in them, but no tree row can be split
// unambiguously then. Logic ported from Crucible src/collect/zfs.ts (parseZpoolStatus plus
// the C6 vdev redundancy classification), with these paste-specific changes:
//
//   1. Tree depth is read relative to the NAME header (or the pool row) with
//      tabs expanded to 8 columns. Crucible matches the literal leading tab,
//      but a copied terminal often turns it into spaces.
//   2. last_scrub_date is never written. zfs_scrub_errors compares it with
//      Date.now(), and the time a paste was captured is unknown: an old paste
//      would report the paste's age as the scrub's age. The scrub-errors and
//      never-scrubbed branches of the rule read the paste alone and stay live.
//   3. A resilver or a canceled scrub on the scan line does not set
//      scrub_never_run. zpool status shows only the most recent scan, so an
//      earlier scrub is hidden there, not absent.
//   4. dRAID vdevs are classified from their real lowercase names
//      ("draid2:4d:8c:1s-0"); Crucible's startsWith("dRAID") never matches.
//   5. spare_in_progress (read by the evaluator's raidz2 branch) is set when a
//      top-level vdev holds a spare-N child with an ONLINE leaf. Crucible does
//      not emit the field yet.
//   6. When a pool's state is not ONLINE but no parsed vdev explains it (cut-off
//      paste, lost indentation), vdevs is omitted so the evaluator falls back
//      to judging the pool state instead of reporting nothing.
//
// Free text (status:, action:, the trailing message column, error file paths)
// is never copied. Names go through safeIdent; states must be a known zpool
// state; errors_text is rebuilt from constants and counts.

import type { Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent } from "../sanitize";
import type { ParseNote, ParserResult, TriageParser } from "../types";

type ZfsPool = NonNullable<Snapshot["zfs"]>["pools"][number];
type ZfsVdev = NonNullable<ZfsPool["vdevs"]>[number];

// States zpool prints in the STATE column (zpool_state_to_name, plus
// SUSPENDED from zpool_get_state_str). Anything else means the line is not a
// vdev row.
const VDEV_STATES = new Set(["ONLINE", "DEGRADED", "FAULTED", "OFFLINE", "UNAVAIL", "REMOVED", "SUSPENDED"]);
// Only rows in the `spares` section use these.
const SPARE_STATES = new Set(["AVAIL", "INUSE"]);
const SPARE_UNUSABLE = new Set(["FAULTED", "UNAVAIL", "REMOVED", "OFFLINE"]);

// Per-line matchers (input already split on \n, CR stripped).
const POOL_LINE = /^[ \t]*pool:[ \t]*(\S+)/;
const STATE_LINE = /^[ \t]*state:[ \t]*(\S+)/;
// "scrub:" is the label older Solaris-derived releases used for the same line.
const SCAN_LINE = /^[ \t]*(?:scan|scrub):[ \t]*(.*)$/;
const CONFIG_LINE = /^[ \t]*config:/;
const ERRORS_LINE = /^[ \t]*errors:[ \t]*(.*)$/;
const TABLE_HEADER = /^[ \t]*NAME[ \t]+STATE[ \t]+READ[ \t]+WRITE[ \t]+CKSUM\b/;
const CLASS_HEADER = /^[ \t]*(logs|cache|spares|special|dedup)[ \t]*$/;
const X_HEALTHY = /^[ \t]*(?:all pools are healthy|pool '[^'\n]{1,256}' is healthy)[ \t]*$/;
const X_NO_POOLS = /^[ \t]*no pools available[ \t]*$/;
// READ / WRITE / CKSUM cells: plain integers or zfs_nicenum values ("1.2K").
const COUNTER = /^\d+(?:\.\d+)?[KMGTPE]?$/;
const REPAIRED = /^\d+(?:\.\d+)?[BKMGTPEZ]?$/;
// Anchored to the start of the scan text: unanchored, `.*` re-ran from every
// "scrub repaired" in a long line and the scan went quadratic (R1-36).
const SCRUB_RESULT = /^scrub repaired (\S+) in .* with (\d+) errors?\b/;
/** zpool status lines are short (a -v file path is at most PATH_MAX); a longer line is skipped. */
const MAX_LINE = 4096;

// Whole-text sniffs for detect().
const DETECT_POOL = /^[ \t]*pool:[ \t]*\S/m;
const DETECT_STATE_OR_CONFIG = /^[ \t]*(?:state:[ \t]*[A-Z]|config:)/m;
const DETECT_HEADER = /^[ \t]*NAME[ \t]+STATE[ \t]+READ[ \t]+WRITE[ \t]+CKSUM\b/m;
const DETECT_X = /^[ \t]*(?:all pools are healthy|pool '[^'\n]{1,256}' is healthy|no pools available)[ \t]*\r?$/m;

type Section = "none" | "data" | "dedup" | "special" | "logs" | "cache" | "spares";

interface TopVdev {
  name: string;
  state: string;
  kind: "data" | "logs" | "cache";
  /** Depth of this vdev's immediate children, learned from the first child row. */
  childDepth: number | null;
  children: number;
  /** The most recent immediate child is a spare-N interior vdev. */
  inSpareChild: boolean;
  spareWithOnlineLeaf: boolean;
}

interface Block {
  /** null until the pool row names a block that started at a bare NAME header. */
  name: string | null;
  fromPoolHeader: boolean;
  stateLine: string | null;
  rowState: string | null;
  scan: "absent" | "none_requested" | "scrub" | "hidden" | "other";
  scrubErrors?: number;
  scrubRepaired?: string;
  scrubDateSeen: boolean;
  scrubInProgress: boolean;
  /** null = no errors: line yet, i.e. the block may be cut off. */
  errorsText: string | null;
  errorsKind: "none" | "count" | "permanent" | "unavailable" | "unrecognized" | null;
  permanentFiles: number;
  section: Section;
  /** Indent of the NAME header, or of the pool row when the header is missing. */
  base: number | null;
  topDepth: number | null;
  poolRowSeen: boolean;
  tops: TopVdev[];
  current: TopVdev | null;
  lastRowTop: TopVdev | null;
  flatRows: number;
  nonzeroCounterRows: number;
  sparesUnusable: number;
}

function newBlock(name: string | null, fromPoolHeader: boolean): Block {
  return {
    name,
    fromPoolHeader,
    stateLine: null,
    rowState: null,
    scan: "absent",
    scrubDateSeen: false,
    scrubInProgress: false,
    errorsText: null,
    errorsKind: null,
    permanentFiles: 0,
    section: "none",
    base: null,
    topDepth: null,
    poolRowSeen: false,
    tops: [],
    current: null,
    lastRowTop: null,
    flatRows: 0,
    nonzeroCounterRows: 0,
    sparesUnusable: 0,
  };
}

/** Leading whitespace width with tabs expanded to 8-column stops. */
function indentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w = w - (w % 8) + 8;
    else break;
  }
  return w;
}

// Ported from Crucible classifyVdevType, plus the lowercase dRAID fix.
function classifyVdevType(name: string): string {
  if (name.startsWith("mirror")) return "mirror";
  if (name.startsWith("raidz3")) return "raidz3";
  if (name.startsWith("raidz2")) return "raidz2";
  if (name.startsWith("raidz1")) return "raidz1";
  if (name.startsWith("raidz")) return "raidz1"; // bare "raidz" alias
  if (/^draid/i.test(name)) return "draid";
  // Any other top-level name is a single device: no redundancy.
  return "stripe";
}

// Ported from Crucible refineMirrorRedundancyClass: bare "mirror" stays when
// the width is unknown (0/1 children counted, or the paste was cut inside it).
function mirrorClass(children: number): string {
  if (children === 2) return "mirror_2way";
  if (children === 3) return "mirror_3way";
  if (children >= 4) return "mirror_4way+";
  return "mirror";
}

function readScan(b: Block, rest: string): void {
  if (/none requested/.test(rest)) {
    b.scan = "none_requested";
    return;
  }
  if (/\bresilver/.test(rest) || /\bcancel(?:l)?ed\b/.test(rest)) {
    b.scan = "hidden";
    return;
  }
  if (!/\bscrub\b/.test(rest)) {
    b.scan = "other";
    return;
  }
  b.scan = "scrub";
  if (/\bin progress\b|\bpaused\b/.test(rest)) b.scrubInProgress = true;
  const m = SCRUB_RESULT.exec(rest.trim());
  if (m && REPAIRED.test(m[1])) {
    b.scrubRepaired = m[1];
    b.scrubErrors = Number.parseInt(m[2], 10);
  }
  if (/\bon\s+\S/.test(rest)) b.scrubDateSeen = true;
}

// errors_text is rebuilt from constants and counts; the raw line never lands
// in the snapshot (the evaluator interpolates it into the alert message).
function readErrors(b: Block, rest: string): void {
  const count = /^(\d+) data errors?\b/.exec(rest);
  if (/^No known data errors\b/.test(rest)) {
    b.errorsKind = "none";
    b.errorsText = "No known data errors";
  } else if (count) {
    b.errorsKind = "count";
    b.errorsText = `${Number.parseInt(count[1], 10)} data errors`;
  } else if (/^Permanent errors have been detected\b/.test(rest)) {
    b.errorsKind = "permanent";
    b.errorsText = "Permanent errors have been detected";
  } else if (/^List of errors unavailable\b/.test(rest)) {
    b.errorsKind = "unavailable";
    b.errorsText = "List of errors unavailable";
  } else {
    b.errorsKind = "unrecognized";
    b.errorsText = "";
  }
}

const TREE_SECTIONS: ReadonlySet<Section> = new Set(["data", "dedup", "special", "logs", "cache", "spares"]);

function readTreeRow(b: Block, line: string): void {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return;
  const state = tokens[1];
  const spareRow = b.section === "spares";
  if (!VDEV_STATES.has(state) && !(spareRow && SPARE_STATES.has(state))) return;

  const indent = indentWidth(line);
  if (b.base === null) b.base = indent;
  const depth = indent - b.base;

  if (depth <= 0) {
    if (b.section === "data" && !b.poolRowSeen) {
      b.poolRowSeen = true;
      if (b.name === null) b.name = safeIdent(tokens[0]) || null;
      b.rowState = state;
    } else {
      // A second row at pool depth: the paste lost its tree indentation.
      b.flatRows += 1;
    }
    return;
  }

  if (tokens.slice(2, 5).some((t) => COUNTER.test(t) && Number.parseFloat(t) > 0)) {
    b.nonzeroCounterRows += 1;
  }

  if (b.topDepth === null || depth < b.topDepth) b.topDepth = depth;

  if (spareRow) {
    if (depth === b.topDepth && SPARE_UNUSABLE.has(state)) b.sparesUnusable += 1;
    return;
  }

  if (depth === b.topDepth) {
    const name = safeIdent(tokens[0]);
    if (!name) return;
    const top: TopVdev = {
      name,
      state,
      kind: b.section === "logs" ? "logs" : b.section === "cache" ? "cache" : "data",
      childDepth: null,
      children: 0,
      inSpareChild: false,
      spareWithOnlineLeaf: false,
    };
    b.tops.push(top);
    b.current = top;
    b.lastRowTop = top;
    return;
  }

  // Below a top-level vdev. Only rows at the first child depth count towards
  // the mirror width; deeper rows are the leaves of a replacing-N / spare-N
  // sub-vdev (Crucible Codex round-2 #1).
  const top = b.current;
  if (!top) return;
  b.lastRowTop = top;
  if (top.childDepth === null || depth <= top.childDepth) {
    top.childDepth = depth;
    top.children += 1;
    top.inSpareChild = /^spare-\d+$/.test(tokens[0]);
  } else if (top.inSpareChild && state === "ONLINE") {
    top.spareWithOnlineLeaf = true;
  }
}

interface Tally {
  skipped: number;
  flat: number;
  unexplained: number;
  cutOff: number;
  scrubDates: number;
  hiddenScans: number;
  scrubsRunning: number;
  dataErrors: number;
  unrecognizedErrors: number;
  nonzeroCounterRows: number;
  sparesUnusable: number;
}

function finalize(b: Block, tally: Tally): ZfsPool | null {
  const state = b.stateLine ?? b.rowState;
  if (!b.name || !state) {
    tally.skipped += 1;
    return null;
  }
  const terminated = b.errorsText !== null;
  const pool: ZfsPool = { name: b.name, state, errors_text: b.errorsText ?? "" };

  if (b.errorsKind === "permanent" && b.permanentFiles > 0) {
    pool.errors_text = `Permanent errors have been detected in ${b.permanentFiles} file(s)`;
  }
  if (b.scrubErrors !== undefined && b.scrubRepaired !== undefined) {
    pool.scrub_errors = b.scrubErrors;
    pool.scrub_repaired = b.scrubRepaired;
  }
  // Never scrubbed: the explicit "none requested", or a complete block (pool
  // and state header through the errors: line) with no scan line at all, which
  // is how OpenZFS 2.2+ prints a pool that was never scanned.
  if (
    b.scan === "none_requested" ||
    (b.scan === "absent" && terminated && b.fromPoolHeader && b.stateLine !== null)
  ) {
    pool.scrub_never_run = true;
  }

  if (b.flatRows > 0) {
    tally.flat += 1;
  } else {
    const cutInside = terminated ? null : b.lastRowTop;
    const vdevs: ZfsVdev[] = [];
    for (const t of b.tops) {
      if (t.kind !== "data") continue;
      let cls = classifyVdevType(t.name);
      if (cls === "mirror" && t !== cutInside) cls = mirrorClass(t.children);
      const v: ZfsVdev = { name: t.name, state: t.state, redundancy_class: cls };
      if (t.spareWithOnlineLeaf) v.spare_in_progress = true;
      vdevs.push(v);
    }
    pool.slog_vdevs = b.tops.filter((t) => t.kind === "logs").map((t) => ({ name: t.name, state: t.state }));
    pool.l2arc_vdevs = b.tops.filter((t) => t.kind === "cache").map((t) => ({ name: t.name, state: t.state }));
    const explained = b.tops.some((t) => t.state !== "ONLINE");
    if (state !== "ONLINE" && state !== "SUSPENDED" && !explained) {
      tally.unexplained += 1;
    } else {
      pool.vdevs = vdevs;
    }
  }

  if (!terminated) tally.cutOff += 1;
  if (b.scrubDateSeen) tally.scrubDates += 1;
  if (b.scan === "hidden") tally.hiddenScans += 1;
  if (b.scrubInProgress) tally.scrubsRunning += 1;
  if (b.errorsKind === "count" || b.errorsKind === "permanent") tally.dataErrors += 1;
  if (b.errorsKind === "unrecognized") tally.unrecognizedErrors += 1;
  tally.nonzeroCounterRows += b.nonzeroCounterRows;
  tally.sparesUnusable += b.sparesUnusable;
  return pool;
}

function buildNotes(t: Tally, poolCount: number, xHealthy: number, xNoPools: number): ParseNote[] {
  const notes: ParseNote[] = [];
  if (xHealthy > 0) {
    notes.push({
      level: "info",
      message:
        "zpool status -x printed only its summary line, which carries no pool state or vdev tree, so no pool was evaluated from it. Run zpool status without -x to check each pool.",
    });
  }
  if (xNoPools > 0) {
    notes.push({ level: "info", message: "zpool reported no pools available, so there was no pool to evaluate." });
  }
  if (poolCount === 0 && xHealthy === 0 && xNoPools === 0) {
    notes.push({ level: "info", message: "No zpool status pool block was recognized in this output." });
  }
  if (t.skipped > 0) {
    notes.push({ level: "info", message: `${t.skipped} pool block(s) had no readable pool name or state and were skipped.` });
  }
  if (t.cutOff > 0) {
    notes.push({
      level: "warning",
      message: `${t.cutOff} pool block(s) end before their errors: line, so the output looks cut off and a vdev listed last may be incomplete.`,
    });
  }
  if (t.flat > 0) {
    notes.push({
      level: "warning",
      message: `The vdev tree indentation was lost for ${t.flat} pool(s), so per-vdev redundancy could not be read; only the pool state was judged.`,
    });
  }
  if (t.unexplained > 0) {
    notes.push({
      level: "warning",
      message: `${t.unexplained} pool(s) are not ONLINE but no vdev row in this output explains it; the pool state was judged instead of individual vdevs.`,
    });
  }
  if (t.scrubDates > 0) {
    notes.push({
      level: "info",
      message: `A last-scrub date was read for ${t.scrubDates} pool(s) but its age was not judged: the time this output was captured is unknown.`,
    });
  }
  if (t.hiddenScans > 0) {
    notes.push({
      level: "info",
      message: `For ${t.hiddenScans} pool(s) the last scan shown is a resilver or a canceled scrub; zpool status shows only the most recent scan, so earlier scrubs are not visible here.`,
    });
  }
  if (t.scrubsRunning > 0) {
    notes.push({
      level: "info",
      message: `A scrub is in progress or paused on ${t.scrubsRunning} pool(s); its error count is printed only when it finishes.`,
    });
  }
  if (t.dataErrors > 0) {
    notes.push({
      level: "warning",
      message: `${t.dataErrors} pool(s) report data errors on the errors: line. No Glassmkr rule fires on that line by itself; list the affected files with zpool status -v.`,
    });
  }
  if (t.unrecognizedErrors > 0) {
    notes.push({ level: "info", message: `The errors: line of ${t.unrecognizedErrors} pool(s) was not in a recognized form and was not used.` });
  }
  if (t.nonzeroCounterRows > 0) {
    notes.push({
      level: "warning",
      message: `${t.nonzeroCounterRows} vdev row(s) show nonzero READ, WRITE or CKSUM counters. No Glassmkr rule judges these per-device counters from one reading; check the named devices with smartctl.`,
    });
  }
  if (t.sparesUnusable > 0) {
    notes.push({
      level: "warning",
      message: `${t.sparesUnusable} hot spare(s) are listed as FAULTED, UNAVAIL, REMOVED or OFFLINE. No Glassmkr rule judges hot spares.`,
    });
  }
  return notes;
}

function parse(text: string): ParserResult {
  const tally: Tally = {
    skipped: 0, flat: 0, unexplained: 0, cutOff: 0, scrubDates: 0, hiddenScans: 0,
    scrubsRunning: 0, dataErrors: 0, unrecognizedErrors: 0, nonzeroCounterRows: 0, sparesUnusable: 0,
  };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  // Block whose `errors: Permanent errors ...` file list is being counted.
  let files: Block | null = null;
  let xHealthy = 0;
  let xNoPools = 0;

  const clean = typeof text === "string" ? text : "";
  const lines = clean
    .replace(/\x1b\[[0-9;]*m/g, "") // ANSI color from `script` captures or ZFS_COLOR
    .replace(/\r\n?/g, "\n")
    .split("\n");

  for (const line of lines) {
    if (line.length > MAX_LINE) continue;
    // `zpool status -v` file list: 8-space indented paths or dataset:<0xN>
    // entries, ended by a blank line. Read before POOL_LINE because the entry
    // for a pool literally named "pool" is "pool:<0x1>"; a real pool header is
    // indented by 2 and comes after a blank line.
    if (files) {
      if (line.trim() === "") {
        if (files.permanentFiles > 0) files = null;
        continue;
      }
      if (/^[ \t]/.test(line) && !(indentWidth(line) <= 4 && POOL_LINE.test(line))) {
        files.permanentFiles += 1;
        continue;
      }
      files = null;
    }

    const pool = POOL_LINE.exec(line);
    if (pool) {
      cur = newBlock(safeIdent(pool[1]) || null, true);
      blocks.push(cur);
      continue;
    }

    if (TABLE_HEADER.test(line)) {
      if (!cur || cur.errorsText !== null || cur.base !== null) {
        // A tree without its pool: header (paste starts at the table).
        cur = newBlock(null, false);
        blocks.push(cur);
      }
      cur.section = "data";
      cur.base = indentWidth(line);
      continue;
    }

    if (X_HEALTHY.test(line)) {
      xHealthy += 1;
      cur = null;
      continue;
    }
    if (X_NO_POOLS.test(line)) {
      xNoPools += 1;
      cur = null;
      continue;
    }

    if (!cur) continue;

    const errors = ERRORS_LINE.exec(line);
    if (errors) {
      readErrors(cur, errors[1].trim());
      if (cur.errorsKind === "permanent") files = cur;
      cur = null; // errors: is the last line of a pool block
      continue;
    }

    if (cur.section === "none") {
      const state = STATE_LINE.exec(line);
      if (state) {
        if (VDEV_STATES.has(state[1])) cur.stateLine = state[1];
        continue;
      }
      const scan = SCAN_LINE.exec(line);
      if (scan) {
        readScan(cur, scan[1]);
        continue;
      }
      if (CONFIG_LINE.test(line)) cur.section = "data";
      continue;
    }

    const cls = CLASS_HEADER.exec(line);
    if (cls) {
      cur.section = cls[1] as Section;
      cur.topDepth = null;
      cur.current = null;
      continue;
    }

    if (TREE_SECTIONS.has(cur.section)) readTreeRow(cur, line);
  }

  const pools: ZfsPool[] = [];
  for (const b of blocks) {
    const p = finalize(b, tally);
    if (p) pools.push(p);
  }

  const recognized = pools.length > 0 || xHealthy > 0 || xNoPools > 0;
  return {
    domain: "zfs",
    formats: recognized ? ["zpool_status"] : [],
    snapshot: pools.length > 0 ? { zfs: { pools } } : {},
    subjects: pools.length,
    notes: buildNotes(tally, pools.length, xHealthy, xNoPools),
  };
}

function detect(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return (
    (DETECT_POOL.test(text) && DETECT_STATE_OR_CONFIG.test(text)) ||
    DETECT_HEADER.test(text) ||
    DETECT_X.test(text)
  );
}

export const zpoolParser: TriageParser = {
  domain: "zfs",
  // All three read only what one `zpool status` shows. zfs_scrub_errors also
  // has a scrub-age branch, which this parser never feeds (see header note 2).
  rules: ["zfs_pool_unhealthy", "zfs_scrub_errors", "zfs_slog_faulted"],
  notDeterminable: [
    {
      signal: "Time since the last scrub",
      reason: "The output shows when the last scrub ran but not when it was captured, so the scrub's age is unknown",
    },
    {
      signal: "READ/WRITE/CKSUM error growth",
      reason: "Counters are cumulative since the last zpool clear or import; growth needs a second reading",
    },
    {
      signal: "Scrubs before the most recent scan",
      reason: "zpool status shows only the latest scrub or resilver; older scans are in zpool history",
    },
  ],
  detect,
  parse,
};
