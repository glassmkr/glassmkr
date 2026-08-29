// Pure formatter for GlitchTip generic-webhook payloads.
//
// Lives in its own module (not +server.ts) because SvelteKit
// disallows arbitrary exports from route handlers — it only
// recognises GET/POST/PATCH/PUT/DELETE/OPTIONS/HEAD plus a
// short fixed list, and the build fails on anything else.
//
// Keeping the formatter pure makes it cheap to unit-test the
// shape of the Telegram message in __tests__/formatter.test.ts,
// independent of the request handler, the env var, or the
// notifyOperator() round-trip.

// GlitchTip's generic webhook follows the Slack incoming-webhook
// schema: top-level `text` plus an optional `attachments` array.
// Other fields (alias, username, channel) are present but unused
// here. Parse defensively — payload shape has shifted between
// GlitchTip minor versions.
export interface SlackLikePayload {
  text?: string;
  alias?: string;
  username?: string;
  attachments?: Array<{
    title?: string;
    title_link?: string;
    text?: string;
    color?: string;
    fields?: Array<{ title?: string; value?: string }>;
  }>;
}

export function formatTelegramMessage(payload: SlackLikePayload): string {
  const lines: string[] = [];
  lines.push("[GlitchTip] new issue");

  // First attachment is GlitchTip's standard "the actual issue"
  // payload; subsequent ones are rare. Render the first if
  // present, fall back to the top-level text otherwise.
  const att = payload.attachments?.[0];
  if (att?.title) lines.push(att.title);
  else if (payload.text) lines.push(payload.text);

  if (att?.text && att.text !== att.title) {
    // Truncate to keep Telegram messages readable. The full event
    // is one click away via title_link below.
    const snippet = att.text.length > 600
      ? att.text.slice(0, 600) + "..."
      : att.text;
    lines.push("");
    lines.push(snippet);
  }

  if (att?.fields && att.fields.length > 0) {
    lines.push("");
    for (const f of att.fields) {
      if (f.title && f.value) lines.push(`${f.title}: ${f.value}`);
    }
  }

  if (att?.title_link) {
    lines.push("");
    lines.push(att.title_link);
  }

  return lines.join("\n");
}
