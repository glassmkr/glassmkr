# ECC counter semantics (Crucible 0.9.1)

> Pre-deploy investigation. Filed against the A.3 `ecc_errors` evaluator
> shipped in [glassmkr#20](https://github.com/glassmkr/glassmkr/pull/20)
> with a default warning threshold of `correctable >= 10`. This doc
> answers: do `ipmi.ecc_errors.correctable` and
> `ipmi.ecc_errors_from_sel.correctable` represent per-collection-interval
> deltas, or are they cumulative since some prior reset point?

## TL;DR

**Both counters are cumulative-since-last-clear, not per-interval.**

- `ipmi.ecc_errors_from_sel`: cumulative over the SEL's lifetime
  (resets only when an operator explicitly runs `ipmitool sel clear`
  or the BMC firmware purges the log). On the validation fleet, no
  SEL has ever been cleared (`Last Del Time: Not Available` on all
  6 boxes); entry counts range from 3 to 1022.
- `ipmi.ecc_errors` (named-sensor path): equals the sum of values from
  any `ipmitool sensor` row whose name contains `correctable` /
  `uncorrectable`. The IPMI spec does not mandate auto-reset on read;
  in practice these are cumulative counters whose only reset is BMC
  reset / SEL clear / DIMM swap. None of the 6 validation boxes
  exposes such a sensor today, so we have no first-party data on
  vendor semantics — but the IPMI 2.0 sensor-type 0x0C "Memory" and
  the surrounding ecosystem (mcelog, EDAC, Dell DSET) all treat ECC
  counters as cumulative.

This means the **A.3 default `correctable_warn = 10` is a cumulative
threshold**, not a per-cycle rate. That has implications below.

## Source-code references

`packages/crucible/src/collect/ipmi.ts` (Crucible 0.9.1, the now-canonical
release):

```ts
// Lines 28-35 — sensor data is read once per collection cycle from
// `ipmitool sensor`, the BMC's current-state report.
const sensorRaw = await run("ipmitool", ["sensor"]);
// ...
for (const line of sensorRaw.split("\n")) {
  const parts = line.split("|").map((s) => s.trim());
  // parts[1] is the value as the BMC reports it on this read.
  const value: number | string = isNaN(numValue) ? rawValue : numValue;
  sensors.push({ name, value, unit, status, upper_critical: upperCritical });
}
```

```ts
// Lines 67-77 — ecc_errors.correctable is the SUM of all sensor values
// whose name contains "correctable". This is the BMC's current
// reading at sample time. There is no delta computation against a
// prior snapshot.
let correctable = 0;
let uncorrectable = 0;
for (const sensor of sensors) {
  const name = sensor.name.toLowerCase();
  if (name.includes("correctable") && typeof sensor.value === "number") {
    correctable += sensor.value;
  }
  if (name.includes("uncorrectable") && typeof sensor.value === "number") {
    uncorrectable += sensor.value;
  }
}
```

```ts
// Lines 130-163 — ecc_errors_from_sel.correctable is computed by
// re-parsing the FULL `ipmitool sel elist` output (the entire SEL,
// not the recent window) and counting any line whose sensor or event
// matches memory/dimm/ecc patterns. This is unambiguously
// cumulative-since-SEL-clear.
export async function collectSelEccCounts(): Promise<{ correctable: number; uncorrectable: number; ... }> {
  const output = await run("ipmitool", ["sel", "elist"]);
  // ...
  return parseSelEccCounts(output);
}
```

The collector code itself does not maintain prior-snapshot state for
ECC counters, so even if a BMC reset its sensor on each read (which is
not the IPMI spec), Crucible would not compute a per-interval delta —
it forwards whatever the BMC reports, summed across matching sensor
names.

## Cross-vendor evidence from validation fleet

`Last Del Time` is the IPMI field that records when the SEL was last
cleared. From `pass1-raw/ipmitool-sel-info.txt` on each box:

| Box | Entries | Last Add Time | Last Del Time | Lifetime |
|---|---|---|---|---|
| supermicro-x11ssl | 508 | 2026-05-07 01:03:51 UTC | Not Available | unknown — never cleared |
| supermicro-h12sst | 3 | 2023-08-07 06:36:15 | Not Available | unknown — last event 2.7 years ago |
| asrock-x570d4u | 106 | 2026-05-06 23:18:40 UTC | Not Available | unknown — never cleared |
| gigabyte-mz62hd | 126 | 2026-05-07 07:02:28 | Not Available | unknown — never cleared |
| gigabyte-mc12le | 1022 | 2026-05-07 02:08:26 | Not Available | basically full (99% used) |
| asus-z12pp | n/a | n/a | n/a | no ipmitool installed |

On real customer hardware that has been running for months, the SEL
will likewise be cumulative across the box's operational life unless
the operator manually clears it. **mc12le's SEL is at 99% capacity
already** — that's a 1022-event lifetime accumulation.

None of these boxes happen to have any ECC-classified events in their
SELs, so the practical impact on this fleet is zero. But on a
customer host with even a slow drip of cosmic-ray correctable events
over months, accumulated counts would readily exceed the `>=10`
threshold without indicating any actual hardware problem.

## Implication for the A.3 `>=10` default

The threshold change shipped in [PR #20](https://github.com/glassmkr/glassmkr/pull/20)
moved the warning fire-point from `correctable > 0` to
`correctable >= 10`. Both old and new thresholds are evaluated
**against a cumulative counter**, not a rate.

- **Old `>0` was clearly broken on cumulative semantics**: any box
  with ever-recorded CE in its SEL would warning-fire perpetually,
  regardless of when those events happened or whether they were a
  real hardware concern. (This was masked on the validation fleet
  because none of those boxes had ECC events; on real customer
  hardware over time, false-positive rate would have been ~100% for
  any host with CE history.)
- **New `>=10` is more reasonable but still a static cumulative
  threshold**. It will eventually fire on any host that accumulates
  10 lifetime correctable events. On healthy DDR4/DDR5 RAM, that's
  on the order of one event per several months from cosmic-ray-class
  hits — so a healthy host with 5+ years of uptime might cross the
  threshold without any actual hardware degradation.

Industry references for context:

- **mcelog** uses bucketed rate thresholds: 10 corrected per 24h →
  warning, 100 per 24h → "leaky bucket" alarm. Not a static cumulative.
- **Dell iDRAC** "exceeded threshold" defaults to 8 corrected events
  per memory location per 24h. Rate-based.
- **Linux EDAC** reports raw cumulative counts at
  `/sys/devices/system/edac/mc/mc*/ce_count`; thresholding is left
  to userspace.

Industry consensus is that ECC alerting should be rate-based or
bucketed-rate-based, not static cumulative. A.3's `>=10` is on the
strict end of "static cumulative defensible" but is not industry-best
practice.

## Options to surface to Simon

The spec's pre-deploy decision branch (line 47-52) calls for stopping
and surfacing if the counter is cumulative. Three options:

### Option A — revert the threshold change

Follow-up PR that reverts the `>=10` default back to `>0` and keeps
the SEL-derived path benefit in place. Threshold redesign happens
later as a deliberate workstream.

- Pros: smallest delta from prior behaviour; doesn't ship a new
  threshold whose semantics aren't fully baked.
- Cons: returns to known-broken behaviour for any box with a
  non-empty ECC SEL history (not observed on the validation fleet, so
  this might never fire in practice on the current customer base).
- Implementation: 1-line change to `evaluator.ts` plus a test update.

### Option B — bump the default substantially or rate-base it

Bigger spec change. Two flavours:

- **B1 (static, higher)**: bump default to e.g. `>=100` cumulative
  correctable. Still a static threshold, just less likely to fire on
  healthy long-running hardware. Same one-line change as Option A;
  a guess at the right number.
- **B2 (rate-based across snapshots)**: compute delta vs. prior
  snapshot's count, alert on rate. Requires Dashboard-side state (we
  store snapshots in ClickHouse, so the data is available; the
  evaluator currently doesn't read across snapshots). Material
  refactor.

### Option C — keep `>=10`, document semantics explicitly

Ship as-is. Justify in the customer release notes:

- Old behaviour was wrong (any cumulative CE → warning).
- New behaviour is on the strict end of cumulative thresholds but
  defensible: 10 lifetime correctables on a healthy host is unusual
  for boxes < ~3-5 years uptime. For older hosts, customers can
  override via the per-server `ecc_correctable_warning` config.
- A future workstream will rate-base this (Option B2 deferred to
  post-launch).

This option accepts a known-imperfect threshold but acknowledges it
in customer messaging and provides an override path. It's lower-risk
than (B2) and closes the immediate "old behaviour was clearly broken"
gap.

## Recommendation

I'd suggest **Option C**: ship `>=10` to production, document the
cumulative semantics + override path in the release notes, and
schedule the rate-based redesign (Option B2) as a Phase 7 follow-up.
A.3 is strictly improving on the prior `>0` (which was broken on any
cumulative-counter BMC) and the override gives operators a knob if
they hit false positives.

But the spec called for stopping and surfacing on cumulative-counter
findings, so this is Simon's call. **No deploy until directed.**

## What this doc explicitly doesn't claim

- I have not first-party observed a vendor-specific named ECC sensor
  with auto-reset-on-read semantics. Such a sensor is theoretically
  possible (an IPMI implementation could choose to clear on read);
  none of the six validation boxes exposes any "*correctable*" sensor
  at all, so I can't refute by direct measurement. The conclusion
  above relies on IPMI 2.0 spec conventions and the surrounding
  ecosystem (mcelog, EDAC, Dell DSET) which all treat ECC counts as
  cumulative.
- Customers' SELs may have been cleared post-purchase by their ops
  teams. The validation fleet's "Last Del Time: Not Available" is
  evidence on these specific boxes; not all customer boxes will
  match.
- This doc only covers semantics. The decision on threshold value
  belongs to Simon.
