// scope: write
// tier: free
//
// POST /api/v1/alerts/:id/resolve
//
// Manual-resolution endpoint for post-incident forensic alerts (the 5
// rules carrying `manual_resolve: true` in their YAML metadata as of
// 2026-05-27: unexpected_reboot, systemd_service_failed,
// systemd_service_oom_killed, oom_kills, mce_uncorrected — extensible
// at authoring time).
//
// Semantics (per CC_SPEC_MANUAL_RESOLVE_UI_2026-05-22.md):
//   - Authenticated, Pro-gated, write scope, ownership-checked via the
//     active_alerts -> servers join.
//   - Idempotent on already-resolved alerts: a re-resolve returns 200
//     with no DB change, so a double-click or a retried POST is safe.
//   - Forensic-only: a rule without `manual_resolve: true` whose alert
//     is still firing returns 400. Operators acknowledge auto-
//     resolvable rules and let the snapshot loop close them; only
//     forensic events (the host already looks healthy by the next
//     snapshot, no auto-clear path) get manually resolved here.
//   - `resolution_reason` (optional but recommended) is persisted on
//     the row. Convention from the 2026-05-18 dogfood loop +
//     reinforced by this spec: prefix `manual-after-investigation; `
//     so future audit queries can distinguish operator-closed
//     forensic alerts from auto-resolved (`auto_decay_*`) ones. The
//     prefix is added server-side from a clean user note; we don't
//     trust the client to format it correctly.
//
// Open to Free on all auth paths (2026-06-21 re-gating: the programmatic API
// is Free). Auth + write scope + rate limits still apply.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { writeAudit } from "$lib/server/auth/audit";
import {
  resolveAlertForCustomer,
  RESOLVE_NOTE_MAX_LEN,
} from "$lib/server/services/alert-actions";

export const POST: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "update",
      resource_type: "alert",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  // Parse + validate the optional note. We accept either no body, an
  // empty body, or { resolution_reason: "..." }. A note over the cap
  // is rejected with 400 rather than silently truncated.
  let userNote = "";
  try {
    const ct = event.request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const raw = await event.request.text();
      if (raw.trim().length > 0) {
        const body = JSON.parse(raw) as { resolution_reason?: unknown };
        if (typeof body.resolution_reason === "string") {
          userNote = body.resolution_reason.trim();
        }
      }
    }
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (userNote.length > RESOLVE_NOTE_MAX_LEN) {
    return json(
      { error: `resolution_reason exceeds ${RESOLVE_NOTE_MAX_LEN} chars` },
      { status: 400 },
    );
  }

  // Ownership check, manual_resolve gate, idempotency, and the persisted-reason
  // prefix all live in the shared service (one implementation for this route and
  // the MCP resolve tool).
  let result;
  try {
    result = await resolveAlertForCustomer(principal.customer_id, event.params.id ?? "", userNote);
  } catch (err: any) {
    console.error("Resolve error:", err.message);
    void writeAudit({
      event, principal, action: "update",
      result: "error", status_code: 500,
      resource_type: "alert", resource_id: event.params.id,
    });
    return json({ error: "Failed to resolve alert" }, { status: 500 });
  }

  if (result.status === "not_found") {
    void writeAudit({
      event, principal, action: "update",
      result: "not_found", status_code: 404,
      resource_type: "alert", resource_id: event.params.id,
    });
    return json({ error: "Alert not found" }, { status: 404 });
  }

  if (result.status === "not_manual_resolve") {
    void writeAudit({
      event, principal, action: "update",
      result: "invalid", status_code: 400,
      resource_type: "alert", resource_id: event.params.id,
      metadata: { reason: "not_manual_resolve", alert_type: result.alertType },
    });
    return json(
      {
        error:
          "This alert type auto-resolves when its underlying condition clears; use acknowledge instead of manual resolve.",
        alert_type: result.alertType,
      },
      { status: 400 },
    );
  }

  if (result.status === "already_resolved") {
    void writeAudit({
      event, principal, action: "update",
      result: "success", status_code: 200,
      resource_type: "alert", resource_id: event.params.id,
      metadata: { already_resolved: true },
    });
    return json({ success: true, already_resolved: true });
  }

  void writeAudit({
    event, principal, action: "update",
    result: "success", status_code: 200,
    resource_type: "alert", resource_id: event.params.id,
    metadata: { resolved: true, has_note: userNote.length > 0 },
  });
  return json({ success: true, alert: result.alert });
};
