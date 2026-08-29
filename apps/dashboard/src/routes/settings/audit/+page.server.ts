import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.customer) throw redirect(302, "/login");
  return { customer: locals.customer };
};
