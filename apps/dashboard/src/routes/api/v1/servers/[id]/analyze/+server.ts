// scope: write
// tier: free
//
// POST /api/v1/servers/:id/analyze: on-demand AI health analysis.
//
// AI analysis is one of the few Pro gates (2026-06-21 re-gating: the rest of the
// programmatic API is Free). Session callers bypass so Free customers still get
// their one-per-server free trial from the dashboard; acct_key callers must be on
// Pro, enforced explicitly below (the shared requireProTierForAcctKey gate is now
// a no-op, so AI analysis is gated here directly).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import { analyzeServerHealth, storeAnalysis, isLlmConfigured } from "$lib/server/analysis/analyzer";
import { enqueueAnalysis, getAnalysisJob, AnalysisQueueRejectedError, type JobHandle } from "$lib/server/analysis/job-queue";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { requireProTier } from "$lib/server/auth/plan";
import { SELF_HOSTED } from "$lib/server/self-hosted";
import { writeAudit } from "$lib/server/auth/audit";

export const POST: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "create",
      resource_type: "analysis",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  // AI analysis stays Pro for programmatic (acct_key) callers; sessions fall
  // through to the one-free-trial-per-server path below.
  if (principal.kind === "acct_key") requireProTier(principal);

  try {
    if (!isLlmConfigured()) {
      return json({ error: "AI analysis is not yet available" }, { status: 503 });
    }

    // Verify server ownership and get plan + free analysis state
    const serverResult = await query(
      `SELECT s.id, s.name, c.plan
       FROM servers s JOIN customers c ON s.customer_id = c.id
       WHERE s.id = $1 AND s.customer_id = $2`,
      [String(event.params.id), principal.customer_id]
    );
    if (serverResult.rows.length === 0) {
      void writeAudit({
        event, principal, action: "create",
        result: "not_found", status_code: 404,
        resource_type: "analysis", resource_id: event.params.id,
      });
      return json({ error: "Server not found" }, { status: 404 });
    }

    const server = serverResult.rows[0];
    // P0-03 resolution, 2026-08-29: hosted has no paid tier (ground-truth.yaml
    // hosted_pricing_state, and /docs/api/tier-gating has said so publicly).
    // The one-free-analysis-then-upgrade meter is retired with it. Analysis is
    // limited by whether an LLM endpoint is configured (checked above) and by
    // the per-account rate limits, which are capacity controls rather than a
    // plan. The free_analysis_used column stays in the schema; nothing writes
    // it any more.
    const isPro = server.plan === "pro"; // audit metadata only, not a gate

    // Get latest snapshot from ClickHouse
    const snapResult = await clickhouse.query({
      query: `SELECT * FROM snapshots WHERE server_id = {server_id:String} ORDER BY timestamp DESC LIMIT 2`,
      query_params: { server_id: String(event.params.id) },
      format: "JSONEachRow",
    });
    const snapshots: Record<string, unknown>[] = await snapResult.json();
    if (snapshots.length === 0) {
      return json({ error: "No health data available. Wait for the first snapshot from Crucible." }, { status: 400 });
    }

    const currentSnap = snapshots[0];
    const previousSnap = snapshots.length > 1 ? snapshots[1] : null;

    // Get active alerts. alert_type included so the model can ground each
    // finding's related_alert_type (the UI links it to the alert row, whose
    // curated FIX content is the remediation authority).
    const alertResult = await query(
      `SELECT alert_type, severity, title, message FROM active_alerts WHERE server_id = $1 AND resolved_at IS NULL`,
      [String(event.params.id)]
    );

    // Context the alert rules cannot see in one place: active trend warnings
    // (slow-burn hardware trajectory) + a 7-day fired-count summary (flapping
    // and recurrence). Both are enhancements: a fetch failure must never
    // block the analysis itself.
    let trendWarnings: Record<string, unknown>[] = [];
    try {
      const tw = await query(
        `SELECT warning_type, resource_identifier, severity, urgency_tier,
                evidence_summary, projected_timeline, first_detected_at
         FROM trend_warnings
         WHERE server_id = $1 AND resolved_at IS NULL AND dismissed_at IS NULL
         ORDER BY first_detected_at DESC
         LIMIT 10`,
        [String(event.params.id)]
      );
      trendWarnings = tw.rows;
    } catch (e: any) {
      console.warn("Analysis: trend-warning fetch failed (non-fatal):", e?.message);
    }

    let alertHistory: Record<string, unknown>[] = [];
    try {
      const ah = await clickhouse.query({
        query: `
          SELECT alert_type, countIf(event_type = 'fired') AS fired_7d, max(timestamp) AS last_event
          FROM alert_history
          WHERE server_id = {server_id:String} AND timestamp > now() - INTERVAL 7 DAY
          GROUP BY alert_type
          HAVING fired_7d > 0
          ORDER BY fired_7d DESC
          LIMIT 20
        `,
        query_params: { server_id: String(event.params.id) },
        format: "JSONEachRow",
      });
      alertHistory = await ah.json();
    } catch (e: any) {
      console.warn("Analysis: alert-history fetch failed (non-fatal):", e?.message);
    }

    // The actual work, run one-at-a-time against the single GPU by the queue.
    const serverId = String(event.params.id);
    const work = async () => {
      const analysis = await analyzeServerHealth(currentSnap, previousSnap, alertResult.rows, server.name, {
        trendWarnings,
        alertHistory,
      });
      await storeAnalysis(serverId, analysis, "manual");
      return analysis;
    };

    // Admission control: one shared GPU drains the queue one job at a time, so
    // reject a duplicate for this server and cap the customer's in-flight jobs
    // rather than let one tenant starve the others.
    let job: JobHandle<Awaited<ReturnType<typeof work>>>;
    try {
      job = enqueueAnalysis({ serverId, customerId: principal.customer_id, work });
    } catch (e) {
      if (e instanceof AnalysisQueueRejectedError) {
        void writeAudit({
          event, principal, action: "create",
          result: "rate_limited", status_code: 429,
          resource_type: "analysis", resource_id: serverId,
          metadata: { reason: e.reason },
        });
        return json({ error: e.message }, { status: 429 });
      }
      throw e;
    }

    // Programmatic (acct_key) callers keep the synchronous v1 contract: await
    // the job and return the analysis, so existing scripts do not break. They
    // still contend for the GPU through the same queue.
    if (principal.kind === "acct_key") {
      try {
        const analysis = await job.done;
        void writeAudit({
          event, principal, action: "create",
          result: "success", status_code: 200,
          resource_type: "analysis", resource_id: serverId,
          metadata: { plan: isPro ? "pro" : "free", free_used: !isPro },
        });
        return json({ analysis });
      } catch (err: any) {
        void writeAudit({
          event, principal, action: "create",
          result: "error", status_code: 500,
          resource_type: "analysis", resource_id: serverId,
        });
        return json({ error: "Analysis failed: " + err.message }, { status: 500 });
      }
    }

    // Session (dashboard) callers get the job handle to poll, so the request
    // returns immediately instead of holding a socket open through the wait.
    // Swallow the promise rejection here; the poll endpoint surfaces the error.
    job.done.catch(() => {});
    void writeAudit({
      event, principal, action: "create",
      result: "success", status_code: 202,
      resource_type: "analysis", resource_id: serverId,
      metadata: { plan: isPro ? "pro" : "free", queued: true, position: job.position },
    });
    return json(
      { job_id: job.id, status: "queued", position: job.position, estimated_seconds: job.estimatedSeconds },
      { status: 202 }
    );
  } catch (err: any) {
    console.error("Analysis error:", err.message);
    void writeAudit({
      event, principal, action: "create",
      result: "error", status_code: 500,
      resource_type: "analysis", resource_id: event.params.id,
    });
    return json({ error: "Analysis failed: " + err.message }, { status: 500 });
  }
};

// GET /api/v1/servers/:id/analyze?job_id=NNN: poll a queued analysis.
// Returns { status: queued|running|done|error, position, estimated_seconds,
// error }. The dashboard polls this after a POST; on "done" it re-fetches the
// latest analysis, on "error" it surfaces the message. Session callers bypass
// the Pro gate (a Free user polls their one trial). No audit per poll (it is
// called every few seconds).
//
// scope: read
// tier: free
export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "read",
      resource_type: "analysis",
      resource_id: event.params.id,
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  const jobId = event.url.searchParams.get("job_id");
  if (!jobId) return json({ error: "job_id is required" }, { status: 400 });

  const job = getAnalysisJob(jobId);
  // Scope the lookup to the caller's own tenant + this server: an unknown,
  // pruned, or someone else's job all read as not found.
  if (!job || job.customerId !== principal.customer_id || job.serverId !== String(event.params.id)) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  return json({
    status: job.status,
    position: job.position,
    estimated_seconds: job.estimatedSeconds,
    error: job.error,
  });
};
