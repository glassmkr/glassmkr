// Hostile pastes for the parser time bound (adversarial.test.ts). Each one is
// shaped to make a regex or a scan in some parser do super-linear work: long
// runs of one character, one padded line behind a header that gets it past
// detect(), and the exact inputs review round 1 measured (R1-1 to R1-5, R1-13,
// R1-36). `size` is the paste length to build; the test uses the tool's real
// 200,000-character limit.

export interface AdversarialInput {
  name: string;
  text: string;
}

function fill(prefix: string, unit: string, size: number, suffix = ""): string {
  const room = Math.max(0, size - prefix.length - suffix.length);
  return prefix + unit.repeat(Math.ceil(room / unit.length)).slice(0, room) + suffix;
}

const NVSMI_BANNER = "==============NVSMI LOG==============\n";

export function adversarialInputs(size: number): AdversarialInput[] {
  const runs = ["\n", "\r", "\r\n", " \n", " ", "\t", "=", "[", "{", "1", "|", ",", ":", "#", "(", ".", "-", "a", "\u2028"];
  const out: AdversarialInput[] = runs.map((c) => ({ name: `run of ${JSON.stringify(c)}`, text: fill("", c, size) }));
  const half = Math.floor(size / 3);
  out.push(
    // R1-1: nested brackets behind a smartctl health line.
    {
      name: "smartctl: nested JSON brackets",
      text: fill("", "[", half) + fill("", "[]", half * 2 - (half * 2) % 2) + "\nSMART overall-health self-assessment test result: PASSED\n",
    },
    { name: "smartctl: wide JSON array", text: fill('{"smart_status": [', "1,", size, "\n") },
    // R1-36: padded self-test rows inside the 4096-character line cap.
    {
      name: "smartctl: padded self-test rows",
      text: fill(
        "smartctl 7.4 2023-08-01 r5530\n=== START OF READ SMART DATA SECTION ===\nNum  Test_Description    Status                  Remaining  LifeTime(hours)  LBA_of_first_error\n",
        "# 1  A" + " ".repeat(4000) + "x\n",
        size,
      ),
    },
    { name: "smartctl: padded key line", text: fill("smartctl 7.4 2023-08-01 r5530\nDevice Model:", " ", size, "x\n") },
    {
      name: "smartctl: prompt lines with for loops",
      text: fill("", "root@h:~# smartctl -a " + "for x in ".repeat(440) + "\n", size),
    },
    { name: "smartctl: padded health status", text: fill("SMART Health Status:", " ", size, "x") },
    // R1-2: the NVLink header and link regexes on one padded line.
    { name: "nvidia: padded NVLink GPU header", text: fill(NVSMI_BANNER + "GPU 0: a (UUID:", " ", size, "x\n") },
    { name: "nvidia: padded NVLink link line", text: fill("GPU 0: a (UUID: GPU-1)\n    Link 0: a", " ", size, "x\n") },
    // R1-5: detect() paths that run on every paste.
    { name: "nvidia: equals run ending in the banner word", text: fill("", "=", size, " NVSMI LOG") },
    { name: "nvidia: padded CSV cell", text: fill("a,a", " ", size, "x") },
    { name: "nvidia: CSV cell of brackets", text: fill("a,", "[", size) },
    { name: "nvidia: CR-separated GPU lines", text: fill("", "GPU 0:x\r", size) },
    { name: "nvidia: padded -q key", text: fill(NVSMI_BANNER + "GPU 00000000:01:00.0\n    Product Name   ", " ", size, ": x\n") },
    { name: "nvidia: CSV header and padded row", text: fill("index, name, temperature.gpu\n0,", " ", size, ",x\n") },
    // R1-13: thousands of distinct GPU blocks.
    {
      name: "nvidia: bare GPU headers",
      text: (() => {
        const lines: string[] = [NVSMI_BANNER.trimEnd()];
        let n = NVSMI_BANNER.length;
        for (let i = 0; n < size; i++) {
          const line = `GPU 0000${(i & 0xffff).toString(16).padStart(4, "0")}:${((i >> 16) & 0xff).toString(16).padStart(2, "0")}:00.0`;
          lines.push(line);
          n += line.length + 1;
        }
        return lines.join("\n").slice(0, size);
      })(),
    },
    // R1-4: a 3-column sdr fan row with a huge numeric reading.
    { name: "ipmi: fan row with a long reading", text: fill("FAN1 | ", "1", size - 9, "x | cr\n") },
    { name: "ipmi: sel info header and blank lines", text: fill("SEL Information\n", "\n", size) },
    {
      // Thousands of distinct critical rows, every one later deasserted: the
      // pairing in the rule and in the answer's SEL timing must stay linear.
      name: "ipmi: SEL of critical rows asserted and deasserted",
      text: (() => {
        const rows = ["root@h:~# ipmitool sel elist"];
        let n = rows[0].length;
        for (let i = 1; n < size - 200; i++) {
          const day = String(1 + (i % 28)).padStart(2, "0");
          const dir = i % 2 === 1 ? "Asserted" : "Deasserted";
          const row = `${i.toString(16).padStart(4, " ")} | 01/${day}/2020 | 00:00:${String(i % 60).padStart(2, "0")} | Power Supply PS${(i >> 1) % 9} Status | Failure detected | ${dir}`;
          rows.push(row);
          n += row.length + 1;
        }
        return rows.join("\n");
      })(),
    },
    { name: "ipmi: padded SEL sensor column", text: fill("1 | 01/01/2020 | 00:00:00 | ", " ", size, "x | y | Asserted\n") },
    { name: "kernel: long relative-stamp line", text: fill("[    1.000000] ", "x", size) },
    // R2-1: the shell-prompt regex runs on every line of every paste (detect()
    // included); a bracketed prompt of '@' made it quadratic inside the line cap.
    { name: "kernel: bracketed prompt of @", text: fill("", "[" + "@".repeat(2047) + "\n", size) },
    { name: "kernel: closed bracketed prompt of @", text: fill("", "[" + "@".repeat(2046) + "]\n", size) },
    { name: "kernel: padded sense key", text: fill("sd 0:0:0:0: [sda] Sense Key :", " ", size, "x") },
    {
      name: "kernel: many recovered-error sense lines",
      text: fill("", "[    1.000000] sd 0:0:0:0: [sda] Sense Key : Recovered Error [current]\n", size),
    },
    // R1-36: the zpool scrub line regex on one long scan line.
    { name: "zpool: repeated scrub phrase on the scan line", text: fill("  pool: p\n state: ONLINE\n  scan: ", "scrub repaired x in ", size) },
    { name: "zpool: long vdev tree", text: fill("  pool: p\n state: ONLINE\nconfig:\n\n\tNAME STATE READ WRITE CKSUM\n\tp ONLINE 0 0 0\n", "\t  sda ONLINE 0 0 0\n", size) },
    { name: "mdraid: long member list", text: fill("Personalities : [raid1]\nmd0 : active raid1 ", "a", size) },
    { name: "mdraid: padded detail value", text: fill("/dev/md0:\n   State : ", " ", size, "x\n") },
  );
  out.push(...roundTwoInputs(size));
  return out;
}

