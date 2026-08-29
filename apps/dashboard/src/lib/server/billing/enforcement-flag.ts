// Feature flag for the billing-enforcement workstream (Phase 7 P1).
//
// `BILLING_ENFORCEMENT_ENABLED=true` activates the production behaviour:
//   - periodic cron actually suspends servers (instead of logging "would
//     suspend X for customer Y")
//   - `payment_method.detached` and the cron's "T-3" / "T-1" / "disabled"
//     emails actually send (instead of logging the intent)
//   - alert dispatcher suppresses notifications on suspended servers
//   - `POST /api/v1/servers/:id/restore` accepts requests (instead of
//     returning 503)
//
// With the flag off (default), every code path falls through to the
// pre-flag behaviour, with one addition: enforcement code that WOULD
// have acted logs a `[billing-enforcement] would-...` line to journalctl.
// That's the "audit by production code" approach Simon endorsed in
// session 13: instead of a separate one-off SQL audit, the cron's
// soak-period log lines are the audit.
//
// Centralising the env-var read here keeps the cleanup PR (filed as
// Phase 7 P3 for ~30 days post-flag-flip) trivial: change one function.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Returns whether billing enforcement should take real action.
 * Read-through: re-evaluates the env var on every call so test code can
 * `process.env.BILLING_ENFORCEMENT_ENABLED = "true"` in a single test
 * without restarting the process.
 */
export function isBillingEnforcementEnabled(): boolean {
  const raw = process.env.BILLING_ENFORCEMENT_ENABLED;
  if (!raw) return false;
  return TRUTHY.has(raw.toLowerCase().trim());
}
