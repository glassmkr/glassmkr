// Leaving the public demo.
//
// This used to be a link to /api/v1/auth/logout, which clears guardian_token on
// the parent domain. That was the only option while the demo shared the real
// session cookie, and it meant "Exit demo" was really "log out of everything",
// including a real account in the same browser.
//
// Now the demo has its own host-only cookie, so leaving it is exactly that: drop
// the demo cookie and nothing else. Whatever real session the browser holds
// survives.
import { redirect } from "@sveltejs/kit";
import { cookieDomain } from "$lib/server/auth/cookie-domain";
import { DEMO_COOKIE } from "$lib/server/auth/demo-cookie";
import type { RequestHandler } from "./$types";

// GET only: it is a link, and the demo guard blocks POST from a demo session
// anyway, so a POST here would only ever be a confusing 403.
export const GET: RequestHandler = async ({ cookies, locals }) => {
  cookies.delete(DEMO_COOKIE, { path: "/" });

  // Anyone who entered the demo BEFORE this change holds a demo token in
  // guardian_token instead, and clearing only the new cookie would leave them
  // unable to leave. Clear that one too, but strictly on the condition that the
  // session it produced is a demo session: `locals.customer.isDemo` comes from
  // the customer row, so a real account in this browser is never affected.
  if (locals.customer?.isDemo) {
    cookies.delete("guardian_token", { path: "/", domain: cookieDomain() });
    cookies.delete("guardian_token", { path: "/" });
  }

  throw redirect(303, "https://glassmkr.com/");
};
