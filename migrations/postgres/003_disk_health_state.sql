-- Per-drive disk health rollup state. One row per (server, device_id) while
-- the drive is observed. On hardware swap the row is deleted and a new one
-- inserted for the replacement device.
-- Apply with: psql -U agent -d guardian -f migrations/postgres/003_disk_health_state.sql
-- Spec: CC_DISK_HEALTH_ROLLUP.md (Phase 1: backend + dashboard, no notifications)

CREATE TABLE IF NOT EXISTS public.disk_health_state (
    server_id character varying(32) NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
    device_id text NOT NULL,                      -- kernel device name e.g. "/dev/sda", "/dev/nvme0n1"
                                                  -- (Crucible does not currently report serial;
                                                  --  device path is the fallback per spec.)
    state text NOT NULL CHECK (state IN ('healthy','declining','failing','broken')),
    signals jsonb NOT NULL,                       -- array of signal names currently matching
    model text,                                   -- drive model string, for display convenience
    first_observed_at timestamptz NOT NULL DEFAULT now(),
    entered_state_at timestamptz NOT NULL DEFAULT now(), -- when the current `state` value was first entered
    last_updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT disk_health_state_pkey PRIMARY KEY (server_id, device_id)
);

-- Fast lookup: all drives for a server (dashboard server detail page)
CREATE INDEX IF NOT EXISTS idx_disk_health_state_server
    ON public.disk_health_state (server_id);

-- Fleet-level rollup: count drives by state across all servers a customer owns.
-- Partial index keeps index small: healthy drives are the common case, we
-- usually only need to count the non-healthy tiers.
CREATE INDEX IF NOT EXISTS idx_disk_health_state_nonhealthy
    ON public.disk_health_state (server_id, state)
    WHERE state != 'healthy';
