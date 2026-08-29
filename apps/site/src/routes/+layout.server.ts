import type { LayoutServerLoad } from "./$types";
import { verifyToken } from "@glassmkr/auth";

export const load: LayoutServerLoad = async ({ cookies }) => {
  const token = cookies.get("guardian_token");
  let loggedIn = false;

  if (token) {
    try {
      const payload = verifyToken(token);
      loggedIn = payload !== null;
    } catch {
      loggedIn = false;
    }
  }

  return { loggedIn };
};
