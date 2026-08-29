// Where an operator should point the agent they just enrolled.
//
// This used to be the literal hosted URL, written at both enrollment call
// sites. A self-hosted dashboard therefore issued a key and then told its
// operator to send telemetry to app.glassmkr.com: someone else's instance,
// where that key does not work. The rest of the codebase already derives
// external URLs from DASHBOARD_PUBLIC_URL; these two call sites never did.
export function ingestUrl(): string {
  const base = (process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com").replace(/\/+$/, "");
  return `${base}/api/v1/ingest`;
}

// The base the OAuth providers redirect back to.
//
// Same defect shape as ingest_url above: this defaulted to the hosted host, so
// a self-hoster who configured GitHub or Google sign-in sent their users to
// app.glassmkr.com to complete a login against their own instance. OAUTH_
// CALLBACK_BASE still wins when set, so the hosted deployment is unaffected.
export function oauthCallbackBase(): string {
  const explicit = (process.env.OAUTH_CALLBACK_BASE || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return (process.env.DASHBOARD_PUBLIC_URL || "https://app.glassmkr.com").replace(/\/+$/, "");
}
