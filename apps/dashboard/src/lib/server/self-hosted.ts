// Self-hosted mode: GLASSMKR_SELF_HOSTED=1 (or "true").
//
// WHY A FLAG AND NOT DELETION. Hosted and self-hosted run from this same
// codebase; the flag marks the handful of places where deployment context,
// not plan, changes behaviour. Since the P0-03 resolution (2026-08-29,
// ground-truth.yaml hosted_pricing_state) hosted has NO paid tier either:
// requireProTier passes everywhere, AI analysis is unmetered everywhere, the
// audit log is free everywhere. This header used to say hosted "keeps its
// existing plan/billing behaviour", and code kept believing it long after the
// registry and the public docs said otherwise.
//
// WHAT THE FLAG STILL DOES, exhaustively (keep this list current; it is the
// contract SELF_HOSTING.md documents):
//   1. The per-account server quota is unlimited (plan_server_limit ignored;
//      hosted keeps the free node cap below).
//   2. The billing schedulers (enforcement, email reminders) never start.
//      Hosted retains them only to serve residual legacy subscriptions.
//   3. AI analysis needs a configured LLM_API_URL rather than the hosted
//      default endpoint.
//
// WHAT IT DOES NOT DO: it does not disable auth, rate limits, audit logging, or
// scope checks. Self-hosted is ungated, not unguarded.

function readFlag(): boolean {
  const v = (process.env.GLASSMKR_SELF_HOSTED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Evaluated once at module load; the deployment mode does not change at runtime. */
export const SELF_HOSTED: boolean = readFlag();

/**
 * The hosted free-plan node cap. Must equal the `customers.plan_server_limit`
 * default set by migration 040, and the hosted_node_cap in ground-truth.yaml
 * that every public surface reads. This value only applies when a row somehow
 * carries no limit at all; the column's own default covers normal accounts. It
 * is here so that the fallback cannot silently disagree with the cap we publish,
 * which it did: this was 3 while every page said 10.
 */
export const HOSTED_FREE_NODE_CAP = 10;

/**
 * The effective server quota for an account. Hosted: the plan's limit, falling
 * back to the free cap. Self-hosted: unlimited. Callers compare
 * `count >= effectiveServerLimit(x)`, which is always false against Infinity, so
 * no call site needs its own branch.
 */
export function effectiveServerLimit(planLimit: number | undefined | null): number {
  if (SELF_HOSTED) return Number.POSITIVE_INFINITY;
  return typeof planLimit === "number" ? planLimit : HOSTED_FREE_NODE_CAP;
}

/** Test seam: recompute from the current environment (unit tests mutate env). */
export function __recomputeForTests(): boolean {
  return readFlag();
}
