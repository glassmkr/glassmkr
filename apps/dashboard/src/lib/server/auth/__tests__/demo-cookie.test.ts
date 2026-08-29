import { describe, expect, it } from "vitest";
import { DEMO_COOKIE, DEMO_COOKIE_OPTIONS } from "../demo-cookie";
import { cookieDomain } from "../cookie-domain";

// The demo session used to live in guardian_token on .glassmkr.com, which meant
// clicking "Live demo" changed the marketing site's navigation to
// "Dashboard / Log out" for someone who had never logged in. These assert the
// two properties that stop that happening, so neither can be undone quietly.
describe("the demo cookie is separate and host-only", () => {
  it("does not reuse the real session cookie's name", () => {
    expect(DEMO_COOKIE).not.toBe("guardian_token");
  });

  it("carries no Domain attribute, so it cannot reach the marketing host", () => {
    // The absence is the whole point: a cookie with no Domain is host-only, so
    // app.glassmkr.com sets it and glassmkr.com never receives it. If someone
    // adds `domain: cookieDomain()` here to "make it consistent" with the real
    // session cookie, this fails.
    expect("domain" in DEMO_COOKIE_OPTIONS).toBe(false);
    expect((DEMO_COOKIE_OPTIONS as Record<string, unknown>).domain).toBeUndefined();
  });

  it("is still hardened the same way the real session cookie is", () => {
    expect(DEMO_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(DEMO_COOKIE_OPTIONS.secure).toBe(true);
    expect(DEMO_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(DEMO_COOKIE_OPTIONS.path).toBe("/");
  });

  it("differs from the shared-domain value precisely on the hosted build", () => {
    // Guards the reasoning rather than the constant: on the hosted shape
    // cookieDomain() returns a parent domain, and the demo deliberately does
    // not use it. If cookieDomain() ever became host-only for hosted too, this
    // test would stop being meaningful, so assert the premise it rests on.
    const shared = cookieDomain();
    if (shared !== undefined) {
      expect(shared.startsWith(".")).toBe(true);
      expect((DEMO_COOKIE_OPTIONS as Record<string, unknown>).domain).not.toBe(shared);
    }
  });
});
