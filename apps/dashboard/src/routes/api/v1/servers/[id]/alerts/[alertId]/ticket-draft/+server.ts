// scope: read
// tier: free
// Generates a draft from existing alert + snapshot data; no mutation of customer
// state. tier: free (ruling 2026-06-16): no Pro gate; an incident-time tool should
// not be paywalled, and Gemma is self-hosted with no marginal cost.
//
// POST /api/v1/servers/:id/alerts/:alertId/ticket-draft
//
// Returns a plain-text draft message to the customer's hardware provider, built
// from the alert's structured evidence (facts injected verbatim by the server)
// plus self-hosted-Gemma connective prose, with a genuinely-good template
// fallback when the LLM is unavailable. The only outbound network call is to the
// self-hosted vLLM endpoint (see ticket-draft/gemma.ts); no third party, so
// server identifiers never leave Glassmkr infra. Drafts are not persisted; one
// audit row records that a draft was generated.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import { alertIsVendorFacing } from "$lib/alerts/vendor-facing";
import { buildTicketDraft } from "$lib/server/alerts/ticket-draft/build";
import type { DraftAlert, DraftServer } from "$lib/server/alerts/ticket-draft/types";

function safeParseEvidence(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export const POST: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  const serverId = String(event.params.id);
  const alertId = String(event.params.alertId);

  // Ownership: the server must belong to the principal's customer.
  const serverRes = await query(
    `SELECT id, name, ip, dmi_vendor, dmi_product, os_type, os_version
     FROM servers WHERE id = $1 AND customer_id = $2`,
    [serverId, principal.customer_id],
  );
  if (serverRes.rows.length === 0) {
    void writeAudit({
      event, principal, action: "create", result: "not_found", status_code: 404,
      resource_type: "ticket_draft", resource_id: alertId,
    });
    return json({ error: "Server not found" }, { status: 404 });
  }
  const srow = serverRes.rows[0];

  const alertRes = await query(
    `SELECT alert_type, severity, title, first_seen, evidence, recommendation
     FROM active_alerts WHERE id = $1 AND server_id = $2 AND resolved_at IS NULL`,
    [alertId, serverId],
  );
  if (alertRes.rows.length === 0) {
    return json({ error: "Active alert not found" }, { status: 404 });
  }
  const arow = alertRes.rows[0];

  // Gate: only vendor-facing hardware faults get a provider ticket. The UI only
  // shows the button on these; this is defense in depth on the same predicate.
  if (!alertIsVendorFacing(arow.recommendation)) {
    return json(
      { error: "This alert is not a hardware fault that warrants a provider ticket." },
      { status: 422 },
    );
  }

  const server: DraftServer = {
    name: srow.name,
    ip: srow.ip ?? null,
    dmi_vendor: srow.dmi_vendor ?? null,
    dmi_product: srow.dmi_product ?? null,
    os_type: srow.os_type ?? null,
    os_version: srow.os_version ?? null,
  };
  const alert: DraftAlert = {
    alert_type: arow.alert_type,
    severity: arow.severity,
    title: arow.title,
    first_seen: arow.first_seen,
    evidence: safeParseEvidence(arow.evidence),
  };

  try {
    const draft = await buildTicketDraft(server, alert);
    void writeAudit({
      event, principal, action: "create", result: "success", status_code: 200,
      resource_type: "ticket_draft", resource_id: alertId,
      metadata: { alert_type: alert.alert_type, source: draft.source },
    });
    return json({ draft });
  } catch (err) {
    console.error("[ticket-draft] build error:", (err as Error).message);
    void writeAudit({
      event, principal, action: "create", result: "error", status_code: 500,
      resource_type: "ticket_draft", resource_id: alertId,
    });
    return json({ error: "Could not generate a draft" }, { status: 500 });
  }
};
