// C-1 (Grok + Codex security review, 2026-09-01). Host-derived strings
// (hostnames, IPs, alert titles/messages/recommendations, fix commands) are
// UNTRUSTED: a compromised or malicious collector controls them. They are
// interpolated into notification sinks that parse markup, so each must be
// escaped for ITS OWN sink before interpolation, while the surrounding template
// tags stay literal. The dashboard escapes via Svelte; these are the outbound
// notification equivalents.

// Telegram parse_mode: HTML. Only & < > need escaping there; " is escaped too so
// values placed inside an attribute (e.g. href) cannot break out.
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Slack mrkdwn. Slack's documented escaping: replace &, <, > so a value cannot
// forge a <url|label> link or a <@user> mention control sequence.
export function escapeSlackMrkdwn(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Discord markdown. Embed titles/descriptions/field values render markdown,
// including masked links [text](url) and formatting. Backslash-escape the
// markup-significant characters so an untrusted value renders as literal text.
export function escapeDiscord(s: string): string {
  return String(s ?? "").replace(/([\\`*_~|>\[\]()@#-])/g, "\\$1");
}
