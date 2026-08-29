import type { PageServerLoad } from "./$types";
import { getServiceStates, deriveOverall } from "$lib/server/state";
import { loadIncidents } from "$lib/server/incidents";

export const load: PageServerLoad = async () => {
  const services = await getServiceStates();
  const overall = deriveOverall(services);
  const recent = loadIncidents().slice(0, 5);
  return { services, overall, recent };
};
