-- 032_password_reset.sql
--
-- Self-service password reset for email+password accounts. This exists for the
-- accounts that cannot recover via GitHub/Google social login: company / role /
-- shared-email accounts (ops@, billing@) whose address is not a personal social
-- account, and orgs that forbid personal social logins for work tools.
--
-- Mirrors the existing email-verification token columns: a single-use,
-- short-lived opaque token is minted, and only its SHA-256 hash + expiry are
-- stored on the customer row (the raw token is never persisted, so a DB read
-- cannot be used to reset a password). NULL columns = no reset in flight
-- (default). See packages/auth/src/jwt.ts createPasswordResetToken /
-- resetPasswordByToken. No backfill.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_password_reset_token_hash
  ON customers (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

INSERT INTO schema_migrations (version, name) VALUES
  (32, '032_password_reset')
ON CONFLICT (version) DO NOTHING;

COMMIT;
