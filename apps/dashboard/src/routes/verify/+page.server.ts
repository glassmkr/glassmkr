// Friendly landing for the email-verification link (M10). Consumes the token
// server-side and hands the result to the page; no client JS needed.
import type { PageServerLoad } from "./$types";
import { verifyCustomerEmailByToken } from "@glassmkr/auth";

export const load: PageServerLoad = async ({ url }) => {
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) return { status: "missing" as const };
  try {
    const result = await verifyCustomerEmailByToken(token);
    return { status: result.status }; // "verified" | "invalid" | "expired"
  } catch {
    return { status: "error" as const };
  }
};
