// Markdown-based incident loader. Each file under src/lib/incidents/*.md has
// frontmatter (title, status, severity, start, end, affected[]) and body text.

import matter from "gray-matter";

const modules = import.meta.glob("/src/lib/incidents/*.md", { as: "raw", eager: true });

export interface Incident {
  slug: string;
  title: string;
  status: "investigating" | "monitoring" | "resolved";
  severity: "incident" | "maintenance";
  start: string;
  end?: string;
  affected: string[];
  body: string;
}

function parseOne(slug: string, raw: string): Incident {
  const { data, content } = matter(raw);
  return {
    slug,
    title: String(data.title ?? slug),
    status: (data.status ?? "resolved") as Incident["status"],
    severity: (data.severity ?? "incident") as Incident["severity"],
    start: String(data.start ?? ""),
    end: data.end ? String(data.end) : undefined,
    affected: Array.isArray(data.affected) ? data.affected.map(String) : [],
    body: content.trim(),
  };
}

export function loadIncidents(): Incident[] {
  const out: Incident[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const slug = path.split("/").pop()!.replace(/\.md$/, "");
    out.push(parseOne(slug, raw as string));
  }
  // Most recent first
  out.sort((a, b) => (a.start < b.start ? 1 : -1));
  return out;
}
