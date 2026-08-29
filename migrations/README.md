# Writing a migration

Two rules, both learned by breaking a deploy rather than by reasoning about it.

## Every migration must record itself

The last statement before `COMMIT` inserts the migration's own row:

```sql
INSERT INTO schema_migrations (version, name) VALUES
  (40, '040_hosted_free_node_cap')
ON CONFLICT (version) DO NOTHING;
```

The runner refuses a migration that changed the database without recording
itself, and aborts the deploy rather than swapping services. It is right to: an
unrecorded migration is one that runs again on the next deploy, and again after
that.

## Every migration must be safe to run twice

This is the rule that is easy to skip, because most migrations happen to satisfy
it. Then one does not, and the failure is silent until it is expensive.

The reason is mechanical. A migration's own `BEGIN/COMMIT` commits before the
runner checks anything, and before the services are swapped. **So a deploy can
fail with the migration already applied.** The database moves, the application
does not, and the next deploy runs your migration a second time against a
database that already has the change.

Worked example, migration 040 on 2026-08-27. It raised a column default and
updated existing rows, and it was written without the `schema_migrations` insert
above. The runner refused it and stopped the deploy, exactly as designed. The
`ALTER` and the `UPDATE` had already committed. Production carried the new
default while still running the old code, and the fix had to run again from the
top.

Re-running was safe, and not by luck:

- `ALTER TABLE ... SET DEFAULT` is idempotent. Setting the same default twice is
  indistinguishable from setting it once.
- `UPDATE customers SET plan_server_limit = 10 WHERE plan_server_limit = 3`
  matched nothing the second time, because no row was left at 3.

Had it instead been written as `UPDATE ... SET plan_server_limit =
plan_server_limit + 7`, the second run would have produced 17 and there would
have been no way to tell, from the database alone, which rows had been counted
twice. That migration would have needed a manual repair under time pressure.

So, concretely:

- Prefer absolute assignments to relative ones. `SET x = 10`, never `SET x = x + 7`.
- Guard inserts with `ON CONFLICT DO NOTHING` or a `WHERE NOT EXISTS`.
- Use `IF NOT EXISTS` / `IF EXISTS` on DDL where the dialect allows it.
- When a statement genuinely cannot be repeated, say so in a comment at the top
  of the file, and say what to check before re-running. Someone will meet that
  file at the point where the runner has just refused it, and their first
  question will be whether it is safe to try again.

## Say when the schema does not change

The runner fingerprints the column inventory and expects a delta. A migration
that only grants privileges, moves a default, or edits data will not move that
fingerprint, which is indistinguishable from a migration whose `IF NOT EXISTS`
guards all matched and quietly did nothing. Declare it:

```sql
-- NO-COLUMN-DELTA: default and data change only (no column add/drop), so the
-- runner's column-inventory fingerprint is unchanged by design. Not a silent
-- IF-guard match.
```
