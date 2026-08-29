import { describe, expect, it } from "vitest";
import {
  parseRequestedScopes,
  readBoundedRequestBody,
  requireExactRedirectUri,
  validatePkceChallenge,
  validatePkceVerifier,
  validateRedirectUri,
} from "../validation.js";

describe("MCP OAuth validation", () => {
  it("accepts only the published read scope when write is disabled", () => {
    delete process.env.MCP_WRITE_ENABLED;
    expect(parseRequestedScopes("glassmkr:read glassmkr:read")).toEqual(["glassmkr:read"]);
    expect(() => parseRequestedScopes("glassmkr:write")).toThrow("not supported");
  });

  it("accepts write and normalizes it to also carry read when the write surface is enabled", () => {
    process.env.MCP_WRITE_ENABLED = "1";
    try {
      // A write grant must always include read (bearer requires read; hasMcpScope
      // treats write as implying read). read is added and listed first.
      expect(parseRequestedScopes("glassmkr:write")).toEqual(["glassmkr:write", "glassmkr:read"]);
      expect(parseRequestedScopes("glassmkr:read glassmkr:write")).toEqual(["glassmkr:read", "glassmkr:write"]);
      // admin is still not offered unless its own flag is set.
      expect(() => parseRequestedScopes("glassmkr:admin")).toThrow("not supported");
    } finally {
      delete process.env.MCP_WRITE_ENABLED;
    }
  });

  it("normalizes admin to explicitly carry write + read when admin is enabled (Codex #5)", () => {
    process.env.MCP_ADMIN_ENABLED = "1";
    try {
      // admin implies write+read at runtime; the granted set must SAY so, so the
      // consent screen shows the write permission an admin token can exercise.
      expect(parseRequestedScopes("glassmkr:admin")).toEqual([
        "glassmkr:admin",
        "glassmkr:write",
        "glassmkr:read",
      ]);
    } finally {
      delete process.env.MCP_ADMIN_ENABLED;
    }
  });

  it("requires PKCE S256 with strict verifier shapes", () => {
    const challenge = "a".repeat(43);
    expect(validatePkceChallenge(challenge, "S256")).toBe(challenge);
    expect(() => validatePkceChallenge(challenge, "plain")).toThrow("S256");
    expect(validatePkceVerifier("A".repeat(43))).toBe("A".repeat(43));
    expect(() => validatePkceVerifier("short")).toThrow("invalid");
  });

  it("allows HTTPS and HTTP loopback redirects only", () => {
    expect(validateRedirectUri("https://client.example/callback"))
      .toBe("https://client.example/callback");
    expect(validateRedirectUri("http://127.0.0.1:43123/callback"))
      .toBe("http://127.0.0.1:43123/callback");
    expect(() => validateRedirectUri("http://client.example/callback")).toThrow("HTTPS");
    expect(() => validateRedirectUri("https://user:pass@client.example/callback"))
      .toThrow("invalid");
  });

  it("compares redirect URIs exactly after validation", () => {
    const registered = ["https://client.example/callback"];
    expect(requireExactRedirectUri(registered[0], registered)).toBe(registered[0]);
    expect(() => requireExactRedirectUri("https://client.example/callback/", registered))
      .toThrow("not registered");
  });

  it("rejects oversized request bodies even without a content length", async () => {
    const request = new Request("https://app.glassmkr.com/oauth/token", {
      method: "POST",
      body: "x".repeat(33),
    });
    await expect(readBoundedRequestBody(request, 32)).rejects.toMatchObject({
      code: "invalid_request",
      status: 413,
    });
  });
});
