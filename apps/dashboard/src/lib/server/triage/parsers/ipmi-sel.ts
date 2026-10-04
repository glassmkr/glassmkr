// Paste triage parser for BMC (IPMI) output. Reads, from one paste:
//   - `ipmitool sel elist` and `ipmitool sel list`: System Event Log rows
//   - `ipmitool sel info`: entry count, percent used, overflow flag
//   - the fan and power supply rows of `ipmitool sdr type Fan`,
//     `ipmitool sdr [e]list` and `ipmitool sensor`
// and maps them to Snapshot.ipmi the way the live collector does, so
// ipmi_sel_critical, ipmi_sel_full, ecc_errors (SEL half), ipmi_fan_failure
// and psu_redundancy_loss read it unchanged.
//
// Ported from crucible src/collect/ipmi.ts (collectSelEvents pipe split,
// parseSelTimestamp, classifySensor, deriveSelSeverity, parseSelEccCounts,
// parseSelInfo, parseFanStatus). Where a paste differs from a live probe the
// port differs too, on purpose:
//   - No last-20 truncation: every SEL row counts, up to MAX_SEL_EVENTS (the
//     most recent are kept).
//   - A Pre-Init, OEM or unreadable timestamp becomes "" (unknown), never the
//     current time. The evaluator reads "" as "age unknown".
//   - Record ids are hex: ipmitool prints them with %4x.
//   - ECC counts only asserted rows; a deassertion is not another error.
//   - Fan status also maps the extended threshold codes (lcr, lnr, ucr, unr,
//     lnc, unc) that `sdr type` and `sdr elist` print in place of cr / nr / nc.
//   - The live collector reads power supplies from `ipmitool sensor` only. An
//     sdr power supply row prints "ok" for every readable discrete state, so
//     its state text ("Failure detected", "Power Supply AC lost") sets the
//     status instead, and Dell's "PS Redundancy" row fills
//     psu_redundancy_state the way Crucible's classifier does.
// Assert / deassert pairing stays in the evaluator, exactly as for a live
// agent: every row keeps its own direction, and both halves of a pair are
// sanitized identically so ipmi_sel_critical can still match them.

import { isSelLogFullEventText, type Snapshot } from "$lib/server/alerts/evaluator";
import { safeIdent, safeLabel } from "../sanitize";
import type { ParseNote, ParserResult, TriageFormat, TriageParser } from "../types";

type IpmiSlice = Snapshot["ipmi"];
type SelEvent = NonNullable<IpmiSlice["sel_events_recent"]>[number];
type FanStatus = NonNullable<IpmiSlice["fans"]>[number];
type SensorReading = IpmiSlice["sensors"][number];
type EccFromSel = NonNullable<IpmiSlice["ecc_errors_from_sel"]>;

/** A full SEL holds a few thousand records; past this it is not one BMC's log. */
const MAX_SEL_EVENTS = 4096;

// Length caps at the real field sizes, tighter than the sanitize default, so
// text smuggled into a matching row cannot survive as a sentence.
/** IPMI SDR ID strings are at most 16 bytes; ipmitool pads sensor names to 16. */
const NAME_MAX = 16;
/** SEL sensor column is "<sensor type> <SDR name>": longest type string (27) + 1 + 16. */
const SEL_SENSOR_MAX = 48;
/** Every generic and threshold ipmitool event description fits; longer vendor text is cut. */
const SEL_EVENT_MAX = 48;
/** Severity and ECC matching read this much (sanitized) text, before the caps above. */
const CLASSIFY_MAX = 256;

/**
 * Format tokens for the sensor tables. Kept nullable so a format can be
 * withdrawn from types.ts without touching the reader: rows read from a table
 * with no token are reported through a note instead of `formats`.
 */
const SDR_FORMAT: TriageFormat | null = "ipmitool_sdr";
const SENSOR_FORMAT: TriageFormat | null = "ipmitool_sensor";

// Threshold status codes ipmitool prints in the sdr / sensor status column.
// The l/u-prefixed forms come from `sdr type` and `sdr elist` (extended mode).
const STATUS_CODES = new Set(["ok", "ns", "nc", "cr", "nr", "lnc", "lcr", "lnr", "unc", "ucr", "unr", "na"]);
const CRITICAL_CODES = new Set(["cr", "nr", "lcr", "lnr", "ucr", "unr"]);
const WARNING_CODES = new Set(["nc", "lnc", "unc"]);

const HEX_ID = /^[0-9a-f]{1,8}$/i;
const OEM_RECORD = /^OEM record ([0-9a-f]{2})$/i;
const NO_TIME = /^(?:pre-?init|s-init|unspecified)$/i;
const DATE_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/;
const DATE_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/;
const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIME = /^(\d{1,2}):(\d{2}):(\d{2})(?:\s*([AaPp][Mm]))?(?:\s+(\S+))?$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const READING = /^(-?\d+(?:\.\d+)?)(?:\s+(.+))?$/;
const HEX_VALUE = /^0x[0-9a-f]+$/i;
/** Start of a SEL row that did not parse in full: a paste cut off mid-line. */
const PARTIAL_SEL = /^\s*[0-9a-f]{1,8}\s*\|\s*(?:\d{1,4}[/.-]\d|pre-?init)/i;

