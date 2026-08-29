import { describe, expect, it } from "vitest";
import { apiErrorBody, codeForStatus, isApiPath } from "../errors";

// These pin the contract an autonomous client is told it can rely on. The three
// shapes an external audit actually observed on production were:
//   401 {"message":"Authentication required"}     (no code, no request id)
//   404 text/html, the whole app shell
//   405 "GET method not allowed", no content-type
describe("the API error envelope", () => {
  it("always carries the fields a client branches on", () => {
    const body = apiErrorBody({ status: 401, message: "Authentication required" });
    for (const k of [
      "error",
      "message",
      "request_id",
      "documentation_url",
      "retryable",
      "retry_after_seconds",
      "details",
    ]) {
      expect(body).toHaveProperty(k);
    }
  });

  it("derives a stable code from the status when a callsite gives none", () => {
    expect(apiErrorBody({ status: 401, message: "x" }).error).toBe("unauthenticated");
    expect(apiErrorBody({ status: 404, message: "x" }).error).toBe("not_found");
    expect(apiErrorBody({ status: 405, message: "x" }).error).toBe("method_not_allowed");
    expect(apiErrorBody({ status: 429, message: "x" }).error).toBe("rate_limited");
  });

  it("lets a callsite state a more specific code", () => {
    const body = apiErrorBody({ status: 404, code: "unknown_endpoint", message: "x" });
    expect(body.error).toBe("unknown_endpoint");
    expect(body.documentation_url).toContain("#unknown_endpoint");
  });

  it("never reports a client mistake as retryable", () => {
    // An agent that retries a 403 in a loop is worse than one that stops, so
    // the 4xx family that cannot succeed on repeat must say so.
    for (const s of [400, 401, 403, 404, 405, 409, 422]) {
      expect(apiErrorBody({ status: s, message: "x" }).retryable).toBe(false);
    }
  });

  it("reports transient failures as retryable", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(apiErrorBody({ status: s, message: "x" }).retryable).toBe(true);
    }
  });

  it("carries a retry delay only when one was supplied", () => {
    expect(apiErrorBody({ status: 429, message: "x" }).retry_after_seconds).toBeNull();
    expect(apiErrorBody({ status: 429, message: "x", retryAfterSeconds: 30 }).retry_after_seconds).toBe(30);
  });

  it("gives every status a code rather than falling through to undefined", () => {
    for (const s of [400, 401, 403, 404, 405, 418, 429, 500, 503, 599]) {
      expect(typeof codeForStatus(s)).toBe("string");
      expect(codeForStatus(s).length).toBeGreaterThan(0);
    }
  });

  it("claims /api/ and deliberately leaves /oauth/ alone", () => {
    expect(isApiPath("/api/v1/servers")).toBe(true);
    expect(isApiPath("/api/health")).toBe(true);
    // RFC 6749 mandates {error, error_description} and an OAuth client is
    // entitled to expect exactly that, so this envelope must not claim it.
    expect(isApiPath("/oauth/token")).toBe(false);
    expect(isApiPath("/mcp")).toBe(false);
    expect(isApiPath("/settings")).toBe(false);
  });
});
