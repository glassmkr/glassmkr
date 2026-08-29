import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { isMcpOAuthEnabled, isMcpReadEnabled } from "$lib/server/oauth/constants.js";
import { listDeletedServersForCustomer } from "$lib/server/services/server-admin-actions.js";
import { SELF_HOSTED } from "$lib/server/self-hosted.js";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.customer) throw redirect(302, "/login");
  // Only surface the MCP connections entry when the feature is enabled for this
  // deployment, so the card is not advertised while the /mcp endpoint 404s
  // (the read/OAuth surface is a flag-gated rollout).
  return {
    mcpEnabled: isMcpOAuthEnabled() && isMcpReadEnabled(),
    // A self-hosted deployment has no plans, no prices and no Stripe. Rendering
    // a billing card there advertises a paid tier that does not exist in the
    // build the operator is running, which is the same class of untruth as the
    // marketing copy that promised features the code did not have.
    selfHosted: SELF_HOSTED,
    // Soft-deleted servers (trash), so a delete_server done over MCP is restorable
    // from the dashboard. Empty for accounts that have never soft-deleted.
    deletedServers: await listDeletedServersForCustomer(locals.customer.id),
  };
};
