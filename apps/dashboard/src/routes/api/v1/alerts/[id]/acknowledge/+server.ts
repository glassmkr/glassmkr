// scope: write
// tier: free
//
// POST /api/v1/alerts/:id/acknowledge
//
// Open to Free on all auth paths (2026-06-21 re-gating: the programmatic API
// is Free; only node count, retention, and AI analysis are Pro-gated). The
// dashboard always worked for Free; `proGated: false` now also lets Free
// account keys acknowledge. Auth + write scope + rate limits still apply.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { writeAudit } from "$lib/server/auth/audit";
import { acknowledgeAlertForCustomer } from "$lib/server/services/alert-actions";

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

  try {
    const alert = await acknowledgeAlertForCustomer(principal.customer_id, event.params.id ?? "");

    if (!alert) {
      void writeAudit({
        event, principal, action: "update",
        result: "not_found", status_code: 404,
        resource_type: "alert", resource_id: event.params.id,
      });
      return json({ error: "Alert not found" }, { status: 404 });
    }

    void writeAudit({
      event, principal, action: "update",
      result: "success", status_code: 200,
      resource_type: "alert", resource_id: event.params.id,
      metadata: { ack: true },
    });
    return json({ success: true, alert });
  } catch (err: any) {
    console.error("Acknowledge error:", err.message);
    void writeAudit({
      event, principal, action: "update",
      result: "error", status_code: 500,
      resource_type: "alert", resource_id: event.params.id,
    });
    return json({ error: "Failed to acknowledge alert" }, { status: 500 });
  }
};