// Sensor type strings ipmitool prints at the start of the SEL sensor column
// (sensor_type_desc in ipmitool), longest first so "Platform Security
// Violation" wins over "Platform Security". Only the SDR name after the type
// comes from the BMC, and that is at most 16 bytes; capping it there keeps a
// hand-edited sensor column from carrying a sentence into the answer (R1-25).
const SEL_SENSOR_TYPES = [
  "reserved", "Temperature", "Voltage", "Current", "Fan", "Physical Security",
  "Platform Security Violation", "Platform Security", "Processor", "Power Supply", "Power Unit",
  "Cooling Device", "Other", "Memory", "Drive Slot / Bay", "Drive Slot (Bay)", "POST Memory Resize",
  "System Firmwares", "System Firmware Progress", "Event Logging Disabled", "Watchdog1", "Watchdog 1",
  "System Event", "Critical Interrupt", "Button", "Module / Board", "Microcontroller",
  "Add-in Card", "Chassis", "Chip Set", "Other FRU", "Cable / Interconnect", "Terminator",
  "System Boot Initiated", "Boot Error", "OS Boot", "OS Critical Stop", "Slot / Connector",
  "System ACPI Power State", "Watchdog2", "Watchdog 2", "Platform Alert", "Entity Presence",
  "Monitor ASIC", "LAN", "Management Subsys Health", "Battery", "Session Audit",
  "Version Change", "FRU State", "OEM reserved", "Unknown",
].sort((a, b) => b.length - a.length);

// `ipmitool sdr` prints "ok" in the status column of every readable discrete
// sensor (lib/ipmi_sdr.c) and puts the state in the reading text, so a failed
// supply reads "ok | Presence detected, Failure detected". psu_redundancy_loss
// trusts a literal "ok", so for those rows the state text decides (R1-8).
const PSU_FAULT_TEXT = /failure detected|ac lost|input lost|out-of-range|configuration error|config error/i;
const PSU_PREDICTIVE_TEXT = /predictive failure/i;
/** Dell's aggregate redundancy sensor, the one Crucible maps (isPsuRedundancySensor). */
const PS_REDUNDANCY_NAME = /^ps\s+redundancy$/i;

// detect() sniffs. A SEL row needs id | date | time | sensor | event.
// Whitespace is [ \t], never \s: under the m flag \s also crosses line
// breaks, so a leading ^\s* re-scanned every following blank line from every
// line start and a paste of 130,000 newlines held the event loop for 40 s
// (review round 1, R1-3).
const SEL_ROW_SNIFF =
  /^[ \t]*[0-9a-f]{1,8}[ \t]*\|[ \t]*(?:\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|pre-?init|s-init|unspecified)[ \t]*\|[^|\r\n]*\|[^|\r\n]*\|/im;
const OEM_ROW_SNIFF = /^[ \t]*[0-9a-f]{1,8}[ \t]*\|[ \t]*OEM record [0-9a-f]{2}[ \t]*\|/im;
const SEL_INFO_HEADER = /^[ \t]*SEL Information[ \t]*$/m;
const ENTRIES_LINE = /^[ \t]*Entries[ \t]*:[ \t]*(\d{1,9})[ \t]*$/m;
const PERCENT_LINE = /^[ \t]*Percent Used[ \t]*:[ \t]*(\S+)/m;
const OVERFLOW_LINE = /^[ \t]*Overflow[ \t]*:[ \t]*(true|false|yes|no)\b/im;
// What `ipmitool sel list` / `sel elist` prints when the SEL is empty. A
// whole line only, so the words quoted inside a log line never count (R5-13).
const SEL_EMPTY_LINE = /^[ \t]*SEL has no entries[ \t]*$/m;
/** ipmitool rows are well under this; a longer line is not one, and no column regex sees it. */
const MAX_LINE = 512;

interface RawSelRow {
  id: number;
  dateCol: string;
  timeCol: string;
  sensor: string;
  event: string;
  direction: string;
  /** Sensor printed as type + number (`Memory #0x02`), the only shape `sel list` has. */
  numberedSensor: boolean;
  /** elist-only trailing column such as `Reading 0 < Threshold 300 RPM`. */
  extraColumn: boolean;
}

interface RawSensorRow {
  /** `sensor` = the 10-column `ipmitool sensor` table; `sdr` = `ipmitool sdr` list / elist / type. */
  layout: "sdr" | "sensor";
  name: string;
  reading: string;
  unit: string;
  /** Status column as printed. */
  status: string;
  /** Status column lowercased, for matching. */
  code: string;
  upperCritical?: string;
}

interface SelInfo {
  entries: number | null;
  percent_used: number | null;
  overflow: boolean | null;
}

function splitColumns(line: string): string[] {
  return line.split("|").map((c) => c.trim());
}

function isDateColumn(col: string): boolean {
  return DATE_SLASH.test(col) || DATE_DOT.test(col) || DATE_ISO.test(col);
}

/**
 * One SEL row, or null when the line is not one. Layouts (ipmitool
 * ipmi_sel.c), all with a hex record id first:
 *   standard   id | date | time | <type> <name or #0xNN> | event | direction [| reading]
 *   Pre-Init   id |  Pre-Init  |0000000004| sensor | event | direction
 *   OEM (ts)   id | date | time | OEM record c1 | manufacturer | data
 *   OEM (none) id | OEM record e0 | data
 */
