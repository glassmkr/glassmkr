// Two-step confirmation tokens for destructive MCP tools.
//
// A prepare tool issues a short-lived token; the destructive tool requires it
// back. The token is an HMAC over its binding using the OAuth pepper, so a
// client or a model cannot forge one.
//
// It is defence in depth, NOT the only gate. Destructive tools also require the
// glassmkr:admin scope, the MCP client's human tool-approval step, and the
// target's name echoed back. The token's job is narrow: prove that a prepare
// call happened for this exact thing, once, and that the thing has not changed
// since.
//
// WHAT THE SIGNATURE COVERS, AND WHY EACH FIELD IS THERE
//
//   customerId    a token issued to one account cannot act on another
//   action        a delete token cannot be spent on a key rotation
//   targetId      a token for one server cannot be spent on another
//   version       the target's state at prepare time (see resourceVersion)
//   expiresAt     five-minute window
//   nonce         makes two prepares for the same target distinguishable, which
//                 is what allows single-use to be enforced per token rather
//                 than per binding
//
// `version` closes a real hole: between prepare and commit the target could
// change and the token still verified. An operator could preview rotating a
// key, and by the time the model committed, the server could have been renamed,
// suspended, trashed, or had its key already rotated by someone else, and the
// commit would proceed against a description of the resource that was no longer
// true. The signature now covers a digest of the target's security-relevant
// state, so any of those changes invalidates the token and forces a fresh
// prepare that shows the operator what is actually there.
//
// Single-use is enforced in Postgres, not here: see consumeConfirmToken and
// migrations/postgres/042.
import { query } from "@glassmkr/db/pg";
import crypto from "node:crypto";
import { hashOAuthValueHex, timingSafeStringEqual } from "$lib/server/oauth/crypto.js";

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const DOMAIN = "mcp-confirm-token";
const JTI_DOMAIN = "mcp-confirm-token-id";
const NONCE_BYTES = 12;

/**
 * Fields whose change between prepare and commit must invalidate a token.
 *
 * The first version of this list was wrong in two ways at once, and both were
 * silent. It named `deleted_at`, which is not a column on `servers` at all
 * (soft delete sets `status = 'deleted'`), and `api_key_hash`, which rotation
 * sets to NULL because the live collector key lives in `account_api_keys`. It
 * then read them off the object returned by getServerForCustomer, a hand-built
 * projection that includes neither. Three of the four fields therefore
 * contributed nothing, and a prior key rotation did not invalidate a token,
 * which is exactly the case the version binding exists for.
 *
 * `active_key_id` is the id of the server's non-revoked collector key, which
 * changes on every rotation and discloses nothing. It is supplied by the
 * dedicated query in resource-version.ts, so the key hash never travels on a
 * server object.
 */
const VERSIONED_FIELDS = ["status", "name", "active_key_id"] as const;

/**
 * A digest of the target's state at prepare time.
 *
 * Deliberately narrow: it covers the fields that decide whether the action the
 * operator previewed is still the action they would be committing. `name` is
 * included because the confirm_name echo is checked against it; `api_key_hash`
 * because a key that already rotated makes a second rotation a different act;
 * `status` and `deleted_at` because a suspended or trashed server is not the
 * server that was previewed.
 *
 * Telemetry fields such as last_seen_at are excluded on purpose. Those change
 * every few minutes on a healthy host, and including them would expire every
 * token before an operator could finish reading the preview, which is the kind
 * of security control that gets switched off.
 *
 * Pass null for a target that does not exist yet (enroll_server). That is
 * itself a version: if a server with that name appears in the meantime, the
 * version changes away from "absent" and the token stops verifying.
 */
export function resourceVersion(row: Record<string, unknown> | null): string {
  if (!row) return "absent";
  const canonical = VERSIONED_FIELDS
    .map((f) => {
      const v = row[f];
      const s = v === null || v === undefined
        ? ""
        : v instanceof Date
          ? v.toISOString()
          : String(v);
      return `${f}=${s}`;
    })
    .join(" ");
  return hashOAuthValueHex(`${DOMAIN}-version`, canonical).slice(0, 32);
}

function sign(
  customerId: string,
  action: string,
  targetId: string,
  version: string,
  expiresAt: number,
  nonce: string,
): string {
  return hashOAuthValueHex(
    DOMAIN,
    `${customerId}|${action}|${targetId}|${version}|${expiresAt}|${nonce}`,
  );
}

/**
 * The confirm-token target for enroll_server: the FULL mutation, not the name.
 *
 * The token used to bind only (customer, action, name, "absent"), so an agent
 * could prepare "Enroll web-1", show the operator that summary, then spend the
 * same token with an arbitrary hostname and tags the operator never saw
 * (Codex 2026-08-29 #8). Binding the composite means the action tool's
 * arguments must be byte-identical to what prepare displayed, or the token
 * stops verifying. Tag ORDER is part of the binding on purpose: prepare shows
 * a list, and "the same set in a different order" is not what was approved.
 * NUL is the join character because the name schema rejects control
 * characters, so no crafted name can collide with a (name, hostname) pair.
 */
