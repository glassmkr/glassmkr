// Orchestrator: facts -> template prose (floor) -> optional Gemma prose -> assemble.
// Template is the default; Gemma fields override per-field only when present and
// validated. Source is "gemma" only when at least one segment came from the model.
//
// Template-only by default (decision 2026-06-16). For the closed, formulaic set
// of provider-facing hardware faults (the gated alert types), the per-type
// templates are as specific as, or better than, the model's prose: a side-by-side
// on raid_degraded showed the template kept the "failed member disk" / remote-hands
// wording the model generalized away ("the listed component", "any faulty
// components"). The durable value of this feature is the gating, the verbatim
// fact extraction, and the clean assembly, not the LLM. So we do not call Gemma:
// it adds latency and a hallucination surface for no quality gain on single-alert
// tickets. The Gemma path (gemma.ts) stays wired and tested but dormant behind
// TICKET_DRAFT_USE_GEMMA, reserved for a future multi-alert synthesis case where
// the prose genuinely has to vary per incident.

import { buildDraftFacts } from "./facts";
import { templateProse } from "./template";
import { gemmaProse, isLlmConfigured } from "./gemma";
import { assembleDraft } from "./assemble";
import type { DraftAlert, DraftServer, ProseSegments, TicketDraft } from "./types";

// Off unless explicitly enabled; read from env (not a literal) so the dormant
// Gemma path stays type-checked and the flag is a real switch, not dead code.
const USE_GEMMA = process.env.TICKET_DRAFT_USE_GEMMA === "1";

export async function buildTicketDraft(
  server: DraftServer,
  alert: DraftAlert,
  nowMs?: number,
): Promise<TicketDraft> {
  const facts = buildDraftFacts(server, alert, nowMs);
  const template = templateProse(alert.alert_type);

  let prose: ProseSegments = template;
  let source: "gemma" | "template" = "template";

  if (USE_GEMMA && isLlmConfigured()) {
    const g = await gemmaProse(facts, alert.alert_type).catch(() => null);
    if (g && (g.opening || g.impact || g.request || g.closing)) {
      prose = {
        opening: g.opening ?? template.opening,
        impact: g.impact ?? template.impact,
        request: g.request ?? template.request,
        closing: g.closing ?? template.closing,
      };
      source = "gemma";
    }
  }

  return assembleDraft(facts, prose, source);
}