function readSelRow(cols: string[]): RawSelRow | null {
  if (cols.length < 2 || !HEX_ID.test(cols[0])) return null;
  const id = parseInt(cols[0], 16);
  const oemUndated = OEM_RECORD.exec(cols[1]);
  if (oemUndated) {
    return {
      id, dateCol: "", timeCol: "", sensor: `OEM record ${oemUndated[1]}`, event: "OEM record",
      direction: "", numberedSensor: true, extraColumn: false,
    };
  }
  if (cols.length < 5) return null;
  const [, dateCol, timeCol, sensorCol, eventCol] = cols;
  if (!isDateColumn(dateCol) && !NO_TIME.test(dateCol)) return null;
  const oemDated = OEM_RECORD.exec(sensorCol);
  if (oemDated) {
    // Manufacturer id and OEM data are opaque hex; nothing a rule reads.
    return {
      id, dateCol, timeCol, sensor: `OEM record ${oemDated[1]}`, event: "OEM record",
      direction: "", numberedSensor: true, extraColumn: false,
    };
  }
  // Direction is column 5 on every ipmitool build; searching further only
  // matters when a vendor description itself contained a pipe.
  let dirIndex = -1;
  for (let i = 5; i < cols.length; i++) {
    if (/^(?:de)?asserted$/i.test(cols[i])) {
      dirIndex = i;
      break;
    }
  }
  let event = eventCol;
  let direction: string;
  if (dirIndex >= 5) {
    if (dirIndex > 5) event = cols.slice(4, dirIndex).join(" ");
    direction = /^de/i.test(cols[dirIndex]) ? "Deasserted" : "Asserted";
  } else if (cols.length === 5 || cols[5] === "") {
    direction = "Asserted"; // collector default: `direction || "Asserted"`
  } else {
    direction = safeLabel(cols[5], 16);
  }
  return {
    id,
    dateCol,
    timeCol,
    sensor: sensorCol,
    event,
    direction,
    numberedSensor: /#0x[0-9a-f]{1,2}$/i.test(sensorCol),
    extraColumn: dirIndex >= 5 && cols.length > dirIndex + 1,
  };
}

/**
 * One sensor-table row, or null. Layouts:
 *   ipmitool sensor            name | value | unit | status | lnr | lcr | lnc | unc | ucr | unr
 *   ipmitool sdr type / elist  name | 41h | status | 29.1 | reading
 *   ipmitool sdr [list]        name | reading | status
 */
function readSensorRow(cols: string[]): RawSensorRow | null {
  const name = cols[0] ?? "";
  if (!name) return null;
  if (cols.length >= 10) {
    const code = cols[3].toLowerCase();
    const value = cols[1];
    if (!STATUS_CODES.has(code) && !HEX_VALUE.test(code)) return null;
    if (!NUMBER.test(value) && !/^na$/i.test(value) && !HEX_VALUE.test(value)) return null;
    return { layout: "sensor", name, reading: value, unit: cols[2], status: cols[3], code, upperCritical: cols[8] };
  }
  if (cols.length === 5 && /^[0-9a-f]{2}h$/i.test(cols[1]) && /^\d+\.\d+$/.test(cols[3])) {
    const code = cols[2].toLowerCase();
    if (!STATUS_CODES.has(code)) return null;
    return { layout: "sdr", name, reading: cols[4], unit: "", status: cols[2], code };
  }
  if (cols.length === 3) {
    const code = cols[2].toLowerCase();
    if (!STATUS_CODES.has(code)) return null;
    return { layout: "sdr", name, reading: cols[1], unit: "", status: cols[2], code };
  }
  return null;
}

function isFanRow(row: RawSensorRow): boolean {
  // In the sensor table only RPM rows are fans: a discrete fan sensor there
  // carries a hex state mask, which the collector's fan parser would misread
  // as a stopped fan. In sdr output an RPM reading is a fan; so is a
  // fan-named row with no reading or a state text (`sdr type Fan` lists
  // those too), but not a fan-named temperature or voltage.
  if (row.layout === "sensor") return /^rpm$/i.test(row.unit);
  const reading = READING.exec(row.reading);
  if (reading) return /^rpm$/i.test(reading[2] ?? "");
  return /fan/i.test(row.name);
}

/** Same name filter as psu_redundancy_loss, so only rows it reads are kept. */
function isPsuRow(row: RawSensorRow): boolean {
  const name = row.name.toLowerCase();
  return name.includes("psu") || /\bps\d/.test(name) || name.includes("power supply");
}

// Port of crucible parseFanStatus (status precedence unchanged), reading the
// status column directly and accepting extended threshold codes.
function fanFrom(row: RawSensorRow): FanStatus {
  const source = row.layout === "sensor" ? `${row.reading} ${row.unit}` : row.reading;
  // Anchored: unanchored, the engine retried at every digit of a long reading
  // and the scan went quadratic (R1-4).
  const rpmMatch = /^(\d+(?:\.\d+)?)\s*RPM$/i.exec(source.trim());
  const rpm = rpmMatch ? Math.round(Number(rpmMatch[1])) : 0;
  const noReading = /no reading/i.test(row.reading) || /^na$/i.test(row.reading);
  let status: string;
  if (CRITICAL_CODES.has(row.code)) status = "critical";
  else if (WARNING_CODES.has(row.code)) status = "warning";
  else if (row.code === "ns" || noReading) status = "absent";
  else if (row.code === "ok") status = "ok";
  else if (rpm === 0) status = "critical"; // no status code and no RPM reads as stopped
  else status = "ok";
  return { name: safeLabel(row.name, NAME_MAX), rpm, status };
}

