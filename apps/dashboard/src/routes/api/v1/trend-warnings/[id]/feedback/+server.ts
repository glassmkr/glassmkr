// scope: write
// tier: free
//
// POST/DELETE /api/v1/trend-warnings/:id/feedback
//
// Feedback on a trend warning + dismissal. Pro-gated for programmatic
// callers; sessions bypass so Free UI dismissal still works (Free
// dashboards may surface visible-but-not-actionable warnings).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";

// POST /api/v1/trend-warnings/:id/feedback
// Body: { feedback: "valuable" | "false_positive" }
export const POST: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "update",
      resource_type: "trend_warning",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  let body: { feedback?: string };
  try {
    body = await event.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = body.feedback;
  if (feedback !== "valuable" && feedback !== "false_positive" && feedback !== null) {
    return json({ error: "feedback must be 'valuable', 'false_positive', or null to clear" }, { status: 400 });
  }

  const warningId = parseInt(event.params.id, 10);
  if (!Number.isFinite(warningId)) {
    return json({ error: "Invalid warning id" }, { status: 400 });
  }

  // Verify the warning belongs to a server owned by this customer
  const ownership = await query(
    `SELECT tw.id FROM trend_warnings tw
     JOIN servers s ON s.id = tw.server_id
     WHERE tw.id = $1 AND s.customer_id = $2`,
    [warningId, principal.customer_id]
  );
  if (ownership.rows.length === 0) {
    return json({ error: "Warning not found" }, { status: 404 });
  }

  if (feedback === null) {
    // Clearing feedback also un-acknowledges the warning (returns it
    // to the Active tab). Symmetric with the set-feedback path below,
    // which acknowledges; bug fix 2026-05-20 (CC_HANDOFF user report
    // "Confirm button does nothing"): pre-fix POST set user_feedback
    // but left dismissed_at NULL so the warning kept showing in
    // Active — looked like a no-op from the operator's view.
    // bola-exempt: warningId verified by the ownership query above
    // (JOIN servers ON s.customer_id = $2).
    await query(
      `UPDATE trend_warnings
       SET user_feedback = NULL, user_feedback_at = NULL,
           dismissed_at = NULL, dismissed_by_user_id = NULL
       WHERE id = $1`,
      [warningId]
    );
  } else {
    // Setting feedback also acknowledges the warning (moves it from
    // Active to Acknowledged). Mirrors the alerts ack pattern; both
    // "Confirm" (feedback=valuable) and "Acknowledge" (feedback=
    // false_positive) call this endpoint, the only difference is
    // which feedback value is recorded for track-record analytics.
    // bola-exempt: same; warningId verified above.
    // dismissed_by_user_id stays NULL (matches the existing DELETE
    // handler's behaviour; the Principal type doesn't carry user_id).
    await query(
      `UPDATE trend_warnings
       SET user_feedback = $1,
           user_feedback_at = now(),
           dismissed_at = COALESCE(dismissed_at, now())
       WHERE id = $2`,
      [feedback, warningId]
    );
  }

  return json({ ok: true });
};

// DELETE /api/v1/trend-warnings/:id/feedback  (dismiss warning entirely)
export const DELETE: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "delete",
      resource_type: "trend_warning",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  const warningId = parseInt(event.params.id, 10);
  if (!Number.isFinite(warningId)) {
    return json({ error: "Invalid warning id" }, { status: 400 });
  }

  const ownership = await query(
    `SELECT tw.id FROM trend_warnings tw
     JOIN servers s ON s.id = tw.server_id
     WHERE tw.id = $1 AND s.customer_id = $2`,
    [warningId, principal.customer_id]
  );
  if (ownership.rows.length === 0) {
    return json({ error: "Warning not found" }, { status: 404 });
  }

  // bola-exempt: warningId verified by the ownership query above
  // (JOIN servers ON s.customer_id = $2).
  await query(
    `UPDATE trend_warnings
     SET dismissed_at = now(), dismissed_by_user_id = NULL
     WHERE id = $1`,
    [warningId]
  );
  return json({ ok: true });
};
