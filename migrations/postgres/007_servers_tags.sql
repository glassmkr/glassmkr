-- Add tags column to servers, used by the new POST/GET /api/v1/servers
-- introduced in PR #3 of the API keys workstream. Customer-supplied
-- string array, validated at the application layer (<=20 items, each
-- 1-50 chars).
--
-- Apply with: psql -U agent -d guardian -f migrations/postgres/007_servers_tags.sql
-- Spec:       CC_FORGE_API_KEYS_AND_SERVERS.md (Part 7, POST /api/v1/servers)
-- IMPL plan:  IMPL_NOTES_API_KEYS.md
-- PR:         #3 (servers endpoints) of the 7-PR sequence.

ALTER TABLE public.servers
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];

-- GIN index on tags so per-tag filtering (`tags && $1::text[]`) can use
-- the index on large fleets. Without it the GET /api/v1/servers?tag=
-- query falls back to a seq scan with array-overlap test on every row.
CREATE INDEX IF NOT EXISTS idx_servers_tags
    ON public.servers USING gin (tags);

COMMENT ON COLUMN public.servers.tags IS
    'Customer-supplied tags for filtering and grouping in the dashboard. Validated <=20 items, each 1-50 chars at the API layer.';
