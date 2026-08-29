import type { PageServerLoad } from "./$types";
import { getLatestCrucible, FALLBACK_LATEST } from "$lib/server/version";

export const load: PageServerLoad = async () => {
  let crucibleVersion: string;
  try {
    crucibleVersion = await getLatestCrucible();
  } catch {
    crucibleVersion = FALLBACK_LATEST;
  }
  return { crucibleVersion };
};
