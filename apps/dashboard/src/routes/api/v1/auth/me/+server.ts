// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getCustomerById } from "@glassmkr/auth";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  try {
    const customer = await getCustomerById(principal.customer_id);
    if (!customer) {
      return json({ error: "Customer not found" }, { status: 404 });
    }
    // Surface principal kind + scope so acct_key callers can introspect
    // their own capability (read / write / admin) without having to call
    // a separate endpoint. Session principals are UI-level and report
    // "admin" since the dashboard UI can do anything.
    const auth = principal.kind === "acct_key"
      ? { kind: "acct_key" as const, scope: principal.scope }
      : { kind: "session" as const, scope: "admin" as const };
    return json({ customer, auth });
  } catch (err: any) {
    console.error("Me error:", err);
    return json({ error: "Failed to fetch profile" }, { status: 500 });
  }
};
