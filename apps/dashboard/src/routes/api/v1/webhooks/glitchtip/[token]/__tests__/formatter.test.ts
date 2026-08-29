// Unit tests for the GlitchTip -> Telegram message formatter.
//
// The formatter is the part most likely to drift as GlitchTip
// versions change the webhook payload shape. Tests pin the
// observable output for the three real-world payload variants we
// have seen so far so regressions land loudly.

import { describe, it, expect } from "vitest";
import { formatTelegramMessage } from "../formatter";

describe("formatTelegramMessage", () => {
  it("renders a real GlitchTip new-issue payload", () => {
    const payload = {
      alias: "GlitchTip",
      text: "GlitchTip Alert",
      attachments: [
        {
          title: "Deliberate test error from /api/v1/admin/_test_error",
          title_link: "https://glitchtip.glassmkr.com/glassmkr/dashboard/issues/42",
          text: "Error\n  at file:///code/build/server/index.js:1234:56",
          color: "#e74c3c",
          fields: [
            { title: "Environment", value: "production" },
            { title: "Release", value: "a18e298c02c4d1" },
          ],
        },
      ],
    };

    const out = formatTelegramMessage(payload);

    expect(out).toContain("[GlitchTip] new issue");
    expect(out).toContain(
      "Deliberate test error from /api/v1/admin/_test_error",
    );
    expect(out).toContain("Environment: production");
    expect(out).toContain("Release: a18e298c02c4d1");
    expect(out).toContain(
      "https://glitchtip.glassmkr.com/glassmkr/dashboard/issues/42",
    );
  });

  it("falls back to top-level text when attachments is missing", () => {
    const out = formatTelegramMessage({ text: "Some alert summary" });

    expect(out).toContain("[GlitchTip] new issue");
    expect(out).toContain("Some alert summary");
  });

  it("truncates very long attachment text to keep Telegram messages readable", () => {
    const longText = "x".repeat(2000);
    const out = formatTelegramMessage({
      attachments: [{ title: "Issue", text: longText }],
    });

    // Should contain truncation marker, and the body lines should
    // be substantially shorter than the raw input.
    expect(out).toContain("...");
    // The truncated chunk is 600 chars + ellipsis; total output is
    // a handful of lines plus that — well under the raw 2000.
    expect(out.length).toBeLessThan(1000);
  });

  it("does not duplicate text when attachment text equals title", () => {
    const out = formatTelegramMessage({
      attachments: [{ title: "Same string", text: "Same string" }],
    });

    // "Same string" should appear exactly once (as the title), not
    // twice (title + body).
    const occurrences = (out.match(/Same string/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("handles an empty payload without throwing", () => {
    const out = formatTelegramMessage({});
    expect(out).toContain("[GlitchTip] new issue");
  });
});
