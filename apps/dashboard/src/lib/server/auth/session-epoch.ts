// Session invalidation on password reset (audit finding #11).
//
// Dashboard sessions are stateless 7-day JWTs (guardian_token) with no
// server-side revocation. A password reset stamps customers.session_epoch =
// NOW() (migration 034); any session JWT minted before that instant must stop
// being honored, so a stolen token cannot outlive the reset. The auth handle
// calls this on every request that carries a live customer.
//
// Comparison is in whole seconds: a JWT `iat` is integer seconds, while
// session_epoch is a timestamptz with sub-second precision, so we floor the
// epoch before comparing. The reset instant itself (iat == floored epoch) is
// treated as still valid; only tokens strictly older are rejected.
//
// Fail safe: a missing iat (older token shape) or a null session_epoch (no
// reset has happened, the default for every account) returns false, leaving
// existing valid sessions untouched.
export function isSessionStale(
  iat: number | null | undefined,
  sessionEpoch: Date | null | undefined,
): boolean {
  if (iat == null || sessionEpoch == null) return false;
  return iat < Math.floor(sessionEpoch.getTime() / 1000);
}
