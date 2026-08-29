// Plan-tier gate for the programmatic API surface.
//
// Closes the leak documented in RECON_2026-05-09: programmatic
// endpoints (account-key minting/rotation, server CRUD via
// gmk_acct_*, audit log read) were live without any plan check, so
// Free customers could mint working account keys and drive the API
// indefinitely. Dashboard UI gates these features visually but the
// HTTP surface had nothing.
//
// Pattern mirrors requireScope() in ./require.ts: tiny helper called
// after requireAuth() / requireRecentReAuth(), throws a structured
// 402 if the customer is not Pro. Returns void on success.
//
// Why 402 (and not 403): 402 Payment Required signals "the request
// was authenticated, but the customer's plan blocks this operation".
// Some automation tooling distinguishes 402 from 403 for retry
// semantics (don't retry on 402; ask the human to upgrade). If a
// downstream client turns out to retry-loop on 402, we'll flip to
// 403 with the same body — for now, 402 is what the spec asks for.
//
// `business` and `enterprise` plans pass the check too: they don't
// exist as SKUs yet, but accepting them now means future plan rollout
// doesn't need a code change here.

import { error } from "@sveltejs/kit";
import type { Principal } from "./principal.js";

// The 402 machinery that used to live here (PRO_PLANS, ProRequiredBody,
// PRO_REQUIRED_BODY) is deleted, not retained: after the P0-03 resolution
// nothing constructed a 402 from it, and a dormant upsell string is a gate
// waiting to resurface, exactly like the 30-day audit window branch was.
// lint:plan-language now refuses upsell copy in active source, so bringing a
// plan back means changing ground-truth.yaml first and that gate second.

/**
 * Historic 402 gate, now a pass-through. See the body comment.
 */
export function requireProTier(_principal: Principal): void {
  // Pass-through as of the 2026-08-29 P0-03 resolution. ground-truth.yaml
  // records hosted_pricing_state as RESOLVED: "free (hosted); free forever
  // (self-hosted, AGPL)", and /docs/api/tier-gating has publicly said "the
  // Free/Pro split was retired ... no paid tiers" since the pivot. This
  // function kept 402ing the audit log anyway, which meant the site promised
  // one contract while the API enforced its predecessor.
  //
  // Kept as a function, same as requireProTierForAcctKey below, so the call
  // sites keep compiling and the history stays visible. Do NOT re-add gating
  // here without changing ground-truth.yaml FIRST: the registry is the
  // decision, code follows it.
  return;
}

/**
 * Pass-through as of the 2026-06-21 re-gating: the PROGRAMMATIC API IS FREE.
 * The only Pro gates that remain are node count (enforced at servers POST),
 * data retention (ClickHouse TTL + audit window), and AI analysis (enforced
 * explicitly in the analyze route). This helper is kept as a no-op so its many
 * existing call sites keep compiling and the historical gate points stay
 * visible in the diff history. Do NOT re-add gating here: it would silently
 * re-gate every programmatic write endpoint at once. To gate a NEW capability,
 * gate it in that specific route (mirror analyze's explicit acct_key Pro check).
 */
export function requireProTierForAcctKey(_principal: Principal): void {
  return;
}

// ---------------------------------------------------------------------------
// Hierarchical 3-level scope gate (Phase 4).
//
// Phase 4 introduces a `read` / `write` / `admin` scope per account
// key, immutable per-key (rotation can change scope, but a given key
// never mutates mid-life). Stored on `account_api_keys.scope`,
// populated into `principal.scope` by `lookupAcctKey()`.
//
// Naming note: SvelteKit-side already has `requireScope(principal,
// scopeName)` in require.ts — that's the older array-based check
// (e.g. `"servers:manage"`) that ships on every legacy key. The two
// systems stack: legacy `scopes: ["servers:manage"]` is set on every
// new key for backward compat, and the new `scope` field enforces
// the hierarchical tier. To avoid collision we name the new helper
// `requireScopeLevel`.
//
// Status code: 403 (insufficient permission), distinct from 402
// (`requireProTier`, payment required). Stack order in handlers is
// auth → requireProTier → requireScopeLevel.
//
// cru_key principals are not affected — they hit the ingest endpoint
// only, which uses neither helper.
// ---------------------------------------------------------------------------

export type ScopeLevel = "read" | "write" | "admin";

const SCOPE_HIERARCHY: Record<ScopeLevel, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

export interface InsufficientScopeBody {
  error: "insufficient_scope";
  message: string;
  required_scope: ScopeLevel;
  your_scope: ScopeLevel;
}

/**
 * Throws 403 unless the principal's hierarchical scope is at least
 * the required level. Sessions pass through (UI is the authority for
 * human-driven traffic, same convention as `requireScope` in
 * require.ts). cru_key principals get 403 — they have no business
 * calling scoped endpoints.
 */
export function requireScopeLevel(
  principal: Principal,
  minimumScope: ScopeLevel,
): void {
  if (principal.kind === "session") {
    return;
  }
  if (principal.kind === "cru_key") {
    throw error(403, {
      error: "insufficient_scope",
      message: "Collector keys cannot call account-management endpoints.",
      required_scope: minimumScope,
      your_scope: "read",
    } as unknown as App.Error);
  }
  const have = SCOPE_HIERARCHY[principal.scope];
  const need = SCOPE_HIERARCHY[minimumScope];
  if (have >= need) return;
  throw error(403, {
    error: "insufficient_scope",
    message:
      `This endpoint requires '${minimumScope}' scope. ` +
      `Your key has '${principal.scope}'. ` +
      `Mint a new key with sufficient scope from /settings/keys.`,
    required_scope: minimumScope,
    your_scope: principal.scope,
  } as unknown as App.Error);
}
