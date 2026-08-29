-- 022_incident_grouping.sql
--
-- Add incident-grouping columns to active_alerts. Two new nullable
-- columns let the evaluator demote subordinate alerts to evidence-
-- only when a classifier rule is firing for the same host within
-- the correlation window:
--
--   parent_alert_id BIGINT — set when this alert is subordinate to
--     a classifier rule. References active_alerts(id). When NULL the
--     alert is a standalone alert. When non-NULL the alert is
--     attached as evidence to the parent and does not page
--     independently. Rule YAML side declares this via the
--     `subordinate_to: <rule_id>` field (RuleMetadataSchema, fix-
--     workflow/schema.ts).
--
--   incident_group_key TEXT — set when this alert participates in a
--     symmetric grouping (e.g. accept-backlog vs SYN-flood share a
--     group key on the same host, fire once consolidated). Computed
--     by the evaluator from the rule YAML's `incident_group.group_id`
--     plus the host id plus the start-time bucket (window-rounded
--     timestamp). Rules without `incident_group` set always have
--     NULL here.
--
-- Both columns are optional. Rules that don't declare grouping
-- continue to behave exactly as today. Backward-compatible.
--
-- Indexes:
--   parent_alert_id: btree on the non-NULL subset. Used by the
--     evidence-attach query (SELECT child evidence WHERE
--     parent_alert_id = $1).
--   incident_group_key: btree on the non-NULL subset. Used by the
--     classifier-emission query ("does any other rule with this
--     group key already fire on this host in the last N seconds?").
--
-- Per `RULE_AUDIT_VERDICTS_2026-05-18.md` + CC_SPEC_RULE_AUDIT_
-- IMPLEMENTATION_2026-05-18.md Phase 1.2.

BEGIN;

ALTER TABLE active_alerts
  ADD COLUMN IF NOT EXISTS parent_alert_id BIGINT,
  ADD COLUMN IF NOT EXISTS incident_group_key TEXT;

ALTER TABLE active_alerts
  ADD CONSTRAINT active_alerts_parent_fk
    FOREIGN KEY (parent_alert_id) REFERENCES active_alerts(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_active_alerts_parent
  ON active_alerts (parent_alert_id)
  WHERE parent_alert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_active_alerts_incident_group
  ON active_alerts (incident_group_key)
  WHERE incident_group_key IS NOT NULL;

COMMENT ON COLUMN active_alerts.parent_alert_id IS
  'Set when this alert is subordinate to a classifier rule (rule YAML declares subordinate_to). The alert attaches as evidence to the parent and does not page independently.';
COMMENT ON COLUMN active_alerts.incident_group_key IS
  'Set when this alert participates in a symmetric incident group (rule YAML declares incident_group). Format: <host_id>:<group_id>:<window_start_bucket>.';

INSERT INTO schema_migrations (version, name) VALUES
  (22, '022_incident_grouping')
ON CONFLICT (version) DO NOTHING;

COMMIT;
