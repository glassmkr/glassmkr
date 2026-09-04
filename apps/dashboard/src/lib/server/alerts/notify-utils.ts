// Shared helpers for the alert notification dispatch path (Telegram/Slack
// dispatcher + email sender). Extracted to remove copy-pasted evidence
// parsing, fix-command resolution, command-line formatting, and priority
// sorting that had been duplicated (and could drift) between the two senders.

import { getPriority } from "$lib/alerts/presentation";
import { resolveFix } from "./fix-workflow/resolve";

/**
 * Evidence is stored either as a JSON string or an already-parsed object.
 * Returns the object form; for a non-string it passes the value through
 * unchanged, and for an unparseable string returns null. This matches the
 * inline behavior previously duplicated at each call site.
 */
function parseEvidence(raw: unknown): Record<string, any> | null | undefined {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw as Record<string, any> | null | undefined;
}

/**
 * Fix-command list for an alert. Prefers the os-correct list baked into
 * evidence.fix_commands at ingest time; falls back to the generic resolver
 * default (no OS hints) when none is present.
 */
export function getFixCommands(
  alertType: string,
  evidence: unknown,
  locator?: {
    os_id?: string | null;
    os_id_like?: string | null;
    os_version_id?: string | null;
    dmi_vendor?: string | null;
  },
): string[] {
  const ev = parseEvidence(evidence);
  // 1. Dynamic commands the evaluator baked with real device/unit/iface names win.
  if (ev?.fix_commands && Array.isArray(ev.fix_commands)) return ev.fix_commands;
  // 2. YAML library is the source of truth for everything else (resolves the
  //    same distro/vendor/condition variant the alert card shows).
  if (locator) {
    const resolved = resolveFix(alertType, ev ?? undefined, {
      os_id: locator.os_id ?? null,
      os_id_like: locator.os_id_like ?? null,
      os_version_id: locator.os_version_id ?? null,
      dmi_vendor: locator.dmi_vendor ?? null,
    });
    if (resolved?.command) return resolved.command.split("\n");
  }
  // No further fallback: every rule now carries a YAML fix_workflow.
  return [];
}

/**
 * Top N non-comment command lines, joined for compact Telegram/Slack display.
 */
export function topFixLines(commands: string[], n = 3): string {
  return commands
    .filter((c) => !c.trimStart().startsWith("#"))
    .slice(0, n)
    .join("\n");
}

/**
 * Sort alerts most-urgent-first (P0 before P3). Returns a new array; does not
 * mutate the input.
 */
export function sortByPriority<T extends { alert_type: string; severity?: string }>(
  alerts: T[],
): T[] {
  return [...alerts].sort(
    (a, b) => getPriority(a.alert_type, a.severity) - getPriority(b.alert_type, b.severity),
  );
}

/**
 * Clamp host-derived text to what a notification sink accepts (Slack header
 * 150 / section 3000, Telegram message 4096; Discord clamps inline). The JSON
 * boundary only rejects strings over 64 KiB, so a long `firewall.details` or
 * unit name reached the sink intact, Slack refused the block, and the
 * dispatcher still marked the alert notification_sent (Codex 2026-09-04 #2).
 * The cut also drops a trailing partial HTML entity so an escaped `&amp;` split
 * mid-way cannot break Telegram's HTML parse mode.
 */
export function clampForSink(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = "...";
  const cut = text.slice(0, Math.max(0, max - marker.length)).replace(/&[^&;\s]*$/, "");
  return cut + marker;
}
