import type { LayoutServerLoad } from "./$types";

// LB-3 (2026-09-01): the auth cookie (guardian_token) is now HOST-ONLY on
// app.glassmkr.com and is not readable here, so the marketing nav cannot (and
// must not) hold the session JWT. Logged-in state comes from a separate,
// non-sensitive presence flag set alongside the credential and cleared on
// logout. It carries no token, so there is nothing to verify and no JWT_SECRET
// dependency on the marketing origin.
export const load: LayoutServerLoad = async ({ cookies }) => {
  const loggedIn = cookies.get("gmk_signed_in") === "1";
  return { loggedIn };
};
