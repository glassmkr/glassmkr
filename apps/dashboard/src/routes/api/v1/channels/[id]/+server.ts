// scope: write
import { json } from "@sveltejs/kit";
import { validPriorities, DEFAULT_PRIORITIES } from "$lib/alerts/priority";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { assertSafeUrl, SsrfBlockedError } from "$lib/server/net/safe-fetch";
import { canUseChannelIdentifier } from "$lib/server/channels/abuse-check";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";
import { writeAudit } from "$lib/server/auth/audit";

// tier: free
// PUT /api/v1/channels/:id — update a channel. Pro-gated for
// programmatic callers; UI sessions bypass.
export const PUT: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "update",
      resource_type: "channel",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const body = await event.request.json();
    const { name, config: channelConfig, enabled, priorities, notify_minor_update } = body;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 3;

    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    // Merge notify_minor_update into config if both are provided, or patch it into existing config
    if (channelConfig !== undefined) {
      if (notify_minor_update !== undefined) channelConfig.notify_minor_update = !!notify_minor_update;

      // Free-tier abuse prevention on config change (e.g. user swaps chat_id).
      // Look up channel_type for this row since it's not in the update body.
      const typeResult = await query(
        `SELECT channel_type FROM alert_channels WHERE id = $1 AND customer_id = $2`,
        [event.params.id, principal.customer_id]
      );
      const channelType = typeResult.rows[0]?.channel_type;

      // Accept the documented `url` alias for discord/webhook and normalise it to
      // webhook_url BEFORE the abuse + SSRF checks (P-6: create does this, so an
      // update that stored a raw `url` otherwise bypassed both and left an
      // unmasked value in the config).
      if ((channelType === "discord" || channelType === "webhook")
          && !channelConfig.webhook_url && typeof channelConfig.url === "string") {
        channelConfig.webhook_url = channelConfig.url;
      }
      if (typeof channelConfig.url === "string") delete channelConfig.url;

      if (channelType) {
        const check = await canUseChannelIdentifier(
          principal.customer_id,
          channelType,
          channelConfig,
          Number(event.params.id),
        );
        if (!check.allowed) {
          return json({ error: check.reason, code: "channel_in_use" }, { status: 409 });
        }
      }

      // G3 (launch hardening, 2026-08-24): same create-time SSRF validation
      // as POST /channels; an update must not smuggle in a destination the
      // create path would reject.
      if (typeof channelConfig.webhook_url === "string" && channelConfig.webhook_url) {
        try {
          await assertSafeUrl(channelConfig.webhook_url);
        } catch (e) {
          if (e instanceof SsrfBlockedError) {
            return json({ error: `webhook_url rejected: ${e.message}` }, { status: 400 });
          }
          throw e;
        }
      }

      sets.push(`config = $${idx++}`); vals.push(JSON.stringify(channelConfig));
    } else if (notify_minor_update !== undefined) {
      // Patch just the flag into existing config
      sets.push(`config = config || $${idx++}::jsonb`); vals.push(JSON.stringify({ notify_minor_update: !!notify_minor_update }));
    }
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(enabled); }
    if (priorities !== undefined) {
      // Tiers come from the canonical model. This list used to be P1 through P4,
      // so PUT silently dropped a P0 the caller asked for and a channel could
      // never be edited into receiving the three most serious rules.
      const prios = Array.isArray(priorities) ? validPriorities(priorities) : null;
      if (prios && prios.length === 0) {
        return json({ error: "At least one priority level must be selected" }, { status: 400 });
      }
      if (prios) { sets.push(`priorities = $${idx++}`); vals.push(prios); }
    }

    if (sets.length === 0) {
      return json({ error: "Nothing to update" }, { status: 400 });
    }

    const result = await query(
      `UPDATE alert_channels SET ${sets.join(", ")}
       WHERE id = $1 AND customer_id = $2
       RETURNING id, channel_type, name, enabled, priorities`,
      [event.params.id, principal.customer_id, ...vals]
    );

    if (result.rows.length === 0) {
      void writeAudit({
        event, principal, action: "update",
        result: "not_found", status_code: 404,
        resource_type: "channel", resource_id: event.params.id,
      });
      return json({ error: "Channel not found" }, { status: 404 });
    }

    void writeAudit({
      event, principal, action: "update",
      result: "success", status_code: 200,
      resource_type: "channel", resource_id: event.params.id,
    });
    return json({ channel: result.rows[0] });
  } catch (err: any) {
    console.error("Update channel error:", err.message);
    void writeAudit({
      event, principal, action: "update",
      result: "error", status_code: 500,
      resource_type: "channel", resource_id: event.params.id,
    });
    return json({ error: "Failed to update channel" }, { status: 500 });
  }
};

// tier: free
// DELETE /api/v1/channels/:id — delete a channel. Pro-gated for
// programmatic callers; UI sessions bypass.
export const DELETE: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "delete",
      resource_type: "channel",
      resource_id: event.params.id,
      scopeLevel: "write",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const result = await query(
      `DELETE FROM alert_channels WHERE id = $1 AND customer_id = $2 RETURNING id`,
      [event.params.id, principal.customer_id]
    );

    if (result.rows.length === 0) {
      void writeAudit({
        event, principal, action: "delete",
        result: "not_found", status_code: 404,
        resource_type: "channel", resource_id: event.params.id,
      });
      return json({ error: "Channel not found" }, { status: 404 });
    }

    void writeAudit({
      event, principal, action: "delete",
      result: "success", status_code: 200,
      resource_type: "channel", resource_id: event.params.id,
    });
    return json({ success: true });
  } catch (err: any) {
    console.error("Delete channel error:", err.message);
    void writeAudit({
      event, principal, action: "delete",
      result: "error", status_code: 500,
      resource_type: "channel", resource_id: event.params.id,
    });
    return json({ error: "Failed to delete channel" }, { status: 500 });
  }
};
