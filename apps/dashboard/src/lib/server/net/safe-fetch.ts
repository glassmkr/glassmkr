// SSRF-guarded fetch for customer-controlled URLs (security audit
// 2026-05-22 §1.7 / catalog T-310, T-304-via-SSRF).
//
// Use this for ANY outbound request whose URL comes from customer input
// (notification webhook_url, etc.) instead of bare fetch(). It:
//   - allows only http/https schemes (no file:, gopher:, data:, ...);
//   - resolves the hostname and blocks RFC1918 / loopback / link-local
//     (incl. the 169.254.169.254 cloud IMDS) / unique-local IPv6 /
//     0.0.0.0 / multicast targets;
//   - blocks internal-service ports regardless of host (ClickHouse 8123/
//     9000, PostgreSQL 5432, Redis 6379);
//   - does NOT follow redirects (redirect: "manual") -- a 3xx to an
//     internal target is the classic SSRF bypass.
//
// KNOWN RESIDUAL (DNS rebinding): there is a TOCTOU window between the
// dns.lookup() check here and the connection undici makes inside fetch().
// A hostname that resolves to a public IP now and a private IP at connect
// time could slip past. The robust fix is a custom undici dispatcher with
// a connect-time address check; deferred as a follow-up. This v1 blocks
// the realistic case (literal private IP / hostname / IMDS in webhook
// config) and is strictly better than bare fetch().

import { lookup } from "node:dns/promises";
import net from "node:net";

// ClickHouse HTTP + native, PostgreSQL, Redis. SSRF to these is the
// highest-value internal target (T-304: SSRF onto :8123 = authenticated
// SQL).
const BLOCKED_PORTS = new Set([8123, 9000, 5432, 6379]);

/** True if an IP literal is in a range we never allow outbound to. */
export function isBlockedAddress(ip: string): boolean {
  // Tolerate a bracketed IPv6 literal ([::1]) so the checks below are the
  // real gate, not an incidental DNS-resolution failure on the brackets.
  const addr = ip.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIPv4(addr)) {
    const o = addr.split(".").map(Number);
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 127) return true; // loopback
    if (o[0] === 10) return true; // RFC1918
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // RFC1918
    if (o[0] === 192 && o[1] === 168) return true; // RFC1918
    if (o[0] === 169 && o[1] === 254) return true; // link-local + IMDS
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT 100.64/10
    if (o[0] >= 224) return true; // multicast + reserved
    return false;
  }
  const lc = addr.toLowerCase();
  if (lc === "::1" || lc === "::") return true; // loopback / unspecified
  if (lc.startsWith("fe80")) return true; // link-local
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped IPv6, dotted form: ::ffff:169.254.169.254
  const dotted = lc.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return isBlockedAddress(dotted[1]);
  // IPv4-mapped IPv6, hex-compressed form: ::ffff:a9fe:a9fe is the same address
  // as ::ffff:169.254.169.254 (the IMDS). dns.lookup can return the mapped
  // address in this shape, which the dotted regex above does not catch.
  const hex = lc.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedAddress(v4);
  }
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Validate a customer-controlled URL against the SSRF policy WITHOUT
 * fetching it: scheme, blocked ports, literal-address gating, and
 * resolve-then-check on every returned address. Throws SsrfBlockedError
 * with the reason. Exported for CREATE-TIME validation of webhook
 * destinations (launch hardening G3, 2026-08-24): a bad destination is
 * rejected when the channel is saved, not discovered at first alert. The
 * send path still re-validates via safeFetch, so a DNS change after
 * creation cannot bypass the policy.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError(`scheme not allowed: ${url.protocol}`);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (BLOCKED_PORTS.has(port)) {
    throw new SsrfBlockedError(`port blocked (internal service): ${port}`);
  }
  // De-bracket an IPv6 literal host before resolving / checking. A literal IP
  // target is gated directly so a bracketed [::1] is blocked by the address
  // logic (not by an incidental DNS failure) and we never depend on the
  // resolver echoing a literal back unchanged.
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new SsrfBlockedError(`host is a blocked address: ${url.hostname}`);
  }
  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed: ${url.hostname}`);
  }
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      throw new SsrfBlockedError(`host resolves to a blocked address: ${url.hostname}`);
    }
  }
  return url;
}

/**
 * fetch() for customer-controlled URLs. Throws SsrfBlockedError if the
 * target is disallowed (caller treats that as a failed delivery, never a
 * 500). Otherwise behaves like fetch with redirect following disabled.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  await assertSafeUrl(rawUrl);
  // Force no-redirect-follow regardless of caller init (SSRF-via-3xx).
  return fetch(rawUrl, { ...init, redirect: "manual" });
}
