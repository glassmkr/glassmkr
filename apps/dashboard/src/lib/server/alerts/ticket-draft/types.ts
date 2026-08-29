// Shared types for the "Generate ticket draft" feature.
// Spec: ~/Documents/Glassmkr/CC_SPEC_GENERATE_TICKET_DRAFT_2026-06-16.md

/** One verbatim, server-owned fact line. Never model-generated. */
export interface Fact {
  label: string;
  value: string;
}

/** The server row fields the draft needs. */
export interface DraftServer {
  name: string;
  ip: string | null;
  dmi_vendor: string | null;
  dmi_product: string | null;
  os_type: string | null;
  os_version: string | null;
}

/** The active_alert row fields the draft needs. */
export interface DraftAlert {
  alert_type: string;
  severity: string;
  title: string;
  first_seen: string | Date;
  evidence: Record<string, unknown> | null;
}

/**
 * Everything the assembler prints verbatim. Facts and identity come ONLY from
 * here (structured snapshot/alert data), never from the model.
 */
export interface DraftFacts {
  serverName: string;
  hardwareModel: string;
  /** Short noun phrase for the subject line, e.g. "failing drive (SMART)". */
  faultLabel: string;
  facts: Fact[];
  /** Optional diagnostic command to offer ("full report on request"). */
  appendixCommand?: string;
}

/** The four connective-prose segments. Either template-fixed or Gemma-composed. */
export interface ProseSegments {
  opening: string;
  impact: string;
  request: string;
  closing: string;
}

/** The finished draft handed to the UI. Plain text, no markdown, no branding. */
export interface TicketDraft {
  subject: string;
  body: string;
  source: "gemma" | "template";
  facts: Fact[];
}
