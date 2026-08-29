// scope: public
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { verifyCustomerEmailByToken } from "@glassmkr/auth";

export const GET: RequestHandler = async (event) => {
  try {
    const token = (event.url.searchParams.get("token") || "").trim();
    if (!token) {
      return json({ error: "Verification token is required" }, { status: 400 });
    }

    const result = await verifyCustomerEmailByToken(token);
    if (result.status === "verified") {
      return json({ ok: true, message: "Email verified.", customer: result.customer });
    }

    return json({
      error: result.status === "expired" ? "Link expired." : "Invalid link.",
    }, { status: 400 });
  } catch (err: any) {
    console.error("Verify email error:", err);
    return json({ error: "Email verification failed" }, { status: 500 });
  }
};
