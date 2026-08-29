import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // The dashboard root is the authenticated fleet view; demo sessions
  // count as a customer. Anyone unauthenticated belongs on /login.
  if (!locals.customer) throw redirect(302, "/login");
  // Servers are fetched client-side for reactivity
  return { servers: null };
};
