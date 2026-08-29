import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";

// DELETE /auth/disconnect/:provider
export const DELETE: RequestHandler = async (event) => {
  if (!event.locals.customer) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  const provider = String(event.params.provider);
  if (!["google", "github"].includes(provider)) {
    return json({ error: "Invalid provider" }, { status: 400 });
  }

  // Lockout protection
  const oauthCount = await query("SELECT COUNT(*) FROM oauth_identities WHERE customer_id = $1", [event.locals.customer.id]);
  const hasPassword = await query("SELECT password_hash IS NOT NULL AS has_password FROM customers WHERE id = $1", [event.locals.customer.id]);

  if (!hasPassword.rows[0]?.has_password && parseInt(oauthCount.rows[0].count) <= 1) {
    return json({ error: "Cannot disconnect: set a password first or connect another provider" }, { status: 400 });
  }

  await query("DELETE FROM oauth_identities WHERE customer_id = $1 AND provider = $2", [event.locals.customer.id, provider]);
  return json({ success: true });
};
