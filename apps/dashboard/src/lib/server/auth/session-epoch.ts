// Session invalidation on password reset (audit finding #11).
//
// Dashboard sessions are stateless 7-day JWTs (guardian_token) with no
// server-side revocation. A password reset stamps customers.session_epoch =
// NOW() (migration 034); any session JWT minted before that instant must stop
// being honored, so a stolen token cannot outlive the reset. The auth handle
// calls this on every request that carries a live customer.
//
// Comparison is in whole seconds: a JWT `iat` is integer seconds, while the
// epoch is a timestamptz with sub-second precision. A token minted in the SAME
// wall-clock second as the epoch (iat == floor(epoch)) was almost certainly
// minted BEFORE the epoch instant (the epoch carries sub-second fraction), so it
// must be treated as stale too, not valid (Codex round-2 #6): otherwise a token
// captured moments before a reset/logout survives its full lifetime. The only
// cost is that a fresh login within the same second as a logout is briefly
// rejected and must retry, which is negligible for a human action.
//
// Fail safe: a missing iat (older token shape) or a null epoch (no reset/logout
// has invalidated sessions, the default) returns false, leaving existing valid
// sessions untouched.
export function isSessionStale(
  iat: number | null | undefined,
  sessionEpoch: Date | null | undefined,
): boolean {
  if (iat == null || sessionEpoch == null) return false;
  return iat <= Math.floor(sessionEpoch.getTime() / 1000);
}
