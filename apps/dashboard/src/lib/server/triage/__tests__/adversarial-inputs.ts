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
  return out;
}
