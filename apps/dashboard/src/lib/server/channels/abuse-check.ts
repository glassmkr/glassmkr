// Prevent free-tier abuse of shared notification channels.
//
// Without this check, a single Telegram chat or email address could be used by
// N free-tier accounts, effectively monitoring 3N servers for free. The constraint:
// a channel identifier may only be bound to ONE free-tier customer at a time.
//
// Rules:
// 1. Free account cannot use an identifier that is already in use by ANOTHER
//    free account. Pro/enterprise accounts are exempt (they can share freely).
// 2. Pro accounts can always use any identifier (including ones a free account
//    already has). This does NOT retroactively break the free account.
// 3. Slack webhooks are Pro-only already, so no check is applied there. The
//    function still accepts slack for future-proofing.
//
// Do not remove. If you are tempted to remove this check, please read the
// reasoning above first.

import { query } from "@glassmkr/db/pg";

export type ChannelType = "telegram" | "email" | "slack";

export interface AbuseCheckResult {
  allowed: boolean;
  reason?: string;
}

// Pull the identifier field out of the config jsonb based on channel type.
function getIdentifier(channelType: string, config: Record<string, unknown> | null): string | null {
  if (!config) return null;
  if (channelType === "telegram") return (config.chat_id as string) || null;
  if (channelType === "email") return (config.email as string) || null;
  if (channelType === "slack") return (config.webhook_url as string) || null;
  return null;
}

export async function canUseChannelIdentifier(
  customerId: string,
  channelType: string,
  config: Record<string, unknown>,
  excludeChannelId?: number,
): Promise<AbuseCheckResult> {
  const identifier = getIdentifier(channelType, config);
  if (!identifier) return { allowed: true }; // nothing to check

  // Slack identifiers are workspace-scoped webhook URLs, which are secrets in
  // themselves: a stranger cannot aim telemetry at a workspace without holding
  // its webhook. (This comment used to say "Slack is Pro-only via pricing",
  // which stopped being true at the pivot and was never the real reason.)
  if (channelType === "slack") return { allowed: true };

  // Find OTHER customers using this identifier on the same channel type.
  // The identifier lives in a jsonb field, so we use a path-based comparison.
  const identifierKey = channelType === "telegram" ? "chat_id" : channelType === "email" ? "email" : "webhook_url";
  const sql = excludeChannelId
    ? `SELECT DISTINCT customer_id FROM alert_channels
       WHERE channel_type = $1 AND config->>$2 = $3 AND customer_id != $4 AND id != $5`
    : `SELECT DISTINCT customer_id FROM alert_channels
       WHERE channel_type = $1 AND config->>$2 = $3 AND customer_id != $4`;
  const params = excludeChannelId
    ? [channelType, identifierKey, identifier, customerId, excludeChannelId]
    : [channelType, identifierKey, identifier, customerId];
  const existing = await query(sql, params);
  if (existing.rows.length === 0) return { allowed: true };

  // Current customer plan. Pro/enterprise can share freely.
  const currentPlanResult = await query(`SELECT plan FROM customers WHERE id = $1`, [customerId]);
  const currentPlan = currentPlanResult.rows[0]?.plan;
  if (currentPlan === "pro" || currentPlan === "enterprise") return { allowed: true };

  // Check if any OTHER customer holding this identifier is also free-tier.
  const otherIds = existing.rows.map((r: { customer_id: string }) => r.customer_id);
  const conflicts = await query(
    `SELECT id FROM customers WHERE id = ANY($1::uuid[]) AND plan = 'free' LIMIT 1`,
    [otherIds]
  );
  if (conflicts.rows.length === 0) return { allowed: true }; // only Pro/enterprise hold it

  const kind = channelType === "telegram" ? "Telegram chat" : "email address";
  return {
    allowed: false,
    reason: `This ${kind} is already used by another account. Each account needs its own notification channels.`,
  };
}