function psuFrom(row: RawSensorRow): SensorReading {
  const name = safeLabel(row.name, NAME_MAX);
  let status = safeIdent(row.status, 16);
  if (row.layout === "sdr" && row.code === "ok" && !READING.test(row.reading) && PSU_FAULT_TEXT.test(row.reading)) {
    status = "cr";
  }
  if (row.layout === "sensor") {
    const out: SensorReading = {
      name,
      value: NUMBER.test(row.reading) ? Number(row.reading) : safeLabel(row.reading, 40),
      unit: safeLabel(row.unit, 24),
      status,
    };
    if (row.upperCritical !== undefined && NUMBER.test(row.upperCritical)) {
      out.upper_critical = Number(row.upperCritical);
    }
    return out;
  }
  const reading = READING.exec(row.reading);
  return reading
    ? { name, value: Number(reading[1]), unit: safeLabel(reading[2] ?? "", 24), status }
    : { name, value: safeLabel(row.reading, 40), unit: "", status };
}

/**
 * Crucible's classifyPsuRedundancyState, read from the sdr state text only.
 * A bare "ok" is not mapped: in sdr output that status is printed for every
 * readable discrete sensor and says nothing about redundancy.
 */
function psuRedundancyFrom(reading: string): IpmiSlice["psu_redundancy_state"] | null {
  const lower = reading.toLowerCase();
  if (lower.includes("fully redundant") || lower.includes("fully-redundant")) return "fully_redundant";
  if (lower.includes("lost")) return "redundancy_lost";
  if (lower.includes("degraded")) return "redundancy_degraded";
  return null;
}

/** The SEL sensor column as "<type> <name>", the name capped at the SDR id length. */
function selSensorLabel(sensorText: string): string {
  for (const type of SEL_SENSOR_TYPES) {
    if (!sensorText.startsWith(type)) continue;
    const rest = sensorText.slice(type.length);
    if (rest !== "" && !rest.startsWith(" ")) continue;
    const name = safeLabel(rest, NAME_MAX);
    return safeLabel(name ? `${type} ${name}` : type, SEL_SENSOR_MAX);
  }
  return safeLabel(sensorText, NAME_MAX);
}

// Ported verbatim from crucible src/collect/ipmi.ts classifySensor.
function classifySensor(sensor: string): string {
  const lower = sensor.toLowerCase();
  if (lower.includes("memory") || lower.includes("dimm")) return "memory";
  if (lower.includes("power supply") || lower.includes("psu")) return "power";
  if (lower.includes("fan")) return "fan";
  if (lower.includes("watchdog")) return "watchdog";
  if (lower.includes("processor") || lower.includes("cpu")) return "processor";
  if (lower.includes("temperature") || lower.includes("temp")) return "temperature";
  if (lower.includes("voltage")) return "voltage";
  if (lower.includes("drive") || lower.includes("disk")) return "storage";
  if (lower.includes("chassis") || lower.includes("intrusion")) return "chassis";
  return "other";
}

// Ported verbatim from crucible src/collect/ipmi.ts deriveSelSeverity.
function deriveSelSeverity(event: string, sensorType: string): string {
  const lower = event.toLowerCase();

  if (lower.includes("uncorrectable")) return "critical";
  if (lower.includes("failure detected")) return "critical";
  if (lower.includes("ac lost")) return "critical";
  if (lower.includes("hard reset")) return "critical";
  if (lower.includes("power off")) return "critical";
  if (lower.includes("critical")) return "critical";
  if (lower.includes("non-recoverable")) return "critical";
  if (lower.includes("thermal trip")) return "critical";
  if (lower.includes("processor disabled")) return "critical";
  if (lower.includes("machine check")) return "critical";

  if (lower.includes("correctable ecc")) return "warning";
  if (lower.includes("logging limit")) return "warning";
  if (lower.includes("lower critical going low")) return "warning";
  if (lower.includes("upper critical going high")) return "warning";
  if (lower.includes("redundancy lost")) return "warning";
  if (lower.includes("predictive failure")) return "warning";
  if (lower.includes("degraded")) return "warning";

  if (lower.includes("presence detected")) return "info";
  if (lower.includes("power cycle")) return "info";
  if (lower.includes("oem")) return "info";

  if (["memory", "power", "fan", "processor"].includes(sensorType)) return "warning";
  return "info";
}

// Routine power operations the table above classes critical on a substring:
// "power off" in a Power Unit's "Power off/down" (an OS shutdown) and "hard
// reset" in a System Boot Initiated row (a BMC, chassis or OS reset). The
// triage reader counts SEL events of any age, so a host reset once stayed
// critical in every later paste (R3-10). Keyed on the SEL sensor type, so a
// Watchdog2 "Hard reset" and a Power Unit "AC lost" or "Failure detected"
// keep the agent's class. The live agent is unchanged.
const ROUTINE_POWER_SENSOR = /^(?:System Boot Initiated|System ACPI Power State)(?: |$)/;
const POWER_UNIT_ROUTINE_EVENT = /^(?:Power off\/down|Power cycle)\b/i;

