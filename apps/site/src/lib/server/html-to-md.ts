// Runtime HTML -> Markdown for the ".md twin" of every marketing page.
//
// hooks.server.ts serves `<path>.md` by rendering the real page (SSR) and
// passing its <main> region through pageToMarkdown(). This covers EVERY page
// uniformly, including component-composed ones (homepage, /for-*, /pricing)
// that a build-time source extractor cannot reach.
//
// This intentionally mirrors the (build-time) converter in
// scripts/docs-md.mjs, which generates the /docs/<slug>.md static twins + the
// llms-full corpus. The two are separate on purpose: docs-md runs under plain
// `node` at prebuild and cannot import this TS module. Keep the conversion
// vocabulary (headings, p, lists, pre/code, tables, callouts, inline a/strong/
// em/code) in sync between the two if you extend either. It is deliberately
// small and not a general HTML->MD engine.

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&larr;/g, "<-")
    .replace(/&rarr;/g, "->")
    .replace(/&hellip;/g, "...")
    .replace(/&mdash;/g, ": ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function inline(html: string): string {
  let s = html;
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => {
    const code = decodeEntities(String(t).replace(/<[^>]+>/g, "")).trim();
    return "`" + code + "`";
  });
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
    const t = inline(String(txt)).trim();
    if (t === "" || t === "#") return "";
    return `[${t}](${href})`;
  });
  s = s.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${inline(String(t)).trim()}**`);
  s = s.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${inline(String(t)).trim()}**`);
  s = s.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${inline(String(t)).trim()}*`);
  s = s.replace(/<[^>]+>/g, "");
  return decodeEntities(s).replace(/[ \t\n]+/g, " ").trim();
}

function listToMd(html: string, ordered: boolean): string {
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => inline(m[1]));
  return items
    .filter((t) => t !== "")
    .map((t, i) => (ordered ? `${i + 1}. ${t}` : `- ${t}`))
    .join("\n");
}

function tableToMd(html: string): string {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inline(c[1]).replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill("")];
  const head = pad(rows[0]);
  const sep = Array(cols).fill("---");
  const body = rows.slice(1).map(pad);
  return [head, sep, ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function inlinePreserveLines(s: string): string {
  let out = s;
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => "`" + decodeEntities(String(t).replace(/<[^>]+>/g, "")).trim() + "`");
  out = out.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => {
    const innerText = inline(String(t)).trim();
    return innerText === "" || innerText === "#" ? "" : `[${innerText}](${h})`;
  });
  out = out.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${inline(String(t)).trim()}**`);
  out = out.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${inline(String(t)).trim()}*`);
  out = out.replace(/<[^>]+>/g, "");
  return decodeEntities(out);
}

function inlineLeftovers(s: string): string {
  return s
    .split(/( B\d+ )/)
    .map((chunk) => (/^ B\d+ $/.test(chunk) ? chunk : inlinePreserveLines(chunk)))
    .join("");
}

function htmlToMarkdown(articleHtml: string): string {
  const blocks: string[] = [];
  let s = articleHtml;

  // Drop non-content elements up front (decorative SVGs, scripts, styles,
  // and the showcase mockups, which are visual-only and carry no prose).
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, " ");

  // 1. Protect <pre><code> as fenced blocks.
  s = s.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, code) => {
    const text = decodeEntities(String(code).replace(/<[^>]+>/g, ""));
    const token = ` B${blocks.length} `;
    blocks.push("```\n" + text.replace(/\n+$/, "") + "\n```");
    return `\n${token}\n`;
  });

  // 2. Protect tables as GFM.
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, t) => {
    const token = ` B${blocks.length} `;
    blocks.push(tableToMd(t));
    return `\n${token}\n`;
  });

  // 3. Callouts -> blockquote.
  s = s.replace(/<(?:div|aside)\b[^>]*class="[^"]*\b(?:callout|note|llm-intro|vs-tldr)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|aside)>/gi, (_, innerHtml) => {
    const token = ` B${blocks.length} `;
    const body = inline(innerHtml);
    blocks.push(body ? `> ${body}` : "");
    return `\n${token}\n`;
  });

  // 4. Drop eyebrow labels, then structural wrappers.
  s = s.replace(/<p\b[^>]*class="[^"]*\b(?:eyebrow|vs-eyebrow)\b[^"]*"[^>]*>[\s\S]*?<\/p>/gi, "");
  s = s.replace(/<\/?(?:section|article|div|header|nav|aside|main|figure|svelte:[a-z]+)\b[^>]*>/gi, "\n");

  // 5. Headings.
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${inline(t)}\n`);
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${inline(t)}\n`);
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${inline(t)}\n`);
  s = s.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${inline(t)}\n`);

  // 6. Lists.
  s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, t) => `\n${listToMd(t, false)}\n`);
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, t) => `\n${listToMd(t, true)}\n`);

  // 7. Paragraphs.
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${inline(t)}\n`);

  // 8. Anything left.
  s = inlineLeftovers(s);

  // 9. Restore protected blocks.
  s = s.replace(/ B(\d+) /g, (_, i) => blocks[Number(i)]);

  // 10. Trim per line (leaving fenced code indentation intact).
  let inFence = false;
  s = s
    .split("\n")
    .map((line) => {
      const t = line.replace(/[ \t]+$/, "");
      if (t.trim().startsWith("```")) {
        inFence = !inFence;
        return t.trim();
      }
      return inFence ? t : t.replace(/^[ \t]+/, "");
    })
    .join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Pull the inner HTML of the first <main> region (the layout wraps page
 *  content in <main>; nav/header/footer live outside it). */
function extractMain(fullHtml: string): string | null {
  const m = fullHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return m ? m[1] : null;
}

function extractTitle(fullHtml: string): string {
  const m = fullHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  // Titles are "Page name - Glassmkr" / "... | Glassmkr"; keep the page name.
  return inline(m[1]).replace(/\s*[-|]\s*Glassmkr\s*$/i, "").trim();
}

/**
 * Convert a fully-rendered page's HTML into a Markdown twin. Returns null when
 * there is no <main> region or it converts to nothing (the hook then falls
 * through to serving the normal response).
 */
export function pageToMarkdown(fullHtml: string, canonicalUrl: string): string | null {
  const main = extractMain(fullHtml);
  if (main === null) return null;
  const body = htmlToMarkdown(main);
  if (!body.trim()) return null;

  const title = extractTitle(fullHtml);
  const header: string[] = [`> Source: ${canonicalUrl}`];
  // Add an H1 from <title> only when the body does not already open with one.
  if (title && !body.startsWith("# ")) header.push(`# ${title}`);
  return header.join("\n\n") + "\n\n" + body;
}
