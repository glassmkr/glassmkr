-- Trend Warnings tables for Glassmkr Forge.
-- Apply with: psql -U agent -d guardian -f migrations/postgres/002_trend_warnings.sql
-- Spec: 07-trend-warnings-spec-v2.md

-- Stores active and historical trend warnings. One row per (server, warning_type,
-- resource_identifier) combination while unresolved. Resolved rows stay for
-- history and track-record calculations.
CREATE TABLE IF NOT EXISTS public.trend_warnings (
    id bigserial NOT NULL,
    server_id character varying(32) NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
    warning_type text NOT NULL,                   -- e.g. "smart_187_growing"
    resource_identifier text NOT NULL,            -- e.g. "drive:WD-WCC4M5YJ8X7L"
    severity text NOT NULL,                       -- 'high' or 'medium'
    urgency_tier text NOT NULL,                   -- 'imminent', 'soon', 'scheduled', 'watch'
    correlation_match text,                       -- NULL if no correlation, else rule name
    tree_ranker_score numeric,                    -- NULL for non-drive warnings or if model unavailable
    contributing_metrics jsonb NOT NULL,           -- full evidence bundle
    evidence_summary text NOT NULL,
    narration jsonb,                              -- LLM output or template fallback
    projected_timeline text,                      -- human-readable, e.g. "likely within 7-14 days"
    first_detected_at timestamptz NOT NULL DEFAULT now(),
    last_updated_at timestamptz NOT NULL DEFAULT now(),
    consecutive_batches_seen integer NOT NULL DEFAULT 1,
    notified_at timestamptz,
    acknowledged_at timestamptz,
    acknowledged_by_user_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    dismissed_at timestamptz,
    dismissed_by_user_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    user_feedback text,                           -- 'valuable' | 'false_positive' | NULL
    user_feedback_at timestamptz,
    CONSTRAINT trend_warnings_pkey PRIMARY KEY (id)
);

-- Fast lookup: active warnings for a server (dashboard tab)
CREATE INDEX IF NOT EXISTS idx_trend_warnings_server_active
    ON public.trend_warnings (server_id)
    WHERE resolved_at IS NULL;

-- Prevent duplicate active warnings for the same device + type on a server
CREATE UNIQUE INDEX IF NOT EXISTS idx_trend_warnings_unique_active
    ON public.trend_warnings (server_id, warning_type, resource_identifier)
    WHERE resolved_at IS NULL;

-- For track-record queries: count by feedback type in date ranges
CREATE INDEX IF NOT EXISTS idx_trend_warnings_feedback
    ON public.trend_warnings (user_feedback, first_detected_at)
    WHERE user_feedback IS NOT NULL;


-- Nightly snapshot for the self-audit track record display.
-- One row per day, populated by a nightly job.
CREATE TABLE IF NOT EXISTS public.trend_warning_metrics_snapshot (
    snapshot_date date NOT NULL,
    warnings_sent integer NOT NULL DEFAULT 0,
    warnings_confirmed integer NOT NULL DEFAULT 0,      -- user clicked "valuable"
    warnings_dismissed integer NOT NULL DEFAULT 0,       -- user clicked "false positive"
    warnings_pending integer NOT NULL DEFAULT 0,         -- no feedback yet
    precision_estimate numeric,                          -- confirmed / (confirmed + dismissed)
    warnings_that_preceded_alert integer NOT NULL DEFAULT 0,  -- resolved by matching alert firing
    CONSTRAINT trend_warning_metrics_snapshot_pkey PRIMARY KEY (snapshot_date)
);
