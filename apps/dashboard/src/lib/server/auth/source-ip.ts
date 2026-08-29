import type { RequestEvent } from "@sveltejs/kit";

/**
 * The client's source IP, trusting exactly ONE reverse-proxy hop.
 *
 * SECURITY (2026-06-06): X-Forwarded-For is a comma-joined chain
 * `client, proxy1, proxy2, ...`. Every entry to the LEFT of the hop our own
 * proxy appends is fully attacker-controlled: a caller can send
 * `X-Forwarded-For: 1.2.3.4` and our nginx appends the real connecting peer
 * AFTER it. The app vhost uses
 *   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 * (infrastructure/nginx/sites/app.glassmkr.com), which APPENDS the real peer
 * as the LAST element. So the rightmost entry is the only value an external
 * client cannot forge, and it is the one we key rate-limit buckets and audit
 * rows on.
 *
 * Taking the leftmost entry (the previous behaviour) let any caller mint
 * unlimited per-IP rate-limit buckets (defeating the Stripe-webhook and
 * pre-auth brute-force limiters) and stamp audit rows with an arbitrary IP.
 *
 * ASSUMPTION: exactly one trusted proxy hop that appends the real peer last.
 * If the topology ever changes (additional trusted proxies, or nginx switched
 * to `$remote_addr`), revisit this: prefer adapter-node `ADDRESS_HEADER` +
 * `XFF_DEPTH` and `event.getClientAddress()` at that point.
 */
export function getSourceIp(event: RequestEvent): string {
  const xff = event.request.headers.get("x-forwarded-for");
  if (xff) {
    const last = xff.split(",").at(-1)?.trim();
    if (last) return last;
  }
  // SvelteKit exposes the socket peer via getClientAddress(); throws if the
  // adapter doesn't support it. Wrap defensively.
  try {
    return event.getClientAddress();
  } catch {
    return "0.0.0.0";
  }
}