// IPMI sensor-specific fault offsets ipmitool prints as plain text the table
// above has no keyword for, so a CPU IERR or a faulted drive was a warning or
// info row and ipmi_sel_critical reported no matching signal (R5-1). Keyed on
// the SEL sensor type and the whole ipmitool event string, so free text in
// another sensor's row never matches.
const SEL_FAULT_OFFSETS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [
    /^Processor(?: |$)/,
    /^(?:IERR|FRB1\/BIST failure|FRB2\/Hang in POST failure|FRB3\/Processor startup\/init failure|SM BIOS Uncorrectable CPU-complex Error)$/i,
  ],
  [/^Memory(?: |$)/, /^(?:Memory Device Disabled|Memory Scrub Failed)$/i],
  [/^Drive Slot (?:\/ Bay|\(Bay\))(?: |$)/, /^(?:Drive Fault|In Failed Array|Rebuild Aborted)$/i],
  [/^Critical Interrupt(?: |$)/, /^(?:Bus Fatal Error|Fatal NMI|PCI SERR)$/i],
];
// Processor offset 0x0c: a corrected machine check. The table's "machine
// check" substring made it critical, while the memory equivalent "Correctable
// ECC" is a warning (R5-6). "Uncorrectable machine check exception" is 0x0b.
const CORRECTED_MCE = /^Correctable machine check\b/i;

function triageSelSeverity(sensorText: string, eventText: string, sensorType: string): string {
  for (const [sensor, event] of SEL_FAULT_OFFSETS) {
    if (sensor.test(sensorText) && event.test(eventText)) return "critical";
  }
  if (/^Processor(?: |$)/.test(sensorText) && CORRECTED_MCE.test(eventText)) return "warning";
  if (ROUTINE_POWER_SENSOR.test(sensorText)) return "info";
  if (/^Power Unit(?: |$)/.test(sensorText) && POWER_UNIT_ROUTINE_EVENT.test(eventText)) return "info";
  return deriveSelSeverity(eventText, sensorType);
}

function expandYear(year: string): number {
  // ipmitool convention (collector parseSelTimestamp): 70-99 = 19xx, 00-69 = 20xx.
  if (year.length === 4) return Number(year);
  return Number(year) >= 70 ? 1900 + Number(year) : 2000 + Number(year);
}

/**
 * ipmitool 1.8.19+ prints SEL dates with strftime %x, so the order follows
 * the locale. One date whose first field cannot be a month settles it for the
 * whole paste; otherwise month first, as the collector assumes.
 */
function chooseDateOrder(rows: RawSelRow[]): "mdy" | "dmy" {
  for (const row of rows) {
    const m = DATE_SLASH.exec(row.dateCol);
    if (m && Number(m[1]) > 12 && Number(m[2]) <= 12) return "dmy";
  }
  return "mdy";
}

/**
 * ISO-8601 UTC timestamp for a SEL date + time, or "" when either is missing
 * or invalid. Times without a zone are the BMC clock read as UTC (collector
 * behaviour); a numeric offset is applied; a zone name other than UTC / GMT
 * cannot be resolved offline, so it is read as UTC and flagged.
 */
function selTimestamp(
  dateCol: string,
  timeCol: string,
  order: "mdy" | "dmy",
): { iso: string; namedZone: boolean; zoneless?: boolean } {
  const unknown = { iso: "", namedZone: false };
  let y: number;
  let mo: number;
  let d: number;
  let match: RegExpExecArray | null;
  if ((match = DATE_SLASH.exec(dateCol))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    [mo, d] = order === "dmy" ? [b, a] : [a, b];
    y = expandYear(match[3]);
  } else if ((match = DATE_DOT.exec(dateCol))) {
    d = Number(match[1]);
    mo = Number(match[2]);
    y = expandYear(match[3]);
  } else if ((match = DATE_ISO.exec(dateCol))) {
    y = Number(match[1]);
    mo = Number(match[2]);
    d = Number(match[3]);
  } else {
    return unknown;
  }
  const t = TIME.exec(timeCol);
  if (!t) return unknown;
  let h = Number(t[1]);
  const mi = Number(t[2]);
  const s = Number(t[3]);
  const meridiem = t[4]?.toLowerCase();
  if (meridiem) {
    if (h < 1 || h > 12) return unknown;
    h = (h % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (h > 23 || mi > 59 || s > 59) return unknown;
  let offsetMinutes = 0;
  let namedZone = false;
  const zone = t[5];
  if (zone && !/^(?:utc|gmt|uct|z)$/i.test(zone)) {
    // %Z prints "+04" style names for zones without an abbreviation.
    const off = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(zone);
    if (off) offsetMinutes = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0));
    else if (/^[A-Za-z]{2,6}$/.test(zone)) namedZone = true;
    else return unknown;
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return unknown;
  const iso = new Date(wall - offsetMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { iso, namedZone, zoneless: !zone };
}

// Port of crucible parseSelInfo, anchored to whole lines so it cannot pick a
// stray "Entries :" out of other output. Nulls mean "not in the paste".
function readSelInfo(text: string): SelInfo | null {
  const header = SEL_INFO_HEADER.test(text);
  const entries = ENTRIES_LINE.exec(text);
  const percent = PERCENT_LINE.exec(text);
  const overflow = OVERFLOW_LINE.exec(text);
  if (!header && !(entries && (percent || overflow))) return null;
  const pct = percent ? /^(\d{1,3})%$/.exec(percent[1]) : null;
  return {
    entries: entries ? Number(entries[1]) : null,
    percent_used: pct ? Number(pct[1]) : null,
    overflow: overflow ? /^(?:true|yes)$/i.test(overflow[1]) : null,
  };
}

interface ParsedSel {
  event: SelEvent;
  /** Sanitized but uncapped sensor / event text the classifiers read. */
  sensorText: string;
  eventText: string;
}

// Port of crucible parseSelEccCounts over the parsed rows. Same memory
// match and uncorrectable-before-correctable precedence; asserted rows only,
// and the newest timestamp is taken over counted rows with a known time.
function eccFromSel(parsed: ParsedSel[]): EccFromSel {
  let correctable = 0;
  let uncorrectable = 0;
  let newest: string | null = null;
  for (const { event: e, sensorText, eventText } of parsed) {
    if (e.direction !== "Asserted") continue;
    const sensorLower = sensorText.toLowerCase();
    const eventLower = eventText.toLowerCase();
    const isMemoryRelated =
      sensorLower.includes("memory") ||
      sensorLower.includes("dimm") ||
      sensorLower.includes("ecc") ||
      eventLower.includes("ecc");
    if (!isMemoryRelated) continue;
    if (eventLower.includes("uncorrectable") || eventLower.includes("uncorr")) uncorrectable++;
    else if (eventLower.includes("correctable") || eventLower.includes("corr")) correctable++;
    else continue;
    if (e.timestamp && (newest === null || e.timestamp > newest)) newest = e.timestamp;
  }
  return { correctable, uncorrectable, newest_event_timestamp: newest };
}

function emptyResult(notes: ParseNote[]): ParserResult {
  return { domain: "ipmi_sel", formats: [], snapshot: {}, subjects: 0, notes };
}

function detectIpmi(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  if (SEL_ROW_SNIFF.test(text) || OEM_ROW_SNIFF.test(text) || SEL_INFO_HEADER.test(text) || SEL_EMPTY_LINE.test(text)) return true;
  if (ENTRIES_LINE.test(text) && (PERCENT_LINE.test(text) || OVERFLOW_LINE.test(text))) return true;
  if (!text.includes("|")) return false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length > MAX_LINE || !line.includes("|")) continue;
    const row = readSensorRow(splitColumns(line));
    if (row && (isFanRow(row) || isPsuRow(row))) return true;
  }
  return false;
}

