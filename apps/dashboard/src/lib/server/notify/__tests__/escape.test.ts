// C-1 (Grok + Codex security review, 2026-09-01).

import { describe, it, expect } from "vitest";
import { escapeHtml, escapeSlackMrkdwn, escapeDiscord } from "../escape";

describe("escapeHtml (Telegram HTML)", () => {
  it("escapes the HTML metacharacters", () => {
    expect(escapeHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });
  it("neutralises a tag/anchor injected via a hostname", () => {
    const out = escapeHtml('</code><a href="http://evil">pwn</a>');
    expect(out).not.toContain("<a");
    expect(out).not.toContain("</code>");
  });
});

describe("escapeSlackMrkdwn", () => {
  it("escapes & < > so a value cannot forge a <url|label> link or a mention", () => {
    expect(escapeSlackMrkdwn("<http://evil|click> & <@U1>")).toBe(
      "&lt;http://evil|click&gt; &amp; &lt;@U1&gt;",
    );
  });
});

describe("escapeDiscord", () => {
  it("backslash-escapes a masked-link injection", () => {
    expect(escapeDiscord("[click](http://evil)")).toBe("\\[click\\]\\(http://evil\\)");
  });
  it("escapes formatting characters and a leading list/header marker", () => {
    expect(escapeDiscord("*b* _i_ ~s~")).toBe("\\*b\\* \\_i\\_ \\~s\\~");
    expect(escapeDiscord("# not a header")).toBe("\\# not a header");
  });
});
