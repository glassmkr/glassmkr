-- 034_session_epoch.sql
--
-- Session invalidation on password reset. Dashboard sessions are stateless
-- 7-day JWTs (guardian_token) with no server-side revocation, so a password
-- reset did NOT end existing sessions: an attacker holding a live token kept
-- access for up to the token's remaining lifetime after the owner reset their
-- password.
--
-- session_epoch is a per-customer "sessions issued before this instant are no
-- longer valid" watermark. resetPasswordByToken sets it to NOW() in the same
-- UPDATE that changes the password; the auth handle rejects any JWT whose `iat`
-- (issued-at) predates it. Nullable with NO backfill and NO default: it stays
-- NULL for every existing account until that account's next reset, so this
-- deploy invalidates nothing. See packages/auth/src/jwt.ts (resetPasswordByToken
-- / getCustomerById / verifyToken) and apps/dashboard/src/hooks.server.ts.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS session_epoch TIMESTAMPTZ;

COMMENT ON COLUMN customers.session_epoch IS
  'Sessions (JWTs) issued before this instant are rejected. Set to NOW() on password reset to revoke pre-reset tokens. NULL (default) means no reset has invalidated sessions; every pre-existing account keeps its sessions.';

INSERT INTO schema_migrations (version, name) VALUES
  (34, '034_session_epoch')
ON CONFLICT (version) DO NOTHING;

COMMIT;
