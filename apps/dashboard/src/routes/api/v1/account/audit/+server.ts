// scope: read
// GET /api/v1/account/audit
//
// Customer-facing view of the api_audit_log. Filterable by key_id,
// resource_type, resource_id, action, result. Paginated by ts cursor.
//
// Query window: last 365 days for every account (P0-03 resolution,
// 2026-08-29: hosted has no paid tier, so the old 30-day Free window is
// retired with it). The PG retention itself
// is 90 days (then partition-drop or stream-export); the customer-facing
// upper bound is independent of that.
//
// Auth: session, acct_key. The audit log is not a
// sensitive credential surface — it lists what already happened, never
// secrets.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireAuth } from "$lib/server/auth/require";
import { requireProTier, requireScopeLevel } from "$lib/server/auth/plan";
import { writeAudit } from "$lib/server/auth/audit";
import {
  checkRateLimits,
  enforceIpRateLimit,
  rateLimitedResponse,
} from "$lib/server/auth/rate-limit-middleware";
import {
  TIER_PER_KEY,
  TIER_PER_ACCOUNT,
} from "$lib/server/auth/rate-limit";
import type { Principal } from "$lib/server/auth/principal";

const ALLOWED_RESOURCE_TYPES = new Set(["server", "api_key"]);
const ALLOWED_ACTIONS = new Set([
  "create", "list", "read", "update", "delete", "rotate", "revoke",
  "auth_failed", "verify_password",
]);
const ALLOWED_RESULTS = new Set([
  "success", "auth_failed", "forbidden", "not_found",
  "rate_limited", "invalid", "error",
]);

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function decodeTsCursor(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 36);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function encodeTsCursor(tsMs: number): string {
  return tsMs.toString(36);
}

function parseIsoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export const GET: RequestHandler = async (event) => {
  const ipFail = await enforceIpRateLimit(event);
  if (ipFail) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "audit_log",
      metadata: { tier: ipFail.failure.tier },
    });
    return rateLimitedResponse(ipFail.failure);
  }

  let principal: Principal;
  try {
    principal = await requireAuth(event, {
      allow: ["session", "acct_key"],
    });
  } catch (err) {
    void writeAudit({
      event,
      principal: null,
      action: "list",
      result: "auth_failed",
      status_code: 401,
      resource_type: "audit_log",
    });
    throw err;
  }

  const rl = await checkRateLimits({
    event,
    principal,
    tiers: [TIER_PER_KEY, TIER_PER_ACCOUNT],
  });
  if (!rl.allowed) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "rate_limited",
      status_code: 429,
      resource_type: "audit_log",
      metadata: { tier: rl.tier },
    });
    return rateLimitedResponse(rl);
  }

  // requireProTier is a pass-through since the P0-03 resolution (the audit
  // log is free on every account); the call and its audit-on-failure wrapper
  // stay so a future re-gating decision has one obvious seam, and because the
  // registry, not this file, owns that decision.
  try {
    requireProTier(principal);
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 402,
      resource_type: "audit_log",
      metadata: { reason: "pro_required" },
    });
    throw err;
  }

  // Phase 4 hierarchical scope: audit log read is `admin` only. Audit
  // entries can echo request metadata, so a write/read key shouldn't
  // be able to read the trail of an admin-key's actions.
  try {
    requireScopeLevel(principal, "admin");
  } catch (err: any) {
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "forbidden",
      status_code: 403,
      resource_type: "audit_log",
      metadata: { reason: "insufficient_scope" },
    });
    throw err;
  }

  try {
    const url = event.url;
    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
    const cursorMs = decodeTsCursor(url.searchParams.get("cursor"));

    // Optional filters. Validate against allowlists so a malformed
    // value can't change the SQL shape.
    const filterKeyId = url.searchParams.get("key_id");
    const filterResourceType = url.searchParams.get("resource_type");
    const filterResourceId = url.searchParams.get("resource_id");
    const filterAction = url.searchParams.get("action");
    const filterResult = url.searchParams.get("result");
    // Phase 4 UI filters. Both optional; both must be valid ISO-8601.
    const filterSince = parseIsoDate(url.searchParams.get("since"));
    const filterUntil = parseIsoDate(url.searchParams.get("until"));

    const params: unknown[] = [principal.customer_id];
    let where = "customer_id = $1";

    // One window for every account. This used to branch on plan, which was
    // harmless while Free was 402-blocked upstream; the moment that gate
    // became a pass-through, the branch would have quietly served Free
    // accounts a 30-day view of a log the docs describe as append-only. A
    // dormant plan branch is a gate waiting to resurface.
    const retentionDays = 365;
    const retentionFloor = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // The effective lower bound is the later of the retention window
    // floor and the explicit `since` filter. Upper bound is `until`
    // when supplied. Cursor pagination sits on top of these.
    const effectiveSince = filterSince && filterSince > retentionFloor
      ? filterSince
      : retentionFloor;
    params.push(effectiveSince);
    where += ` AND ts >= $${params.length}`;

    if (filterUntil) {
      params.push(filterUntil);
      where += ` AND ts <= $${params.length}`;
    }

    if (cursorMs !== null) {
      params.push(new Date(cursorMs));
      where += ` AND ts < $${params.length}`;
    }
    if (filterKeyId && /^[0-9a-f-]{8,}$/i.test(filterKeyId)) {
      params.push(filterKeyId);
      where += ` AND key_id = $${params.length}`;
    }
    if (filterResourceType && ALLOWED_RESOURCE_TYPES.has(filterResourceType)) {
      params.push(filterResourceType);
      where += ` AND resource_type = $${params.length}`;
    }
    if (filterResourceId && /^[a-z]+_[0-9a-f]+$/i.test(filterResourceId)) {
      params.push(filterResourceId);
      where += ` AND resource_id = $${params.length}`;
    }
    if (filterAction && ALLOWED_ACTIONS.has(filterAction)) {
      params.push(filterAction);
      where += ` AND action = $${params.length}`;
    }
    if (filterResult && ALLOWED_RESULTS.has(filterResult)) {
      params.push(filterResult);
      where += ` AND result = $${params.length}`;
    }

    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    const result = await query(
      `SELECT id, ts, key_id, source_ip, user_agent, method, path,
              resource_type, resource_id, action, result, status_code,
              request_id, metadata
         FROM api_audit_log
        WHERE ${where}
        ORDER BY ts DESC
        LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor =
      hasMore && rows.length > 0
        ? encodeTsCursor(new Date(rows[rows.length - 1].ts).getTime())
        : null;

    void writeAudit({
      event,
      principal,
      action: "list",
      result: "success",
      status_code: 200,
      resource_type: "audit_log",
      metadata: { count: rows.length, has_more: hasMore },
    });

    return json({
      entries: rows.map((r: any) => ({
        id: r.id,
        ts: r.ts,
        key_id: r.key_id,
        source_ip: r.source_ip,
        user_agent: r.user_agent,
        method: r.method,
        path: r.path,
        resource_type: r.resource_type,
        resource_id: r.resource_id,
        action: r.action,
        result: r.result,
        status_code: r.status_code,
        request_id: r.request_id,
        metadata: r.metadata,
      })),
      next_cursor: nextCursor,
      retention_window_days: retentionDays,
    });
  } catch (err: any) {
    console.error("Audit log read error:", err.message);
    void writeAudit({
      event,
      principal,
      action: "list",
      result: "error",
      status_code: 500,
      resource_type: "audit_log",
      metadata: { error: String(err.message ?? err).slice(0, 200) },
    });
    return json({ error: "Failed to read audit log" }, { status: 500 });
  }
};
