import { describe, it, expect, afterEach } from "vitest";
import { ingestUrl } from "../ingest-url";

const OLD = process.env.DASHBOARD_PUBLIC_URL;
afterEach(() => {
  if (OLD === undefined) delete process.env.DASHBOARD_PUBLIC_URL;
  else process.env.DASHBOARD_PUBLIC_URL = OLD;
});

describe("ingestUrl", () => {
  it("points at the hosted instance when nothing is configured", () => {
    delete process.env.DASHBOARD_PUBLIC_URL;
    expect(ingestUrl()).toBe("https://app.glassmkr.com/api/v1/ingest");
  });

  it("points at the operator's own dashboard when one is configured", () => {
    process.env.DASHBOARD_PUBLIC_URL = "http://10.0.0.5:3000";
    expect(ingestUrl()).toBe("http://10.0.0.5:3000/api/v1/ingest");
  });

  it("does not produce a double slash when the configured URL has a trailing one", () => {
    process.env.DASHBOARD_PUBLIC_URL = "https://monitoring.example.org/";
    expect(ingestUrl()).toBe("https://monitoring.example.org/api/v1/ingest");
  });

  it("never hands a self-hoster the hosted URL once they have configured their own", () => {
    process.env.DASHBOARD_PUBLIC_URL = "https://monitoring.example.org";
    expect(ingestUrl()).not.toContain("app.glassmkr.com");
  });
});

describe("oauthCallbackBase", () => {
  const OLD_CB = process.env.OAUTH_CALLBACK_BASE;
  afterEach(() => {
    if (OLD_CB === undefined) delete process.env.OAUTH_CALLBACK_BASE;
    else process.env.OAUTH_CALLBACK_BASE = OLD_CB;
  });

  it("follows the operator's own dashboard URL when one is configured", async () => {
    delete process.env.OAUTH_CALLBACK_BASE;
    process.env.DASHBOARD_PUBLIC_URL = "https://monitoring.example.org";
    const { oauthCallbackBase } = await import("../ingest-url");
    expect(oauthCallbackBase()).toBe("https://monitoring.example.org");
  });

  it("keeps the hosted default when nothing is configured", async () => {
    delete process.env.OAUTH_CALLBACK_BASE;
    delete process.env.DASHBOARD_PUBLIC_URL;
    const { oauthCallbackBase } = await import("../ingest-url");
    expect(oauthCallbackBase()).toBe("https://app.glassmkr.com");
  });

  it("still lets an explicit OAUTH_CALLBACK_BASE win", async () => {
    process.env.OAUTH_CALLBACK_BASE = "https://explicit.example.org/";
    process.env.DASHBOARD_PUBLIC_URL = "https://ignored.example.org";
    const { oauthCallbackBase } = await import("../ingest-url");
    expect(oauthCallbackBase()).toBe("https://explicit.example.org");
  });
});
