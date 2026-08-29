// The public demo's session cookie.
//
// The demo used to mint its token into `guardian_token`, the same cookie a real
// session uses, on the same `.glassmkr.com` parent domain. Two consequences,
// one of them visible to anyone who clicked "Live demo":
//
//   1. The marketing site reads that cookie to decide whether you are logged
//      in, so entering the demo changed glassmkr.com's navigation from
//      "Log in / Self-host" to "Dashboard / Log out". A visitor who never had
//      an account was told they had one, and offered a way to log out of it.
//   2. A demo session and a real session could not coexist, so "Exit demo" had
//      to clear the shared cookie. Entering the demo was guarded against
//      clobbering a live session, but the two states were still one slot.
//
// The demo now gets its own name and, deliberately, NO Domain attribute. A
// host-only cookie stays on the host that set it, so app.glassmkr.com sees it
// and glassmkr.com never does. That fixes (1) by construction rather than by
// remembering to special-case the demo in the marketing site's session read.
//
// Self-hosted builds already emit host-only cookies for everything (see
// cookie-domain.ts), so this is the same shape they were getting anyway.
export const DEMO_COOKIE = "glassmkr_demo";

export const DEMO_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60,
  path: "/",
  // No `domain`: host-only on purpose. See above.
};
