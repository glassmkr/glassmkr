-- 045_browser_session_epoch.sql
--
-- P-1 (Grok + Codex security review, 2026-09-01): logout must revoke the
-- guardian_token JWT, but reusing session_epoch would ALSO revoke every MCP
-- OAuth grant, because bearer.ts / tokens.ts reject a grant whose
-- session_epoch_at_issue no longer equals the customer's session_epoch. A
-- SEPARATE browser_session_epoch, consulted only for the dashboard browser
-- session (guardian_token), lets logout revoke browser sessions without
-- touching MCP grants or the password-reset revocation path (which keeps using
-- session_epoch and deliberately revokes everything).
--
-- The auth handle treats a browser JWT as stale when its iat predates EITHER
-- epoch, so this is purely additive: existing sessions with a null
-- browser_session_epoch are unaffected until the owner logs out.

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS browser_session_epoch timestamptz;

INSERT INTO schema_migrations (version, name) VALUES
  (45, '045_browser_session_epoch')
ON CONFLICT (version) DO NOTHING;

COMMIT;
