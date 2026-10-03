# Review test cases: Glassmkr hardware triage

OpenAI's initial review of a plugin with an MCP server needs exactly five
positive and three negative test cases. Positive cases carry a description, the
prompt, the tools expected to run (`tools_triggered`) and the observable
expected result (`expected_behavior`); negative cases carry a description and
the prompt, plus why the plugin should not act and the expected fallback.
Sources: `developers.openai.com/plugins/deploy/submission` (sections "Complete
review information" and "Configure onboarding, review, and publication") and
`developers.openai.com/plugins/deploy/app-review` (common rejection reasons).

These cases are also embedded in `openai-plugin/plugin.json`
(`extensions.com.openai.review.test_cases`), which makes them read-only in the
portal: to change one, edit both places and upload a new ZIP.
`scripts/validate-openai-plugin.mjs` fails if a prompt in the manifest is not a
verbatim code block in this file.

**Status: every case is TO VERIFY in ChatGPT developer mode.** They were written
from the spec and the rule code before the endpoint was deployed. The cases that
paste output have also been run locally through the MCP route handler with the
final parsers (noted per case); that checks the tool result, not the model's
reply. Before zipping:

1. Deploy, then run each prompt in ChatGPT developer mode (see
   `SUBMISSION_CHECKLIST.md`, step A3) and in the MCP Inspector
   (`npx @modelcontextprotocol/inspector@latest`, Streamable HTTP,
   `https://app.glassmkr.com/api/triage/mcp`, no auth).
2. Compare the actual `structuredContent` with the "Key outcome" list.
3. If they differ, decide whether the code or the case is wrong. Fix the code if
   the case states the rule's real semantics; otherwise update the
   `expected_behavior` here AND in `plugin.json`, then rerun the validator.
4. Change the status line of each case to "verified <date>".

Reviewers reject a case when the actual output does not match, or when the
reply carries "extraneous information that is irrelevant to the request"
(app-review). Keep expected behavior specific but not over-specified: name the
rule id, severity and subject; do not pin exact wording of the summary.

All serials, hostnames and PIDs are fake.

---

## Positive cases

### P1. Failing SATA drive, smartctl -a text

Status: TO VERIFY in ChatGPT. Route-level check passed 2026-10-03 (local: a real Request through the MCP route handler, all six parsers, the evaluator and resolveFix; not yet in ChatGPT): one `smart_failing`, critical, /dev/sda, serial ZC1REVIEW1, reallocated_sectors 24, health PASSED.

| Field | Value |
|---|---|
| description | Failing SATA drive in smartctl -a text output: the overall health line says PASSED but the reallocated sector count is non-zero. |
| tools_triggered | `analyze_server_output` |
| expected_behavior | Calls analyze_server_output with the pasted text. Reports one critical smart_failing finding for /dev/sda, serial ZC1REVIEW1, triggered by 24 reallocated sectors, and explains that the reallocated count fired the rule even though the health line says PASSED. Includes the rule's fix steps, starting with confirming the serial before any drive swap. Does not predict when the drive will fail. |

Key outcome to verify:

- `input.formats` contains `smartctl_text`; `input.subjects` is 1.
- `findings` has exactly one entry: `rule_id: smart_failing`, `severity: critical`,
  `subject.kind: drive`, `subject.id: /dev/sda`, `subject.serial: ZC1REVIEW1`.
- `observed.reallocated_sectors` is 24 and `observed.health` is `PASSED`. Pending
  sectors (8) may appear as evidence but are not a trigger (removed as a trigger
  on 2026-08-04, see `evaluator.ts`).
- The prompt line `root@web-01:~# smartctl -a /dev/sda` does not break parsing.
- No "healthy" wording anywhere; no failure-date prediction.

Prompt:

```
Is this drive failing?

root@web-01:~# smartctl -a /dev/sda
smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.8.0-45-generic] (local build)
=== START OF INFORMATION SECTION ===
Device Model:     ST4000NM0035-1V4107
Serial Number:    ZC1REVIEW1
Firmware Version: TN04
User Capacity:    4,000,787,030,016 bytes [4.00 TB]

=== START OF READ SMART DATA SECTION ===
SMART overall-health self-assessment test result: PASSED

SMART Attributes Data Structure revision number: 10
Vendor Specific SMART Attributes with Thresholds:
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  5 Reallocated_Sector_Ct   0x0033   100   100   010    Pre-fail  Always       -       24
  9 Power_On_Hours          0x0032   053   053   000    Old_age   Always       -       41234
194 Temperature_Celsius     0x0022   038   045   000    Old_age   Always       -       38
197 Current_Pending_Sector  0x0012   100   100   000    Old_age   Always       -       8
198 Offline_Uncorrectable   0x0010   100   100   000    Old_age   Offline      -       8
```

### P2. Degraded mdadm RAID 1, /proc/mdstat

Status: TO VERIFY in ChatGPT. Route-level check passed 2026-10-03 (local: a real Request through the MCP route handler, all six parsers, the evaluator and resolveFix; not yet in ChatGPT): one `raid_degraded`, critical, md0, `observed.failed_disks` sdb1.

| Field | Value |
|---|---|
| description | Degraded mdadm RAID 1 array in /proc/mdstat: one member is marked (F) and the status shows [U_]. |
| tools_triggered | `analyze_server_output` |
| expected_behavior | Calls analyze_server_output. Reports one critical raid_degraded finding for md0 (raid1) that names sdb1 as the failed member, with fix steps that check that member's SMART health and kernel log before choosing between re-adding and replacing it. Does not describe the array as OK. |

Key outcome to verify:

- `input.formats` contains `proc_mdstat`.
- `findings` has exactly one entry: `rule_id: raid_degraded`, `severity: critical`,
  `subject.kind: md_array`, `subject.id: md0`; `observed` names `sdb1` as failed.
- `fix` names the array in its commands (`mdadm --detail /dev/md0`,
  `mdadm --manage /dev/md0 --add /dev/sdN`). The member commands keep the
  rule's placeholders (`/dev/<member>`, `/dev/sdN`): the raid_degraded fix
  workflow interpolates only the array, so the operator fills the member in
  from `observed.failed_disks`.

Prompt:

```
Is my RAID OK? This is /proc/mdstat from the server:

Personalities : [raid1] [linear] [multipath] [raid0] [raid6] [raid5] [raid4] [raid10]
md0 : active raid1 sdb1[1](F) sda1[0]
      976630336 blocks super 1.2 [2/1] [U_]
      bitmap: 2/8 pages [8KB], 65536KB chunk

unused devices: <none>
```

### P3. NVIDIA Xid 79 in dmesg

Status: TO VERIFY in ChatGPT. Route-level check passed 2026-10-03 (local: a real Request through the MCP route handler, all six parsers, the evaluator and resolveFix; not yet in ChatGPT): one `gpu_xid_critical`, critical, subject id 0000:3b:00, xid_code 79; the second line added no finding; the content text carries the "Times unknown" caveat.

| Field | Value |
|---|---|
| description | NVIDIA Xid 79 in dmesg output with boot-relative timestamps. |
| tools_triggered | `analyze_server_output` |
| expected_behavior | Calls analyze_server_output. Reports a critical gpu_xid_critical finding for the GPU at PCI 0000:3b:00 with Xid 79 (GPU fell off the bus) and fix steps. States that the event time is unknown because the log uses boot-relative timestamps. Does not state a root cause the log does not show. |

Key outcome to verify:

- `input.formats` contains `dmesg`.
- `findings` has one entry: `rule_id: gpu_xid_critical`, `severity: critical`,
  `subject.kind: gpu`, PCI address 0000:3b:00, `observed.xid_code` 79.
- The `content` text carries the "Times unknown" caveat; no "now" or invented
  timestamp anywhere in the result.
- The second line (`GPU has fallen off the bus` without an Xid) does not create
  a second finding.
- Watch item: `gpu_xid_critical` is gated on `snap.gpu.available` and
  `tier1.available`. A dmesg-only paste must set both for the rule to run; if
  this case returns no finding, check the kernel-log parser first.

Prompt:

```
Our training job died overnight. Is this a GPU hardware problem?

[90211.554310] NVRM: Xid (PCI:0000:3b:00): 79, pid=48213, name=python3, GPU has fallen off the bus.
[90211.554402] NVRM: GPU 0000:3b:00.0: GPU has fallen off the bus.
```

### P4. What to run for a ZFS pool (capture command)

Status: TO VERIFY

| Field | Value |
|---|---|
| description | The user has no output yet and asks what to run for a ZFS pool on Ubuntu. |
| tools_triggered | `get_capture_command` |
| expected_behavior | Calls get_capture_command with goal zfs and distro ubuntu (it may also request all_disks). Returns the exact commands to run, including sudo zpool status -v (and a smartctl loop over the disks if all_disks was requested), and asks the user to paste the output back. Does not ask for credentials and does not claim to have run anything. |

Key outcome to verify:

- Tool arguments: `goal: "zfs"` (a second call with `all_disks` is acceptable),
  `distro: "ubuntu"`.
- Returned commands are exactly what `capture.ts` emits for those goals. As of
  2026-10-03 the `zfs` goal returns only `sudo zpool status -v`; the `all_disks`
  goal returns a `smartctl -j -a` loop over `lsblk` disks.
- The model does not call `analyze_server_output` (there is nothing to analyze).

Prompt:

```
I think a disk in my ZFS pool is dying. What should I run on the server so you can check it? It runs Ubuntu 24.04.
```

### P5. Continuous monitoring setup

Status: TO VERIFY

| Field | Value |
|---|---|
| description | The user asks how to watch these signals continuously instead of pasting output. |
| tools_triggered | `get_monitoring_setup` |
| expected_behavior | Calls get_monitoring_setup with distro debian. Returns the prerequisites (including smartmontools and ipmitool), the Crucible agent install command, an enrollment step that reads the collector key on the server at a hidden prompt, commands to verify the agent is running and reporting, and a link to the Glassmkr getting-started documentation. Never asks the user to paste an API key into the conversation. |

Key outcome to verify:

- Tool arguments: `distro: "debian"`; `target` is whatever the model picks
  (`hosted` unless the user asks to self-host). Both targets must satisfy the
  expected behavior.
- The key is read on the server at a hidden prompt (`read -rs
  GLASSMKR_API_KEY`), never requested in chat; the result's `key_handling` says
  so. For Debian (an apt family) the steps hand it to the one-line installer
  through the environment (`sudo -E bash`); the single-file binary path, shown
  for other distributions, pipes it to `glassmkr-crucible init --api-key -`.
- No pricing, plan, free-tier, trial or node-cap text in the tool output or its
  description (OpenAI plugin guidelines, "Commerce and monetization").
- The docs link resolves (200) and matches `setup.ts`.

Prompt:

```
How can I watch for disk and RAID failures continuously on my Debian servers instead of pasting output each time?
```

---

## Negative cases

### N1. Unrelated creative request

Status: TO VERIFY

| Field | Value |
|---|---|
| description | Unrelated creative writing request. Glassmkr only analyzes server hardware output, so no Glassmkr tool should run and the assistant answers on its own. |
| why not | Nothing in the request relates to server hardware or command output. |
| expected fallback | No Glassmkr tool is called. |

Prompt:

```
Write me a short poem about autumn.
```

### N2. Unrelated factual request

Status: TO VERIFY

| Field | Value |
|---|---|
| description | Unrelated weather question. Glassmkr has no weather data, so no Glassmkr tool should run. |
| why not | Outside the plugin's purpose; the tools have no data source for it. |
| expected fallback | No Glassmkr tool is called. |

Prompt:

```
What will the weather be in Prague tomorrow?
```

### N3. Unsupported platform: Windows Event Viewer

Status: TO VERIFY in ChatGPT. Route-level check passed 2026-10-03 (local: a real Request through the MCP route handler, all six parsers, the evaluator and resolveFix; not yet in ChatGPT): formats [], findings [], checked_no_signal [], not an error, next_capture lists six capture goals.

| Field | Value |
|---|---|
| description | Windows Event Viewer output is outside Glassmkr's supported formats (Linux command output only), so Glassmkr must not give a hardware verdict on it. |
| why not | No parser reads Windows event logs, so any verdict would be invented. |
| expected fallback | Preferably no Glassmkr tool is called and the assistant answers on its own. If analyze_server_output is called, it recognizes no supported format, returns no findings and no verdict, and suggests Linux capture commands instead. The reply must not describe the disk as healthy. |

Key outcome to verify (only if the tool is called): `input.formats` is `[]`,
`findings` is `[]`, `checked_no_signal` is `[]` (no rule ran, so nothing can be
listed as checked), the result is not an error, and `next_capture` is non-empty.

Prompt:

```
Is this disk failing? This is from the Windows Event Viewer System log:

Log Name:      System
Source:        disk
Event ID:      7
Level:         Error
Description:   The device, \Device\Harddisk1\DR1, has a bad block.
```

---

## Starter prompts (listing `defaultPrompt`)

The listing's starter prompts must be workflows the plugin can complete
(`developers.openai.com/plugins/deploy/connect-chatgpt`, final checklist). Each
is one line and at most 128 characters. Run each one in developer mode before
submitting.

| # | Prompt | Expected tool | Status |
|---|---|---|---|
| S1 | `Is this GPU failing? [90211.554310] NVRM: Xid (PCI:0000:3b:00): 79, pid=48213, name=python3, GPU has fallen off the bus.` | `analyze_server_output`: one `gpu_xid_critical` (critical), times unknown | TO VERIFY in ChatGPT. Route-level check 2026-10-03: the single line with a leading question is read as `dmesg` and yields one critical `gpu_xid_critical`, times unknown. |
| S2 | `Which commands should I run so you can check every disk in my Linux server for SMART errors?` | `get_capture_command` with `goal: all_disks` | TO VERIFY |
| S3 | `How do I monitor SMART, RAID, ZFS and GPU errors on my Linux servers continuously?` | `get_monitoring_setup` | TO VERIFY |

---

## Extra golden prompts (not submitted)

For tuning tool metadata in developer mode (`developers.openai.com/plugins/guides/optimize-metadata`:
direct, indirect and negative prompts; aim for precision on negatives first).
Not part of the review package.

**G1. Degraded ZFS mirror** (expected: `zfs_pool_unhealthy`, critical, because a
two-way mirror has no remaining redundancy. Route-level check 2026-10-03:
`zfs_pool_unhealthy`, critical, pool tank, `observed.vdev_name` mirror-0,
`vdev_redundancy_class` mirror_2way.)

```
  pool: tank
 state: DEGRADED
status: One or more devices are faulted in response to persistent errors.
	Sufficient replicas exist for the pool to continue functioning in a
	degraded state.
action: Replace the faulted device, or use 'zpool clear' to mark the device
	repaired.
  scan: scrub repaired 0B in 05:12:44 with 0 errors on Sun Sep 13 05:36:45 2026
config:

	NAME                                  STATE     READ WRITE CKSUM
	tank                                  DEGRADED     0     0     0
	  mirror-0                            DEGRADED     0     0     0
	    ata-ST4000NM0035-1V4107_ZC1TEST1  ONLINE       0     0     0
	    ata-ST4000NM0035-1V4107_ZC1TEST2  FAULTED      3   112     0  too many errors

errors: No known data errors
```

**G2. BMC event log with a real fault and a transient** (expected:
`ipmi_sel_critical` for `Memory #0x02` Uncorrectable ECC; the Power Supply
assert that deasserted one second later is treated as a transient by the
assert/deassert pairing and not reported by that rule; `ecc_errors` may also fire
from the SEL ECC counts. Route-level check 2026-10-03: read as `ipmitool_sel_list`;
`ipmi_sel_critical` (affected component Memory #0x02, 1 transient pair excluded)
and `ecc_errors` (1 uncorrectable), both critical; the Power Supply pair did not
count.)

```
   1 | 09/28/2026 | 14:23:05 | Memory #0x02 | Correctable ECC | Asserted
   2 | 09/28/2026 | 14:23:09 | Memory #0x02 | Uncorrectable ECC | Asserted
   3 | 09/29/2026 | 03:11:42 | Power Supply #0xc8 | Failure detected | Asserted
   4 | 09/29/2026 | 03:11:43 | Power Supply #0xc8 | Failure detected | Deasserted
```

**G3. Unrecognized output** (expected: `analyze_server_output` returns
`formats: []`, `findings: []`, not an error, and `next_capture` lists the
commands to run. The reply must not say the disks are fine.)

```
NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda      8:0    0   3.6T  0 disk
sdb      8:16   0   3.6T  0 disk
```

**G4. Action request** (expected: no tool claims to act. The assistant may quote
the fix steps from an earlier finding but must not say it ran them; Glassmkr
tools are read-only.)

```
Replace the failed disk in md0 for me: remove sdb1 and add the new drive.
```

**G5. Concept question** (either outcome is acceptable: the model may answer
from its own knowledge without a tool. Use it to check the tool does not fire
on every SMART mention.)

```
What does Reallocated_Sector_Ct mean in smartctl output?
```
