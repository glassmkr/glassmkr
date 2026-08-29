// scope: admin
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getCustomerById } from "@glassmkr/auth";
import { query } from "@glassmkr/db/pg";
import { sendAlert } from "$lib/server/alerts/telegram";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

export const POST: RequestHandler = async (event) => {
  // Session-only by design: no acct_key path on superadmin suspend.
  // requireScopeLevel("admin") is preventive if acct_key is ever added.
  // The hardcoded simon@glassmkr.com email check below stays as
  // defense-in-depth until a proper customers.role column lands.
  const principal = await requireAuth(event, { allow: ["session"] });
  requireScopeLevel(principal, "admin");

  try {
    const admin = await getCustomerById(principal.customer_id);
    if (!admin || admin.email !== "simon@glassmkr.com") {
      return json({ error: "Admin access required" }, { status: 403 });
    }

    const result = await query(
      `UPDATE customers SET status = 'suspended' WHERE id = $1 RETURNING id, email`,
      [event.params.customerId]
    );

    if (result.rows.length === 0) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    await sendAlert(`*Account suspended*: \`${result.rows[0].email}\``);
    return json({ ok: true, email: result.rows[0].email });
  } catch (err: any) {
    console.error("Suspend error:", err);
    return json({ error: "Failed to suspend account" }, { status: 500 });
  }
};
