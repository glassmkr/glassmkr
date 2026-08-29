# Writing remediation content

These commands run on hardware you have never seen, as root, by someone who
trusts the tool. Everything below came out of the gate 2 safety review
(2026-08-26), where every finding turned out to be the same assumption wearing
a different costume.

## The four assumptions

**Never assume a config path is ours. Namespace it.**
`gpu_driver_unsafe_reboot` wrote to `/etc/modprobe.d/blacklist-nouveau.conf`,
and its rollback deleted that path. On a GPU host that file frequently already
exists, so the fix silently overwrote the operator's file and the rollback then
removed it. Write to `99-glassmkr-<thing>.conf`, which cannot collide, and have
the rollback remove only that. If you must edit a file you did not create, copy
it to `<file>.gmk-backup` first, and make the rollback restore from that copy
rather than deleting or flushing.

**Never assume a service is off. Check before disabling.**
`ntp_not_synced`'s rollback disabled both chronyd and systemd-timesyncd
unconditionally, which on a host that already ran one switched off working time
sync that predated the fix. `unattended_upgrades_disabled` went further and
uninstalled a package that is usually present and merely disabled. A rollback
undoes what the fix did; it does not return the machine to a state you imagined.

**Never assume a device name. Derive it.**
`smart_failing` and `nvme_wear_high` hardcoded `/dev/md126`. It is a name
firmware-RAID hosts commonly DO have for an unrelated array, so someone
uncommenting the line could fail a disk out of the wrong one. Derive the array
from the device (`lsblk -no PKNAME,TYPE`), and do not assume the RAID member is
the whole disk either: on many hosts it is a partition.

**Never assume a check that ran is a check that answered. Refuse on empty
input.** A validation must prove the condition cleared; if the values it needs
are missing it must say so and exit non-zero, never report OK. The first
`load_high` validation ran on a host without `/proc/loadavg`, read the load and
the core count as empty strings, and printed "OK, load 0 below threshold on 0
cores". It looked like the strongest possible pass and it had measured nothing.
Validate the inputs before you compare them, and make the failure message say
which input was missing.

## Destructive steps

Comment them out, and say WHY they are commented, not merely that they are.
Someone uncommenting a line believes they understand it, and the comment is the
only thing between them and a rebuild. State what is irreversible, what to
confirm first, and what to substitute. Put the read-only derivation ABOVE the
commented block and leave it live, so the operator sees real values before
deciding.

Never run unattended package removal (`autoremove -y`). Drop the `-y` so the
list gets read on a machine whose contents you do not know.

## Validation

The validation step must prove the alert's condition cleared, not that a
command ran. Where the rule has a numeric threshold, assert it and exit
non-zero while it still holds: `load_high` fires at `load_1m >= cores * 1.5`,
so that is what its validation tests.

Guard the inputs, per the fourth assumption above. Silence and zero are not
the same answer, and a validation that cannot tell them apart is worse than
none.

Where no exit code can answer the question ("is the fan replaced"), an
observational validation is correct, but its description must state the pass
condition explicitly.