function parseIpmi(text: string): ParserResult {
  const lines = text.split(/\r\n|\r|\n/);
  const rows: RawSelRow[] = [];
  const fans: FanStatus[] = [];
  const psus: SensorReading[] = [];
  const fanNames = new Set<string>();
  const psuNames = new Set<string>();
  let partialRows = 0;
  let sawElistCommand = false;
  let sawListCommand = false;
  let sawEmptySel = false;
  let sdrUsed = false;
  let sensorUsed = false;
  let psuRedundancy: IpmiSlice["psu_redundancy_state"] | null = null;
  let psuPredictive = 0;
  // PSU rows whose state can be read: a sensor-table row with a threshold
  // status, or an sdr row with a number or state text. Plain `sdr list` prints
  // a hex code in the reading, and `ipmitool sensor` prints a discrete
  // sensor's state as a hex mask in the status column (R2-4); the rule reads
  // either as healthy, and the table names no sensor type to decode it by.
  let psuStateRows = 0;
  let psuHexRows = 0;

  for (const line of lines) {
    if (line.length > MAX_LINE) continue;
    if (line.includes("|")) {
      const cols = splitColumns(line);
      const sel = readSelRow(cols);
      if (sel) {
        rows.push(sel);
        continue;
      }
      const sensor = readSensorRow(cols);
      if (sensor && sensor.layout === "sdr" && PS_REDUNDANCY_NAME.test(sensor.name)) {
        const state = psuRedundancyFrom(sensor.reading);
        if (state && psuRedundancy === null) {
          psuRedundancy = state;
          sdrUsed = true;
        }
        continue;
      }
      if (sensor) {
        let used = false;
        if (isFanRow(sensor)) {
          const fan = fanFrom(sensor);
          if (fan.name && !fanNames.has(fan.name)) {
            fanNames.add(fan.name);
            fans.push(fan);
            used = true;
          }
        }
        if (isPsuRow(sensor)) {
          const psu = psuFrom(sensor);
          if (psu.name && !psuNames.has(psu.name)) {
            psuNames.add(psu.name);
            psus.push(psu);
            used = true;
            if (HEX_VALUE.test(sensor.layout === "sensor" ? sensor.code : sensor.reading)) psuHexRows++;
            else psuStateRows++;
            if (psu.status === "ok" && PSU_PREDICTIVE_TEXT.test(sensor.reading)) psuPredictive++;
          }
        }
        if (used && sensor.layout === "sdr") sdrUsed = true;
        if (used && sensor.layout === "sensor") sensorUsed = true;
        continue;
      }
      if (PARTIAL_SEL.test(line)) {
        partialRows++;
        continue;
      }
    }
    if (SEL_EMPTY_LINE.test(line)) {
      sawEmptySel = true;
      continue;
    }
    // Shell prompt / command echo: tells `sel list` from `sel elist`.
    if (/\bsel\s+elist\b/i.test(line)) sawElistCommand = true;
    else if (/\bsel\s+list\b/i.test(line)) sawListCommand = true;
  }

  // The same SEL pasted twice (or as both `sel list` and `sel elist`) would
  // double every count; record id + time + event + direction is one record.
  const seen = new Set<string>();
  const unique: RawSelRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.id}|${row.dateCol}|${row.timeCol}|${safeLabel(row.event, CLASSIFY_MAX)}|${row.direction}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  const order = chooseDateOrder(unique);
  let unknownTimes = 0;
  let namedZones = 0;
  let zonelessTimes = 0;
  let datedTimes = 0;
  let preClock = 0;
  const parsed: ParsedSel[] = unique.map((row) => {
    // Classify on the full text (as the collector does) so the length caps
    // can never cut a severity keyword; store the capped labels. Both halves
    // of an assert / deassert pair cap identically, so pairing still matches.
    const sensorText = safeLabel(row.sensor, CLASSIFY_MAX);
    const eventText = safeLabel(row.event, CLASSIFY_MAX);
    const sensorType = classifySensor(sensorText);
    const time = row.dateCol ? selTimestamp(row.dateCol, row.timeCol, order) : { iso: "", namedZone: false };
    if (!time.iso) unknownTimes++;
    else datedTimes++;
    if (time.namedZone) namedZones++;
    if (time.zoneless) zonelessTimes++;
    if (time.iso && time.iso < "2010") preClock++;
    return {
      sensorText,
      eventText,
      event: {
        id: row.id,
        timestamp: time.iso,
        sensor: selSensorLabel(sensorText),
        sensor_type: sensorType,
        event: safeLabel(eventText, SEL_EVENT_MAX),
        direction: row.direction,
        severity: triageSelSeverity(sensorText, eventText, sensorType),
        // BMC vendor is not in the paste; the collector tags unidentified vendors the same way.
        parser_quality: "unknown",
      },
    };
  });
  const events = parsed.map((p) => p.event);

  const selInfo = readSelInfo(lines.join("\n"));
  const selInfoUsable =
    selInfo !== null && (selInfo.entries !== null || selInfo.percent_used !== null || selInfo.overflow !== null);

  const notes: ParseNote[] = [];
  if (partialRows > 0) {
    notes.push({ level: "warning", message: `${partialRows} line(s) looked like SEL rows but were cut off or incomplete, so they were skipped.` });
  }

  // ipmitool read the SEL and it held no entry: a read of an empty log, not
  // unrecognised output (R5-13).
  const emptySelRead = sawEmptySel && unique.length === 0;
  const subjects =
    events.length + fans.length + psus.length + (psuRedundancy ? 1 : 0) + (selInfoUsable ? 1 : 0) + (emptySelRead ? 1 : 0);
  if (subjects === 0) {
    notes.push({ level: "warning", message: "No ipmitool SEL rows, sel info fields, fan rows or power supply rows were recognised." });
    return emptyResult(notes);
  }

  const formats: TriageFormat[] = [];
  if (unique.length > 0) {
    const elist = sawElistCommand || (!sawListCommand && unique.some((r) => !r.numberedSensor || r.extraColumn));
    if (elist) formats.push("ipmitool_sel_elist");
    if (sawListCommand || !elist) formats.push("ipmitool_sel_list");
  } else if (emptySelRead) {
    formats.push(sawListCommand && !sawElistCommand ? "ipmitool_sel_list" : "ipmitool_sel_elist");
  }
  if (selInfoUsable) formats.push("ipmitool_sel_info");
  if (sdrUsed && SDR_FORMAT) formats.push(SDR_FORMAT);
  if (sensorUsed && SENSOR_FORMAT) formats.push(SENSOR_FORMAT);

  // Paste order is SEL order (oldest first); the collector reports newest first.
  const dropped = Math.max(0, events.length - MAX_SEL_EVENTS);
  const kept = events.slice(dropped).reverse();

  const ipmi: IpmiSlice = {
    available: true,
    sensors: psus,
    // Named ECC counter sensors are not read from a paste: null = not observed.
    ecc_errors: null,
    sel_entries_count: selInfo?.entries ?? null,
  };
  if (selInfo?.percent_used != null) ipmi.sel_percent_used = selInfo.percent_used;
  if (selInfo?.overflow != null) ipmi.sel_overflow = selInfo.overflow;
  if (psuRedundancy) ipmi.psu_redundancy_state = psuRedundancy;
  if (events.length > 0 || emptySelRead) {
    ipmi.sel_events_recent = kept;
    ipmi.ecc_errors_from_sel = eccFromSel(parsed);
  }
  if (fans.length > 0) ipmi.fans = fans;

  if (duplicates > 0) {
    notes.push({ level: "info", message: `${duplicates} repeated SEL row(s) were counted once.` });
  }
  if (dropped > 0) {
    notes.push({
      level: "warning",
      message: `${dropped} older SEL row(s) past the ${MAX_SEL_EVENTS}-event limit were left out of the event list; ECC counts include every row.`,
    });
  }
  if (unknownTimes > 0) {
    notes.push({
      level: "info",
      message: `Times unknown for ${unknownTimes} SEL event(s) (Pre-Init, undated OEM record, or unreadable date); their age cannot be judged from this output.`,
    });
  }
  if (namedZones > 0) {
    notes.push({
      level: "info",
      message: `${namedZones} SEL time(s) carry a local time zone name; they were read as UTC, so absolute times may be off by that zone's offset.`,
    });
  }
  // The ISO time keeps the collector's UTC reading for the age comparisons,
  // but ipmitool printed no zone, so the "Z" is an assumption (R3-14). When no
  // dated row has a zone the answer shows the times without it (R4-11); beside
  // zoned rows it cannot, and the caveat is a warning the text block shows.
  const allZoneless = zonelessTimes > 0 && zonelessTimes === datedTimes;
  if (zonelessTimes > 0) {
    const suffix = allZoneless ? "" : " with a UTC suffix";
    notes.push({
      level: allZoneless ? "info" : "warning",
      message:
        zonelessTimes === 1
          ? `1 SEL time carries no time zone; it is shown as the BMC printed it${suffix}, and the BMC clock's real zone is not in this output.`
          : `${zonelessTimes} SEL times carry no time zone; they are shown as the BMC printed them${suffix}, and the BMC clock's real zone is not in this output.`,
    });
  }
  if (preClock > 0) {
    notes.push({
      level: "info",
      message: `${preClock} SEL event(s) are dated before 2010, the kind of date a BMC with an unset clock writes; treat their age as unreliable.`,
    });
  }
  if (order === "dmy") {
    notes.push({ level: "info", message: "SEL dates were read as day/month/year because at least one date only fits that order." });
  }
  if ((sdrUsed && !SDR_FORMAT) || (sensorUsed && !SENSOR_FORMAT)) {
    notes.push({ level: "info", message: "Fan or power supply rows were read from ipmitool sdr or sensor output." });
  }
  if (psuPredictive > 0) {
    notes.push({
      level: "warning",
      message: `${psuPredictive} power supply row(s) report Predictive Failure. No rule in this check fires on that state, so it is listed here rather than as a finding.`,
    });
  }
  // Every PSU row printed only a hex state code: the rule would read the
  // constant "ok" beside it as healthy, so it is not run on them.
  const psuReadable = psuStateRows > 0 || psuRedundancy !== null;
  if (psus.length > 0 && !psuReadable) {
    notes.push({
      level: "info",
      message: "The power supply rows show only a hex state code, so their state could not be read and the power supply check did not run. ipmitool sdr elist prints the state as text.",
    });
  } else if (psuHexRows > 0) {
    notes.push({
      level: "warning",
      message: `${psuHexRows} power supply ${psuHexRows === 1 ? "row shows" : "rows show"} only a hex state code, which is not decoded here, so the power supply check cannot see a failure in ${psuHexRows === 1 ? "it" : "them"}. ipmitool sdr elist prints that state as text.`,
    });
  }
  if (emptySelRead) {
    notes.push({
      level: "warning",
      message: "ipmitool reported that the SEL has no entries, so the event log held no event to check. A log cleared recently reads the same way.",
    });
  }
  const missing: string[] = [];
  if (events.length === 0 && !emptySelRead) missing.push("SEL event rows (ipmitool sel elist)");
  if (!selInfoUsable) missing.push("SEL fullness (ipmitool sel info)");
  if (fans.length === 0) missing.push("fan rows (ipmitool sdr type Fan)");
  // Not `ipmitool sensor`: it prints a discrete PSU state as a hex mask the
  // check cannot read (R2-4).
  if (psus.length === 0 && psuRedundancy === null) missing.push("power supply rows (ipmitool sdr elist)");
  if (missing.length > 0) {
    notes.push({ level: "info", message: `Not in this output, so not checked: ${missing.join("; ")}.` });
  }

  // Only the rules whose input is in this paste; the "Not in this output"
  // note above names the rest. Without sel info, ipmi_sel_full can only fire
  // on an asserted "Log full" row; SEL rows without one say nothing about how
  // full the log is, so the rule is not reported as checked on them (R1-28).
  const rules_checked: string[] = [];
  if (events.length > 0 || emptySelRead) rules_checked.push("ecc_errors", "ipmi_sel_critical");
  const logFullRow = events.some((e) => e.direction === "Asserted" && isSelLogFullEventText(e.event));
  if (selInfoUsable || logFullRow) rules_checked.push("ipmi_sel_full");
  if (fans.length > 0) rules_checked.push("ipmi_fan_failure");
  if (psuReadable && (psus.length > 0 || psuRedundancy !== null)) rules_checked.push("psu_redundancy_loss");

  return { domain: "ipmi_sel", formats, snapshot: { ipmi }, subjects, notes, rules_checked, ...(allZoneless ? { zoneless_times: true as const } : {}) };
}

export const ipmiSelParser: TriageParser = {
  domain: "ipmi_sel",
  // Every rule that reads Snapshot.ipmi and can fire from one paste.
  // ipmi_monitoring_unavailable needs probe + bmc_device_node from a live
  // agent; cmos_battery_low and cpu_temperature_high read sensor rows this
  // parser does not keep (only fan and PSU rows are).
  rules: ["ecc_errors", "psu_redundancy_loss", "ipmi_sel_critical", "ipmi_sel_full", "ipmi_fan_failure"],
  notDeterminable: [
    {
      signal: "Correctable ECC error rate",
      reason: "Needs correctable ECC counts from repeated readings across 24 hours; one paste is a single count",
    },
    {
      signal: "Fan RPM decline",
      reason: "Compares each fan with its speed about 14 days earlier; one paste is a single reading",
    },
  ],
  detect(text: string): boolean {
    try {
      return detectIpmi(text);
    } catch {
      return false;
    }
  },
  parse(text: string): ParserResult {
    try {
      return parseIpmi(typeof text === "string" ? text : "");
    } catch {
      return emptyResult([{ level: "warning", message: "The BMC output could not be read." }]);
    }
  },
};
