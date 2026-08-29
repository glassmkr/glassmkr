// scope: session-only
import { json, redirect } from "@sveltejs/kit";
import { cookieDomain } from "$lib/server/auth/cookie-domain";
import { DEMO_COOKIE } from "$lib/server/auth/demo-cookie";
import type { RequestHandler } from "./$types";

function clearAllCookies(event: any) {
  // Delete the new shared cookie (.glassmkr.com domain)
  event.cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
  // Also delete legacy cookie (no domain, scoped to app.glassmkr.com)
  event.cookies.delete("guardian_token", { path: "/" });
  // And the demo cookie. Leaving the demo has its own route that touches only
  // this one; logging out means end everything in this browser, so it goes too.
  event.cookies.delete(DEMO_COOKIE, { path: "/" });
}

export const POST: RequestHandler = async (event) => {
  clearAllCookies(event);
  return json({ ok: true });
};

export const GET: RequestHandler = async (event) => {
  clearAllCookies(event);
  throw redirect(302, "/login");
};
