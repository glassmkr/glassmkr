import { describe, it, expect } from "vitest";
import { getSourceIp } from "../source-ip";

// Round-3 item 1 (2026-08-25): the XFF trust chain, proven end to end.
//
// Topology (verified against infrastructure/nginx/sites/app.glassmkr.com
// lines 27-28 and 35-36): nginx sets
//   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
// which APPENDS the real connecting peer ($remote_addr) as the RIGHTMOST
// entry of whatever chain the client sent. Every entry to the LEFT is
// attacker-controlled. getSourceIp therefore takes the rightmost entry and
// nothing else; these tests prove a client-supplied spoofed header cannot
// influence the derived IP, and therefore cannot influence any rate-limit
// bucket key derived from it (G1 register, login/reset/OAuth windows, the
// pre-auth ip tiers).

function eventWith(xff: string | null, peer = "203.0.113.7") {
  const headers = new Headers();
  if (xff !== null) headers.set("x-forwarded-for", xff);
  return {
    request: { headers },
    getClientAddress: () => peer,
  } as unknown as Parameters<typeof getSourceIp>[0];
}

describe("getSourceIp vs client-supplied X-Forwarded-For (spoofing)", () => {
  it("a spoofed single entry cannot become the derived IP once nginx appends the peer", () => {
    // Client sends "X-Forwarded-For: 6.6.6.6"; nginx appends the real peer.
    expect(getSourceIp(eventWith("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("an arbitrarily long spoofed chain still yields only the nginx-appended entry", () => {
    expect(getSourceIp(eventWith("1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("a spoofed entry equal to a victim IP cannot poison the victim's bucket key", () => {
    // Attacker (real peer 203.0.113.7) claims to be 198.51.100.9; the derived
    // key is the attacker's own address, so the victim's limiter bucket is
    // untouched.
    const derived = getSourceIp(eventWith("198.51.100.9, 203.0.113.7"));
    expect(derived).toBe("203.0.113.7");
    expect(derived).not.toBe("198.51.100.9");
  });

  it("whitespace and empty-segment games do not shift the selection", () => {
    expect(getSourceIp(eventWith("6.6.6.6 ,  203.0.113.7  "))).toBe("203.0.113.7");
  });

  it("no header at all falls back to the socket peer", () => {
    expect(getSourceIp(eventWith(null, "192.0.2.4"))).toBe("192.0.2.4");
  });
});
