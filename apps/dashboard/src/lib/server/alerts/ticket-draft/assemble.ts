// Deterministic, pure assembler: interleaves the server-owned fact block with
// the four prose segments into a finished plain-text ticket. Used by both the
// template and Gemma paths, so the fact block (serial, model, values) is always
// printed verbatim by the server and never sourced from the model.
//
// Output is plain text only: no markdown, and no Glassmkr branding or
// "drafted by" line, so the operator can paste it into a provider portal or
// email and send as-is. The not-sent reassurance lives only in the UI.

import type { DraftFacts, ProseSegments, TicketDraft } from "./types";

const RULE = "----------------------------------------";

export function assembleDraft(
  facts: DraftFacts,
  prose: ProseSegments,
  source: "gemma" | "template",
): TicketDraft {
  const subject = `Hardware fault on ${facts.serverName} (${facts.hardwareModel}): ${facts.faultLabel}`;

  const factBlock = [
    "Detected hardware details:",
    RULE,
    ...facts.facts.map((f) => `${f.label}: ${f.value}`),
    RULE,
  ].join("\n");

  const appendix = facts.appendixCommand
    ? `The full diagnostic report can be provided on request (command: ${facts.appendixCommand}).`
    : null;

  const body = [
    prose.opening,
    factBlock,
    prose.impact,
    prose.request,
    appendix,
    prose.closing,
  ]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join("\n\n");

  return { subject, body, source, facts: facts.facts };
}
