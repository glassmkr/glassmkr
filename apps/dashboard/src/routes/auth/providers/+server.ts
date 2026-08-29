import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";

// GET /auth/providers - List linked OAuth providers
export const GET: RequestHandler = async (event) => {
  if (!event.locals.customer) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  const identities = await query(
    "SELECT provider, provider_email, created_at FROM oauth_identities WHERE customer_id = $1",
    [event.locals.customer.id]
  );
  const hasPassword = await query("SELECT password_hash IS NOT NULL AS has_password FROM customers WHERE id = $1", [event.locals.customer.id]);

  return json({
    providers: identities.rows,
    has_password: hasPassword.rows[0]?.has_password || false,
    google_configured: !!GOOGLE_CLIENT_ID,
    github_configured: !!GITHUB_CLIENT_ID,
  });
};
