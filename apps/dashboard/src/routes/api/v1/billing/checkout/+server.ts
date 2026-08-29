// scope: admin
// tier: free
//
// RETIRED, and refusing on purpose rather than deleted. Hosted has no paid
// tier (P0-03 resolution; ground-truth.yaml hosted_pricing_state) and the
// Terms state that no new subscriptions can be created. This route was the
// remaining way IN: it still created Stripe customers and subscriptions for
// anyone who reached it, including brand-new accounts arriving through the
// register page's old ?plan=pro parameter. It now answers 410 Gone to every
// method, before touching Stripe or the database.
//
// The portal, downgrade and resume routes stay live: a residual legacy
// subscriber keeps the right to manage and cancel what they already pay for.
// Deleting this file instead would 404, and a 404 on a documented URL reads as
// an outage; 410 says the retirement is deliberate.
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const GONE = {
  error: "no_paid_tier",
  message:
    "Hosted Glassmkr has no paid tier and no new subscriptions can be created. " +
    "Hosted is free up to the node cap; self-hosting has no limits: " +
    "https://glassmkr.com/docs/self-hosting",
} as const;

export const GET: RequestHandler = async () => json(GONE, { status: 410 });
export const POST: RequestHandler = async () => json(GONE, { status: 410 });
