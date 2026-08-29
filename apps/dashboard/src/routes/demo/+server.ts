// Public demo entry. Mints a read-only session for the seeded demo tenant
// (customers.is_demo = true) and drops the visitor into the REAL dashboard,
// so the demo is the actual product with anonymized data, not a separate
// mock. Read-only is enforced by the demo guard in hooks.server.ts.
//
// GET (not a page) so there is no component to render; it always redirects.
import { redirect } from "@sveltejs/kit";
import { DEMO_COOKIE, DEMO_COOKIE_OPTIONS } from "$lib/server/auth/demo-cookie";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { generateToken } from "@glassmkr/auth";

export const GET: RequestHandler = async ({ locals, cookies }) => {
  // A real, logged-in customer keeps their own session: send them to their
  // dashboard rather than clobbering it with the demo cookie.
  if (locals.customer && !locals.customer.isDemo) {
    throw redirect(303, "/");
  }
  // Already exploring the demo: just go to the fleet.
  if (locals.customer?.isDemo) {
    throw redirect(303, "/");
  }

  // Anonymous visitor: mint a read-only session for the seeded demo tenant.
  const res = await query(
    `SELECT id, email, plan FROM customers WHERE is_demo = true ORDER BY created_at ASC LIMIT 1`,
  );
  if (res.rows.length === 0) {
    // Demo not seeded (e.g. before scripts/seed-demo.mjs runs). Fail soft
    // back to marketing rather than 500.
    throw redirect(303, "https://glassmkr.com/");
  }
  const c = res.rows[0];
  const token = generateToken({
    id: c.id,
    email: c.email,
    plan: c.plan,
    displayName: null,
    emailVerified: true,
    status: "active",
    isDemo: true,
  });
  // Its own cookie, host-only. A real session in guardian_token is untouched,
  // and the marketing site on the parent domain never sees this one.
  cookies.set(DEMO_COOKIE, token, DEMO_COOKIE_OPTIONS);
  throw redirect(303, "/");
};
