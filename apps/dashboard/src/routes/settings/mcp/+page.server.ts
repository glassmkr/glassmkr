import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { writeAudit } from "$lib/server/auth/audit.js";
import type { SessionPrincipal } from "$lib/server/auth/principal.js";
import {
  getMcpResourceUrl,
  isMcpOAuthEnabled,
  isMcpReadEnabled,
} from "$lib/server/oauth/constants.js";
import {
  listCustomerMcpGrants,
  revokeCustomerMcpGrant,
} from "$lib/server/oauth/store.js";

function principalFor(customer: NonNullable<App.Locals["customer"]>): SessionPrincipal {
  return {
    kind: "session",
    customer_id: customer.id,
    email: customer.email,
    plan: customer.plan,
  };
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.customer) throw redirect(302, "/login?redirect=/settings/mcp");
  const enabled = isMcpOAuthEnabled() && isMcpReadEnabled();
  return {
    enabled,
    endpoint: getMcpResourceUrl(),
    grants: enabled ? await listCustomerMcpGrants(locals.customer.id) : [],
  };
};

export const actions: Actions = {
  revoke: async (event) => {
    if (!event.locals.customer) throw redirect(302, "/login?redirect=/settings/mcp");
    const form = await event.request.formData();
    const grantId = form.get("grant_id");
    if (typeof grantId !== "string" || grantId.length < 1 || grantId.length > 128) {
      return fail(400, { revokeError: "Invalid grant." });
    }
    const principal = principalFor(event.locals.customer);
    const revoked = await revokeCustomerMcpGrant(event.locals.customer.id, grantId);
    await writeAudit({
      event,
      principal,
      action: "revoke_mcp_grant",
      result: revoked ? "success" : "not_found",
      status_code: revoked ? 200 : 404,
      resource_type: "mcp_grant",
      resource_id: grantId,
    });
    if (!revoked) return fail(404, { revokeError: "Connection not found or already revoked." });
    return { revoked: true };
  },
};
