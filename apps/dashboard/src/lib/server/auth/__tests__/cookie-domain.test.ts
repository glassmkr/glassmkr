import { describe, it, expect, afterEach, vi } from "vitest";

const OLD_SH = process.env.GLASSMKR_SELF_HOSTED;
const OLD_CD = process.env.COOKIE_DOMAIN;

async function load(selfHosted: boolean, cookieDomainEnv?: string) {
  vi.resetModules();
  if (selfHosted) process.env.GLASSMKR_SELF_HOSTED = "1";
  else delete process.env.GLASSMKR_SELF_HOSTED;
  if (cookieDomainEnv === undefined) delete process.env.COOKIE_DOMAIN;
  else process.env.COOKIE_DOMAIN = cookieDomainEnv;
  return await import("../cookie-domain");
}

afterEach(() => {
  if (OLD_SH === undefined) delete process.env.GLASSMKR_SELF_HOSTED;
  else process.env.GLASSMKR_SELF_HOSTED = OLD_SH;
  if (OLD_CD === undefined) delete process.env.COOKIE_DOMAIN;
  else process.env.COOKIE_DOMAIN = OLD_CD;
});

const at = (url: string) => ({ url: new URL(url) });

describe("cookieDomain", () => {
  it("keeps the shared domain for the hosted deployment, where two hosts share a session", async () => {
    const { cookieDomain } = await load(false);
    expect(cookieDomain()).toBe(".glassmkr.com");
  });

  it("is host-only when self-hosted, or a browser drops the cookie", async () => {
    const { cookieDomain } = await load(true);
    expect(cookieDomain()).toBeUndefined();
  });

  it("honours an explicit COOKIE_DOMAIN in either mode", async () => {
    expect((await load(true, ".example.org")).cookieDomain()).toBe(".example.org");
    expect((await load(false, ".example.org")).cookieDomain()).toBe(".example.org");
  });

  it('treats "none" as an explicit request for host-only', async () => {
    expect((await load(false, "none")).cookieDomain()).toBeUndefined();
    expect((await load(false, "NONE")).cookieDomain()).toBeUndefined();
  });
});

describe("cookieSecure", () => {
  it("is always set for the hosted deployment", async () => {
    const { cookieSecure } = await load(false);
    expect(cookieSecure(at("https://app.glassmkr.com/x"))).toBe(true);
  });

  it("follows the scheme when self-hosted, so a plain-HTTP LAN install still works", async () => {
    const { cookieSecure } = await load(true);
    expect(cookieSecure(at("https://monitoring.example.org/x"))).toBe(true);
    expect(cookieSecure(at("http://10.0.0.5:3000/x"))).toBe(false);
  });
});

describe("cookieAttrs", () => {
  it("emits neither attribute for a plain-HTTP self-hosted instance", async () => {
    const { cookieAttrs } = await load(true);
    expect(cookieAttrs(at("http://10.0.0.5:3000/x"))).toBe("");
  });

  it("emits both for the hosted deployment", async () => {
    const { cookieAttrs } = await load(false);
    expect(cookieAttrs(at("https://app.glassmkr.com/x"))).toBe("; Secure; Domain=.glassmkr.com");
  });
});
