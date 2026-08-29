-- 030_supersede_orphaned_drive_path_warnings.sql
--
-- One-time cleanup of duplicate drive/nvme trend warnings caused by the
-- resource-identity fallback in persistence.ts:
--   resource_identifier = `${kind}:${serial ?? name}`
--
-- A drive's identity used the device path (e.g. `drive:/dev/sdb`) while its
-- serial was unknown, then flipped to `drive:<serial>` once the serial
-- resolved (the RAID/SMART serial join, #360). The upsert had no supersede
-- step, so the path-keyed warning was never resolved and the same disk shows
-- as two active warnings (one path-keyed, one serial-keyed). The path-keyed
-- one is orphaned: new detections key on the serial, so it never increments
-- or auto-resolves.
--
-- This resolves every active path-keyed drive/nvme warning that has an active
-- serial-keyed sibling for the same (server, warning_type, kind). Warnings
-- that only have a path key (no serial sibling) are left alone: there, the
-- path is still the only identity we have. The companion persistence.ts
-- change supersedes future cases automatically.
--
-- NO-COLUMN-DELTA: data-only cleanup (resolves rows, no schema change); without this
-- marker the runner's silent-no-op guard would abort the deploy.

BEGIN;

UPDATE public.trend_warnings t
SET resolved_at = now(), resolution_reason = 'superseded_by_serial'
WHERE t.resolved_at IS NULL
  AND t.resource_identifier ~ '^(drive|nvme):/dev/'
  AND EXISTS (
    SELECT 1 FROM public.trend_warnings s
    WHERE s.server_id = t.server_id
      AND s.warning_type = t.warning_type
      AND s.resolved_at IS NULL
      AND s.id <> t.id
      AND split_part(s.resource_identifier, ':', 1) = split_part(t.resource_identifier, ':', 1)
      AND s.resource_identifier !~ '^(drive|nvme):/dev/'
  );

INSERT INTO schema_migrations (version, name) VALUES
  (30, '030_supersede_orphaned_drive_path_warnings')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM public.trend_warnings t
  WHERE t.resolved_at IS NULL
    AND t.resource_identifier ~ '^(drive|nvme):/dev/'
    AND EXISTS (
      SELECT 1 FROM public.trend_warnings s
      WHERE s.server_id = t.server_id
        AND s.warning_type = t.warning_type
        AND s.resolved_at IS NULL
        AND s.id <> t.id
        AND split_part(s.resource_identifier, ':', 1) = split_part(t.resource_identifier, ':', 1)
        AND s.resource_identifier !~ '^(drive|nvme):/dev/'
    );
  RAISE NOTICE 'migration 030: path-keyed drive/nvme warnings with a serial sibling remaining = %', remaining;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'migration 030 FAILED: % path-keyed warnings still have a serial sibling', remaining;
  END IF;
END$$;

COMMIT;