export function enrollTarget(
  name: string,
  hostname?: string | null,
  tags?: readonly string[],
): string {
  // JSON.stringify of the whole tuple: injective (arrays are ordered, strings
  // quoted and escaped), and crucially free of NUL bytes. The first version
  // joined with a NUL (\u0000) as an uncollidable separator; that value is
  // then stored in the mcp_confirm_tokens.target TEXT column, and Postgres
  // rejects NUL in text, so every enroll consume threw a caught INTERNAL_ERROR
  // while prepare (which never writes) succeeded. The in-memory test fake
  // stored NUL happily, so the suite stayed green. JSON escaping makes any
  // control char in an input a safe two-char sequence, keeping the string
  // Postgres-safe without losing injectivity.
  return JSON.stringify([name, hostname ?? "", [...(tags ?? [])]]);
}

/** The identifier recorded when a token is spent. A hash, never the token. */
export function confirmTokenId(token: string): string {
  return hashOAuthValueHex(JTI_DOMAIN, token);
}

/**
 * Issue a confirm token bound to (customerId, action, targetId, version),
 * valid for CONFIRM_TTL_MS. `nowMs` is injectable for tests.
 */
export function issueConfirmToken(
  customerId: string,
  action: string,
  targetId: string,
  version: string,
  nowMs: number = Date.now(),
): string {
  const expiresAt = nowMs + CONFIRM_TTL_MS;
  const nonce = crypto.randomBytes(NONCE_BYTES).toString("base64url");
  return `${expiresAt}.${nonce}.${sign(customerId, action, targetId, version, expiresAt, nonce)}`;
}

/**
 * Verify the signature, binding and expiry. Returns false on a tampered
 * signature, an expired token, a malformed token, or any binding mismatch,
 * including a target whose version has moved since the token was issued.
 *
 * This does NOT enforce single use. A caller that is about to act must call
 * consumeConfirmToken, which is the step a replay fails.
 */
export function verifyConfirmToken(
  token: string,
  customerId: string,
  action: string,
  targetId: string,
  version: string,
  nowMs: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expRaw, nonce, sig] = parts;
  if (!expRaw || !nonce || !sig) return false;
  const expiresAt = Number(expRaw);
  if (!Number.isInteger(expiresAt) || expiresAt < nowMs) return false;
  return timingSafeStringEqual(sig, sign(customerId, action, targetId, version, expiresAt, nonce));
}

export type ConfirmOutcome = "ok" | "invalid" | "already_used";

/** Anything that can run a parameterised statement: the pool, or a tx client. */
export type SqlExec = (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>;

/**
 * Verify a token AND spend it, atomically. Returns "ok" only for the first
 * successful use.
 *
 * The INSERT is the check. Two commits racing on one token both attempt the
 * same primary key; exactly one inserts a row and gets "ok", the other
 * conflicts and gets "already_used". There is no read-then-write window between
 * them.
 *
 * Every destructive caller must use this rather than verifyConfirmToken alone.
 */
export async function consumeConfirmTokenOn(
  exec: SqlExec,
  token: string,
  customerId: string,
  action: string,
  targetId: string,
  version: string,
  nowMs: number = Date.now(),
): Promise<ConfirmOutcome> {
  if (!verifyConfirmToken(token, customerId, action, targetId, version, nowMs)) return "invalid";
  const expiresAt = Number(token.split(".")[0]);
  const result = await exec(
    `INSERT INTO mcp_confirm_tokens (jti, customer_id, action, target, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5::bigint / 1000.0))
     ON CONFLICT (jti) DO NOTHING
     RETURNING jti`,
    [confirmTokenId(token), customerId, action, targetId.slice(0, 200), expiresAt],
  );
  if (result.rowCount === 0) return "already_used";

  // Opportunistic prune. A spent token past its expiry can no longer be
  // replayed even if the row were gone, so the row has no further purpose. The
  // table stays small enough that this never becomes the expensive part of a
  // destructive action.
  void query(
    `DELETE FROM mcp_confirm_tokens WHERE expires_at < now() - interval '1 hour'`,
    [],
  ).catch(() => {});

  return "ok";
}

/**
 * Pool-backed convenience wrapper.
 *
 * A destructive caller must NOT use this: spending the token on the pool while
 * mutating in a separate statement leaves a window in which the target can
 * change after the token was accepted. Those callers pass their transaction
 * client to consumeConfirmTokenOn so the check and the mutation commit or roll
 * back together. See confirmed-actions.ts.
 */
export async function consumeConfirmToken(
  token: string,
  customerId: string,
  action: string,
  targetId: string,
  version: string,
  nowMs: number = Date.now(),
): Promise<ConfirmOutcome> {
  return consumeConfirmTokenOn(
    (sql, params) => query(sql, params),
    token, customerId, action, targetId, version, nowMs,
  );
}
