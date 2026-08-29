import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.customer) {
    redirect(302, "/");
  }
  return { token: url.searchParams.get("token") ?? "" };
};
