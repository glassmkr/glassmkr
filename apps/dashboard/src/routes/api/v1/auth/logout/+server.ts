// scope: session-only
import { redirect } from "@sveltejs/kit";
import { cookieDomain, SIGNED_IN_HINT } from "$lib/server/auth/cookie-domain";
import { DEMO_COOKIE } from "$lib/server/auth/demo-cookie";
import { query } from "@glassmkr/db/pg";
import type { RequestHandler } from "./$types";

function clearAllCookies(event: any) {
  // Host-only auth cookie (current shape, LB-3).
  event.cookies.delete("guardian_token", { path: "/" });
  // Legacy .glassmkr.com auth cookie (pre-LB-3), so an old session clears too.
  event.cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
  // The cross-site logged-in hint that the marketing site reads.
  event.cookies.delete(SIGNED_IN_HINT, { path: "/", domain: cookieDomain() });
  // And the demo cookie: logging out means end everything in this browser.
  event.cookies.delete(DEMO_COOKIE, { path: "/" });
}

// Stamp browser_session_epoch = NOW() so a guardian_token JWT captured before
// this logout stops validating (a Bearer replay is rejected by the auth handle),
// instead of surviving its stateless 7-day lifetime (P-1). This is SEPARATE from
// session_epoch, so it does NOT revoke the customer's MCP OAuth grants.
async function revokeBrowserSessions(event: any): Promise<void> {
  const id = event.locals.customer?.id;
  if (!id) return;
  // Do NOT swallow a failure (round-2 #5): if this write fails the token is
  // still valid, so logout must not report success. Let it throw - the POST
  // handler then leaves cookies in place and returns an error, so the user
  // retries instead of believing the session was revoked.
  await query("UPDATE customers SET browser_session_epoch = NOW() WHERE id = $1", [id]);
}

// POST is the real logout: it revokes and is Origin-protected by the CSRF hook,
// so a cross-site request cannot force a global logout (Codex). The dashboard's
// "Log out" control POSTs here.
export const POST: RequestHandler = async (event) => {
  await revokeBrowserSessions(event);
  clearAllCookies(event);
  throw redirect(302, "/login");
};

// GET is a link fallback. It clears THIS browser's cookies but does NOT stamp the
// epoch: a GET can be triggered cross-site (an <img>/navigation), and a forced
// GLOBAL logout across every device would be a nuisance CSRF. The credential is
// already useless to the attacker; the real revoke stays POST-only.
export const GET: RequestHandler = async (event) => {
  clearAllCookies(event);
  throw redirect(302, "/login");
};
