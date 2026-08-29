import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

const LAST_METHODS = ["github", "google", "password"] as const;
type LastMethod = (typeof LAST_METHODS)[number];

export const load: PageServerLoad = async ({ locals, cookies }) => {
  if (locals.customer) {
    redirect(302, "/");
  }
  const raw = cookies.get("gmk_last_login");
  const lastMethod: LastMethod | null =
    raw && (LAST_METHODS as readonly string[]).includes(raw) ? (raw as LastMethod) : null;
  return { lastMethod };
};
