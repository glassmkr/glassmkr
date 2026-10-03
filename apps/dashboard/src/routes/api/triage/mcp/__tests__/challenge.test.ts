import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../../../../.well-known/openai-apps-challenge/+server.js";

async function call(): Promise<Response> {
  return await GET({ request: new Request("https://app.glassmkr.com/.well-known/openai-apps-challenge") } as any);
}

afterEach(() => {
  delete process.env.OPENAI_APPS_CHALLENGE;
});

describe("/.well-known/openai-apps-challenge", () => {
  it("serves the trimmed token as uncached plain text", async () => {
    process.env.OPENAI_APPS_CHALLENGE = "  oai-challenge-token-123\n";
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("oai-challenge-token-123");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404s when the env var is unset or blank", async () => {
    expect((await call()).status).toBe(404);
    process.env.OPENAI_APPS_CHALLENGE = "   ";
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