/** Distinct short tokens: "aaa", "aab", ... in [a-z0-9]. */
function token(i: number, width: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let k = 0; k < width; k++) {
    s = chars[i % chars.length] + s;
    i = Math.floor(i / chars.length);
  }
  return s;
}

/** Lines from `make(i)` until the paste reaches `size`. */
function lines(prefix: string, make: (i: number) => string, size: number): string {
  const parts: string[] = [prefix];
  let n = prefix.length;
  for (let i = 0; ; i++) {
    const line = make(i) + "\n";
    if (n + line.length > size) break;
    parts.push(line);
    n += line.length;
  }
  return parts.join("");
}

// Review round 2: regexes that stay quadratic inside a parser's line cap, and
// joins that grow with the product of two lists.
function roundTwoInputs(size: number): AdversarialInput[] {
  const banner = "smartctl 7.4 2023-08-01 r5530\n";
  const detailTable = "/dev/md0:\n    Number   Major   Minor   RaidDevice State\n       0       8        1        0";
  return [
    // R2-1: '.' stops at U+2028 and U+2029, so a whitespace run before a
    // trailing "(.*)$" is retried at every split. mdraid had no line cap.
    { name: "mdraid: padded detail row ending in U+2029", text: fill(detailTable, " ", size, "x\u2029\n") },
    { name: "mdraid: tab-padded detail row ending in U+2028", text: fill(detailTable, "\t", size, "x\u2028\n") },
    { name: "smartctl: padded prompt lines with a mid-line U+2028", text: fill("", "root@h:~#" + " ".repeat(4080) + "x\u2028y\n", size) },
    { name: "nvidia: padded -q value with a mid-line U+2028", text: fill(NVSMI_BANNER + "GPU 00000000:01:00.0\n", "    Product Name :" + " ".repeat(4060) + "x\u2028y\n", size) },
    { name: "zpool: padded scan lines with a mid-line U+2028", text: fill("  pool: p\n state: ONLINE\n", "  scan:" + " ".repeat(4080) + "x\u2028y\n", size) },
    { name: "kernel: padded syslog lines with a mid-line U+2029", text: fill("", "Oct  4 06:51:00" + " ".repeat(2000) + "x\u2029y\n", size) },
    // R2-8: two whitespace quantifiers splitting one run in the header regexes.
    { name: "smartctl: padded Drive label lines", text: fill(banner, "Drive" + " ".repeat(4089) + "x\n", size) },
    { name: "smartctl: padded decorated header lines", text: fill(banner, "= /dev/sda" + " ".repeat(4084) + "x\n", size) },
    // R2-9: every indented line is a truncated JSON candidate.
    { name: "smartctl: indented quote-per-line JSON candidates", text: fill(banner, ' {"s\n', size) },
    // R2-10: a digit run where the NVLink bandwidth belongs.
    {
      name: "nvidia: NVLink link lines of digits",
      text: lines("GPU 0: a (UUID: GPU-1)\n", (i) => `    Link ${i % 1000}: ` + "1".repeat(4080), size),
    },
    // R2-11: SMART entries from separate JSON values, joined against distinct
    // I/O error devices.
    {
      name: "smartctl JSON values joined with distinct I/O error devices",
      text:
        fill("", '{"smart_status":0}\n', Math.floor(size / 2)) +
        lines("", (i) => `blk_update_request: I/O error, dev u${token(i, 3)}, sector 0`, Math.ceil(size / 2)),
    },
    {
      name: "smartctl JSON values joined with SCSI sense events",
      text:
        fill("", '{"smart_status":0}\n', Math.floor(size / 2)) +
        lines("", (i) => `sd 0:0:0:0: [s${token(i, 3)}] Sense Key : Medium Error [current]`, Math.ceil(size / 2)),
    },
    {
      name: "smartctl JSON values joined with degraded md arrays",
      text:
        fill("", '{"smart_status":0}\n', Math.floor(size / 2)) +
        lines("Personalities : [raid1]\n", (i) => `md${i} : active raid1 sda1[0](F) sdb1[1]\n      1 blocks [2/1] [_U]`, Math.ceil(size / 2)),
    },
    // R2-12: the same array line repeated with distinct members.
    {
      name: "mdraid: repeated array line with distinct members",
      text: lines("Personalities : [raid1]\n", (i) => "md0 : active raid1 " + Array.from({ length: 512 }, (_, k) => `${token(i * 512 + k, 3)}[0]`).join(" "), size),
    },
    {
      name: "mdraid: repeated array line with distinct failed members",
      text: lines("Personalities : [raid1]\n", (i) => "md0 : active raid1 " + Array.from({ length: 400 }, (_, k) => `${token(i * 400 + k, 3)}[0](F)`).join(" "), size),
    },
  ];
}
