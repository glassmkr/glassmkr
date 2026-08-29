-- PostgreSQL schema baseline for Glassmkr Forge.
-- Captured from production guardian DB on 2026-04-13.
-- Apply with: psql -U agent -d guardian -f migrations/postgres/001_initial.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    display_name character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    status character varying(20) DEFAULT 'active'::character varying,
    email_verified boolean DEFAULT false NOT NULL,
    email_verification_token_hash character varying(64),
    email_verification_expires_at timestamp without time zone,
    plan character varying(20) DEFAULT 'free'::character varying,
    stripe_customer_id character varying(100),
    stripe_subscription_id character varying(100),
    plan_server_limit integer DEFAULT 3,
    plan_retention_days integer DEFAULT 7,
    plan_managed_alerts boolean DEFAULT false,
    plan_updated_at timestamp with time zone,
    api_token_hash character varying(128),
    token_rotated_at timestamp with time zone,
    crucible_version_notified character varying(20) DEFAULT NULL::character varying,
    tos_accepted_at timestamp without time zone,
    tos_version character varying(20),
    registration_ip character varying(45),
    CONSTRAINT customers_pkey PRIMARY KEY (id),
    CONSTRAINT customers_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.servers (
    id character varying(32) NOT NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    name character varying(100) NOT NULL,
    hostname character varying(255),
    ip character varying(45),
    os_type character varying(50),
    os_version character varying(50),
    api_key_hash character varying(128) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone,
    collector_version character varying(50),
    config_overrides jsonb DEFAULT '{}'::jsonb,
    muted_rules jsonb DEFAULT '[]'::jsonb,
    free_analysis_used boolean DEFAULT false,
    CONSTRAINT servers_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.active_alerts (
    id bigserial NOT NULL,
    server_id character varying(32) REFERENCES public.servers(id) ON DELETE CASCADE,
    alert_type character varying(100) NOT NULL,
    severity character varying(20) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    evidence jsonb,
    recommendation text,
    first_seen timestamp with time zone DEFAULT now(),
    last_seen timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    acknowledged boolean DEFAULT false,
    acknowledged_at timestamp with time zone,
    notification_sent boolean DEFAULT false,
    notification_sent_at timestamp with time zone,
    CONSTRAINT active_alerts_pkey PRIMARY KEY (id),
    CONSTRAINT active_alerts_server_id_alert_type_key UNIQUE (server_id, alert_type)
);

CREATE TABLE IF NOT EXISTS public.alert_channels (
    id serial NOT NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    channel_type character varying(20) NOT NULL,
    name character varying(100),
    config jsonb NOT NULL,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    priorities text[] DEFAULT '{P1,P2,P3,P4}'::text[],
    CONSTRAINT alert_channels_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.oauth_identities (
    id serial NOT NULL,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    provider character varying(20) NOT NULL,
    provider_user_id character varying(255) NOT NULL,
    provider_email character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT oauth_identities_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_identities_provider_provider_user_id_key UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_active_alerts_server ON public.active_alerts USING btree (server_id);
CREATE INDEX IF NOT EXISTS idx_active_alerts_unresolved ON public.active_alerts USING btree (server_id) WHERE (resolved_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_alert_channels_customer ON public.alert_channels USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_stripe ON public.customers USING btree (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider_user ON public.oauth_identities USING btree (provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_servers_api_key_hash ON public.servers USING btree (api_key_hash);
CREATE INDEX IF NOT EXISTS idx_servers_customer ON public.servers USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_servers_status ON public.servers USING btree (status);
