-- 044_email_case_insensitive.sql
--
-- Enforce case-insensitive uniqueness of customers.email.
--
-- LB-1 (Grok + Codex security review, 2026-09-01): the OAuth callbacks looked up
-- an existing customer by the raw provider email, while password registration
-- lowercases on insert. A case-variant address (Victim@x.com vs victim@x.com)
-- could therefore create a SECOND customer row and slip past the "match an
-- existing account by email" linking guard, which is one half of the account
-- takeover path. This normalises every stored address to lower case and swaps
-- the case-sensitive UNIQUE(email) constraint for a case-insensitive unique
-- index, so all write paths and the linking guard agree on account identity.
--
-- NO-COLUMN-DELTA: constraint + index + data rewrite only. It lowercases the
-- email column and replaces UNIQUE(email) with a UNIQUE(lower(email)) index; no
-- column is added or dropped, so the migrate runner's column-inventory check
-- sees no delta and would otherwise flag this as a silent no-op.

BEGIN;

-- 1. Normalise existing addresses to lower case. This deliberately FAILS LOUD
--    (unique violation) if two rows differ only by case: pre-launch that must be
--    resolved by a human, because there is no safe automatic winner between two
--    real accounts. Re-running after normalisation is a no-op.
UPDATE customers SET email = lower(email) WHERE email <> lower(email);

-- 2. Replace the case-sensitive uniqueness with a case-insensitive one. Both the
--    old constraint drop and the new index create are guarded so the migration
--    is idempotent.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;
DROP INDEX IF EXISTS customers_email_lower_key;
CREATE UNIQUE INDEX customers_email_lower_key ON customers (lower(email));

INSERT INTO schema_migrations (version, name) VALUES
  (44, '044_email_case_insensitive')
ON CONFLICT (version) DO NOTHING;

COMMIT;
