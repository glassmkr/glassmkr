// P-3 (Grok + Codex security review, 2026-09-01). GET /channels used to return
// the channel config with only bot_token + webhook_url partially masked, leaking
// PagerDuty routing/integration keys, email destinations, Telegram chat ids, and
// the un-normalised `url` alias in full to any read-scoped caller. This is the
// ALLOWLISTED public view: it returns only non-secret display fields plus a
// boolean has_secret and a REDACTED destination hint, and never the raw secret.
//
// Codex also flagged that returning masked placeholders makes the settings
// editor overwrite a real secret when an unrelated field is saved. The fix on
// the write side is keep-on-omit (a secret omitted from an update is unchanged),
// so this view never has to round-trip a placeholder back as an editable value.

export interface ChannelRow {
  id: number;
  channel_type: string;
  name: string;
  enabled: boolean;
  priorities: string[];
  created_at?: unknown;
  config: Record<string, unknown> | null;
}

export interface PublicChannel {
  id: number;
  channel_type: string;
  name: string;
  enabled: boolean;
  priorities: string[];
  created_at?: unknown;
  notify_minor_update: boolean;
  has_secret: boolean;
  destination: string;
}

function redactTail(s: string, keep = 4): string {
  if (!s) return "";
  if (s.length <= keep) return "•".repeat(s.length);
  return "••••" + s.slice(-keep);
}

function redactEmail(e: string): string {
  const at = e.indexOf("@");
  if (at <= 0) return redactTail(e);
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = local.length <= 2 ? local.slice(0, 1) + "•" : local.slice(0, 2) + "•••";
  return `${shown}@${domain}`;
}

function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    const host = url.hostname;
    // IP literals (IPv6 -> hostname contains ':'; dotted IPv4) can point at
    // internal infra and carry no useful destination identity, so mask them
    // entirely (round-3 #5). The path, the other common secret location, is
    // dropped by the "/…" suffix below regardless.
    if (host.includes(":") || /^\d+(\.\d+){3}$/.test(host)) {
      return `${url.protocol}//•••/…`;
    }
    // A token is conventionally the LEADING subdomain, so mask only the leftmost
    // label when there are 3+, keeping the rest so the destination stays
    // recognisable: sekret.hooks.example -> •••.hooks.example, and
    // hooks.example.co.uk -> •••.example.co.uk (no over-redaction). A bare
    // two-label host is shown as-is: a whole domain used as a secret is
    // unsupported, and masking it would destroy the identity of ordinary hosts.
    const labels = host.split(".");
    const shown = labels.length > 2 ? ["•••", ...labels.slice(1)].join(".") : host;
    return `${url.protocol}//${shown}/…`;
  } catch {
    return "•••";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// The config keys that hold a secret / sensitive identifier, per channel type.
// Used to decide has_secret and (on the write side) which fields to preserve
// when omitted.
export function channelSecretFields(type: string): string[] {
  switch (type) {
    case "telegram":
      return ["bot_token", "chat_id"];
    case "email":
      return ["to", "email"];
    case "slack":
    case "discord":
    case "webhook":
      return ["webhook_url", "url"];
    case "pagerduty":
      return ["routing_key", "integration_key"];
    default:
      return [];
  }
}

// Map a raw channel row to the safe, allowlisted public view. NEVER returns a
// raw secret value.
export function publicChannelView(row: ChannelRow): PublicChannel {
  const cfg = row.config ?? {};
  const type = row.channel_type;
  let hasSecret = false;
  let destination = "";

  switch (type) {
    case "telegram": {
      const chat = str(cfg.chat_id);
      hasSecret = !!(chat || cfg.bot_token);
      destination = chat ? `Chat ${redactTail(chat)}` : "";
      break;
    }
    case "email": {
      const to = str(cfg.to || cfg.email);
      hasSecret = !!to;
      destination = to ? redactEmail(to) : "";
      break;
    }
    case "slack":
    case "discord":
    case "webhook": {
      const url = str(cfg.webhook_url || cfg.url);
      hasSecret = !!url;
      destination = url ? redactUrl(url) : "";
      break;
    }
    case "pagerduty": {
      const key = str(cfg.routing_key || cfg.integration_key);
      hasSecret = !!key;
      destination = key ? `Key ${redactTail(key)}` : "";
      break;
    }
    default:
      break;
  }

  return {
    id: row.id,
    channel_type: type,
    name: row.name,
    enabled: row.enabled,
    priorities: row.priorities,
    created_at: row.created_at,
    notify_minor_update: (cfg.notify_minor_update as boolean) ?? false,
    has_secret: hasSecret,
    destination,
  };
}
