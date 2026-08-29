import { describe, expect, it } from "vitest";
import { safeLocalRedirect } from "../local-redirect.js";

describe("safeLocalRedirect", () => {
  it("preserves local paths with query parameters", () => {
    expect(safeLocalRedirect("/oauth/authorize?client_id=abc"))
      .toBe("/oauth/authorize?client_id=abc");
  });

  it("rejects absolute, protocol-relative, and backslash redirects", () => {
    expect(safeLocalRedirect("https://attacker.example", "/safe")).toBe("/safe");
    expect(safeLocalRedirect("//attacker.example", "/safe")).toBe("/safe");
    expect(safeLocalRedirect("/\\attacker.example", "/safe")).toBe("/safe");
  });
});
