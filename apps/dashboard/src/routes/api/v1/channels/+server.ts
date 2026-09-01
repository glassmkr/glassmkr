// scope: read
import { json } from "@sveltejs/kit";
import { validPriorities, DEFAULT_PRIORITIES } from "$lib/alerts/priority";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { assertSafeUrl, SsrfBlockedError } from "$lib/server/net/safe-fetch";
import { canUseChannelIdentifier } from "$lib/server/channels/abuse-check";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { writeAudit } from "$lib/server/auth/audit";
import { publicChannelView } from "$lib/server/channels/channel-view";

// tier: free
// GET /api/v1/channels — read-only list of own channels. Accepts session AND
// account-key auth (read scope) via the same helper the mutations use: an
// automation can already create/update/delete/test channels with an account
// key, so it must be able to LIST them too (F3, 2026-07-16) or it cannot
// enumerate what it manages. Stays free like the other channel verbs; the
// requireProTierForAcctKey call inside the helper is a no-op post re-gate. BOLA
// constraint is principal.customer_id (both session + acct_key principals carry
// it), so a read-scoped key sees only its own customer's channels.
export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "list",
      resource_type: "channel",
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const result = await query(
      `SELECT id, channel_type, name, config, enabled, priorities, created_at
       FROM alert_channels WHERE customer_id = $1 ORDER BY created_at`,
      [principal.customer_id]
    );

    // Allowlisted public view (P-3): never return a raw secret. Only non-secret
    // display fields, a boolean has_secret, and a redacted destination hint.
    const channels = result.rows.map((c: any) => publicChannelView(c));

    void writeAudit({
      event, principal, action: "list",
      result: "success", status_code: 200,
      resource_type: "channel",
    });
    return json({ channels });
  } catch (err: any) {
    console.error("List channels error:", err.message);
    return json({ error: "Failed to list channels" }, { status: 500 });
  }
};

// tier: free
// POST /api/v1/channels — create a notification channel. Open to Free on all
// auth paths (2026-06-21 re-gating: the programmatic API is Free); per-channel
// scope + rate limits still apply.
export const POST: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "create",
      resource_type: "channel",
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const body = await event.request.json();
    const { channel_type, name, config: channelConfig, priorities, notify_minor_update } = body;
    if (!channel_type || !channelConfig) {
      return json({ error: "channel_type and config are required" }, { status: 400 });
    }
    // Store update notification preference inside config JSON
    if (notify_minor_update !== undefined) {
      channelConfig.notify_minor_update = !!notify_minor_update;
    }

    // Free-tier abuse prevention: a channel identifier (telegram chat, email)
    // cannot be shared across multiple free accounts. See abuse-check.ts.
    const abuseCheck = await canUseChannelIdentifier(principal.customer_id, channel_type, channelConfig);
    if (!abuseCheck.allowed) {
      return json({ error: abuseCheck.reason, code: "channel_in_use" }, { status: 409 });
    }
    const VALID_CHANNEL_TYPES = ["telegram", "email", "slack", "discord", "webhook", "pagerduty"];
    if (!VALID_CHANNEL_TYPES.includes(channel_type)) {
      return json({ error: `channel_type must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` }, { status: 400 });
    }
    // Per-type required config: the sender returns false without it, so reject at
    // create time for immediate feedback. (slack/telegram/email keep their
    // existing looser validation: slack's webhook_url and telegram's chat_id are
    // checked by their senders.)
    // Accept `url` as a documented alias for `webhook_url` (Grok red-team H21:
    // the OpenAPI/docs describe `url`, but the senders read `webhook_url`, so a
    // doc-following caller got a 400). Normalize before validating.
    if ((channel_type === "discord" || channel_type === "webhook")
        && !channelConfig.webhook_url && typeof channelConfig.url === "string") {
      channelConfig.webhook_url = channelConfig.url;
    }
    if ((channel_type === "discord" || channel_type === "webhook") && !channelConfig.webhook_url) {
      return json({ error: `${channel_type} requires a webhook_url (or url) in config` }, { status: 400 });
    }
    // G3 (launch hardening, 2026-08-24): validate the destination at CREATE
    // time, not at first alert. Same SSRF policy as the send path (scheme,
    // blocked ports, private/loopback/link-local/metadata ranges,
    // resolve-then-check); safeFetch re-validates at send time, so a DNS
    // change after creation cannot bypass it either.
    for (const urlField of ["webhook_url"] as const) {
      const raw = channelConfig[urlField];
      if (typeof raw === "string" && raw) {
        try {
          await assertSafeUrl(raw);
        } catch (e) {
          if (e instanceof SsrfBlockedError) {
            return json({ error: `webhook_url rejected: ${e.message}` }, { status: 400 });
          }
          throw e;
        }
      }
    }
    if (channel_type === "pagerduty" && !channelConfig.routing_key && !channelConfig.integration_key) {
      return json({ error: "pagerduty requires a routing_key in config" }, { status: 400 });
    }

    // Tiers come from the canonical model, never a literal here. This list used
    // to be P1 through P4, which silently FILTERED OUT any P0 a caller asked
    // for, so a channel created through the public API could not opt into the
    // three most serious rules in the catalogue even explicitly.
    const prios = Array.isArray(priorities) ? validPriorities(priorities) : [...DEFAULT_PRIORITIES];
    if (prios.length === 0) {
      return json({ error: "At least one priority level must be selected" }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO alert_channels (customer_id, channel_type, name, config, priorities)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, channel_type, name, enabled, priorities, created_at`,
      [principal.customer_id, channel_type, name || channel_type, JSON.stringify(channelConfig), prios]
    );

    void writeAudit({
      event, principal, action: "create",
      result: "success", status_code: 201,
      resource_type: "channel", resource_id: String(result.rows[0]?.id ?? ""),
      metadata: { channel_type },
    });
    return json({ channel: result.rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("Create channel error:", err.message);
    void writeAudit({
      event, principal, action: "create",
      result: "error", status_code: 500,
      resource_type: "channel",
    });
    return json({ error: "Failed to create channel" }, { status: 500 });
  }
};
