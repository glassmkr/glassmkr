// Gemma enhancement: composes ONLY the four connective-prose segments. Reuses
// the self-hosted vLLM endpoint (LLM_API_URL, OpenAI-compatible) already used by
// the analyzer; no third-party service, so server identifiers never leave
// Glassmkr infra. Falls back to null on any failure so the caller uses the
// template floor; the route never errors because the LLM misbehaved.
//
// Hallucination guard: the model is told not to restate identifiers, and every
// returned segment is rejected if it contains a long digit or hex run (a serial
// or raw value leaking into prose). Rejected segments are dropped so the caller
// keeps the template segment; facts are injected by the assembler regardless, so
// a hallucinated serial can never reach the draft.

import type { DraftFacts, ProseSegments } from "./types";

const LLM_URL = process.env.LLM_API_URL || "";
const LLM_MODEL = process.env.LLM_MODEL || "gemma-4-26b-a4b";

export function isLlmConfigured(): boolean {
  return !!LLM_URL;
}

const SYSTEM_PROMPT = `You are drafting a short, professional message from a server operator to their hardware hosting provider about a hardware fault detected by monitoring. You write ONLY the connective prose. You do NOT state serial numbers, model strings, exact sensor values, device paths, or timestamps; those are inserted separately by the system as a facts block. Refer to the affected component generically ("the drive", "the listed component", "the details below"). Be concise and courteous. Do not speculate beyond the provided facts. Do not invent part numbers, ticket numbers, or contact names. Never use em-dashes.

Respond ONLY with valid JSON in this exact shape, no markdown fences:
{ "opening": "one sentence: monitoring detected a likely hardware fault on the server identified below", "impact": "one or two sentences on why it matters if unaddressed, generic, no invented specifics", "request": "one or two sentences with the clear ask (inspect, replace, or dispatch remote-hands) fitting the fault", "closing": "one short courteous closing line" }`;

const DIGIT_RUN = /\d{5,}/;
const HEX_RUN = /\b[0-9a-fA-F]{8,}\b/;

/** True if a prose segment looks like it leaked an identifier or raw value. */
export function proseLeaksFacts(segment: string): boolean {
  return DIGIT_RUN.test(segment) || HEX_RUN.test(segment);
}

/** Parse + validate the model's JSON. Drops any field that is missing, empty,
 *  or leaks a fact. Returns the surviving fields, or null if none survive. */
export function parseProse(content: string): Partial<ProseSegments> | null {
  const cleaned = content.replace(/```json\n?|```\n?/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // A reasoning model may wrap the JSON in a reasoning trace; extract the
    // outermost { ... } substring and try again before giving up.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const out: Partial<ProseSegments> = {};
  for (const key of ["opening", "impact", "request", "closing"] as const) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0 && !proseLeaksFacts(v)) {
      out[key] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Ask Gemma for the prose segments. Returns the validated subset, or null on
 *  any failure (unconfigured, network, non-JSON, all-rejected). */
export async function gemmaProse(facts: DraftFacts, alertType: string): Promise<Partial<ProseSegments> | null> {
  if (!LLM_URL) return null;
  const factLines = facts.facts.map((f) => `${f.label}: ${f.value}`).join("\n");
  const userPrompt = `Alert type: ${alertType}\nFault: ${facts.faultLabel}\n\nFacts (context only; do NOT restate these, the system inserts them separately):\n${factLines}`;

  let res: Response;
  try {
    res = await fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        // Gemma 4 is a reasoning model: it emits a reasoning trace before the
        // JSON answer, so the token budget must cover both. 512 starved the
        // answer (the trace consumed the budget, the JSON never completed,
        // parse failed, and the route silently fell back to the template).
        // Match the analyzer's proven 4096.
        max_tokens: 4096,
        temperature: 0.3,
      }),
      // 120s like the analyzer: reasoning generation can exceed 30s.
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    console.warn("[ticket-draft] gemma fetch failed or timed out; using template");
    return null;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await res.text());
  } catch {
    console.warn("[ticket-draft] gemma returned non-JSON; using template");
    return null;
  }
  if (data.error) {
    console.warn("[ticket-draft] gemma error response; using template:", JSON.stringify(data.error).slice(0, 200));
    return null;
  }
  const choices = data.choices as Array<{ message?: { content?: string; reasoning_content?: string } }> | undefined;
  const msg = choices?.[0]?.message;
  // Gemma 4 puts the response in reasoning_content with an empty content field.
  const content = msg?.content || msg?.reasoning_content;
  if (!content) {
    console.warn("[ticket-draft] gemma empty response; using template");
    return null;
  }
  const parsed = parseProse(content);
  if (!parsed) {
    console.warn("[ticket-draft] gemma prose unparseable or all-rejected; using template");
  }
  return parsed;
}
