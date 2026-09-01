// LB-3 (Grok + Codex security review, 2026-09-01). Full contract of the
// cookie-auth Origin guard: the attack cases it must REJECT come first.

import { describe, it, expect } from "vitest";
import { isCsrfViolation, isFormContentType, CSRF_EXEMPT_PATHS } from "../csrf";

const SITE = "https://app.glassmkr.com";
const base = {
  method: "POST",
  pathname: "/api/v1/servers",
  hasSessionCookie: true,
  contentType: "application/json",
  origin: SITE,
  siteOrigin: SITE,
};

describe("isCsrfViolation - rejects the attacks", () => {
  it("rejects a cookie-auth JSON mutation from a SIBLING origin (the Blob bypass)", () => {
    // The old form-only check missed this: application/json sent as a Blob with
    // an empty media type is CORS-simple and carries the shared session cookie.
    expect(isCsrfViolation({ ...base, origin: "https://glassmkr.com" })).toBe(true);
  });

  it("rejects a cookie-auth mutation with a MISSING Origin (fail closed)", () => {
    expect(isCsrfViolation({ ...base, origin: null })).toBe(true);
  });

  it("rejects a cookie-auth form post from a foreign origin", () => {
    expect(
      isCsrfViolation({
        ...base,
        contentType: "application/x-www-form-urlencoded",
        origin: "https://evil.example",
      }),
    ).toBe(true);
  });

  it("still enforces when the session cookie is present (a Bearer must not weaken it)", () => {
    // hasSessionCookie stays true regardless of any Authorization header; the
    // auth handle resolves the cookie first, so the cookie session's protection
    // must hold.
    expect(isCsrfViolation({ ...base, origin: "https://evil.example" })).toBe(true);
  });
});

describe("isCsrfViolation - allows the legitimate", () => {
  it("allows a same-origin cookie-auth JSON mutation", () => {
    expect(isCsrfViolation(base)).toBe(false);
  });

  it("allows an API-key mutation (no session cookie) from any / missing origin", () => {
    expect(isCsrfViolation({ ...base, hasSessionCookie: false, origin: "https://script.example" })).toBe(false);
    expect(isCsrfViolation({ ...base, hasSessionCookie: false, origin: null })).toBe(false);
  });

  it("ignores non-mutating methods", () => {
    expect(isCsrfViolation({ ...base, method: "GET", origin: "https://evil.example" })).toBe(false);
    expect(isCsrfViolation({ ...base, method: "HEAD", origin: null })).toBe(false);
  });

  it("exempts the OAuth machine endpoints (client_id + PKCE, not cookie auth)", () => {
    for (const p of CSRF_EXEMPT_PATHS) {
      expect(isCsrfViolation({ ...base, pathname: p, origin: "https://client.example" })).toBe(false);
    }
  });
});

describe("isFormContentType", () => {
  it("recognises the browser form content types SvelteKit protects", () => {
    for (const t of [
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "text/plain",
      "application/x-sveltekit-formdata",
    ]) {
      expect(isFormContentType(t)).toBe(true);
    }
  });

  it("does not treat application/json (or absence) as a form", () => {
    expect(isFormContentType("application/json")).toBe(false);
    expect(isFormContentType(null)).toBe(false);
  });
});
