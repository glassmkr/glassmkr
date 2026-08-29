// Shared server-slug builder. The /server/[slug] route uses this
// shape; consumers that want to link to a server detail page must
// derive the slug the same way (otherwise the [slug]/+page.svelte
// resolver fails to find the matching server and shows 404).
//
// Extracted 2026-05-20 after a bug where trend-warnings/+page.svelte
// linked to /servers/{server_id} (plural path + raw ID) producing a
// 404 for every trend-warning row click.

export interface SlugInput {
  hostname?: string | null;
  name?: string | null;
  id?: string | null;
}

/**
 * Build the slug used by the /server/[slug] route. Prefers hostname,
 * falls back to name, then to id. Lowercased and stripped of any
 * characters outside [a-z0-9-]. Multiple consecutive non-allowed
 * characters collapse to repeated dashes (matching the existing
 * the fleet view's behavior so we don't introduce a routing
 * drift).
 */
export function toServerSlug(s: SlugInput): string {
  const base = s.hostname || s.name || s.id || "";
  return base.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * Is this slug ambiguous across the given fleet, i.e. do two or more servers
 * derive the same one?
 *
 * Hostname-derived slugs are NOT unique. A rebuilt or re-enrolled box keeps its
 * hostname, so the old record and the new one both slug to it. Found 2026-07-29:
 * `web-01` had two records (a live Ubuntu 24.04 one and a dead Debian 13 one
 * from before the rebuild), so both dashboard rows linked to `/server/web-01`
 * and the resolver's `find()` returned whichever came back first. One record was
 * therefore unreachable in the UI: no URL existed for it, so it could not be
 * inspected or deleted. Worse, which record you landed on depended on array order,
 * so the page could silently show 191-hour-stale data for a machine that was fine.
 *
 * Callers that hold the whole fleet (the server grid) use this to link by id
 * instead, which is always unambiguous. Callers that hold only one server (the
 * notification dispatchers) cannot detect a collision and keep using the plain
 * slug; the route resolves both forms, so their links stay valid.
 */
export function isSlugAmbiguous(s: SlugInput, fleet: SlugInput[]): boolean {
  const slug = toServerSlug(s);
  let seen = 0;
  for (const other of fleet) {
    if (toServerSlug(other) === slug) seen++;
    if (seen > 1) return true;
  }
  return false;
}

/**
 * The link the server grid should use: the readable slug when it is unique in the
 * fleet, the raw id when it is not. Keeps pretty URLs for the normal case without
 * ever producing a URL that resolves to the wrong server.
 */
export function serverLinkPath(s: SlugInput, fleet: SlugInput[]): string {
  return isSlugAmbiguous(s, fleet) ? `/server/${s.id ?? ""}` : `/server/${toServerSlug(s)}`;
}

/**
 * Resolve a `[slug]` route param against the fleet. Accepts EITHER a raw server
 * id or a hostname/name-derived slug, so `serverLinkPath()`'s id form and every
 * previously-sent notification link both work.
 *
 * On an ambiguous slug it returns the most recently seen match rather than the
 * first one in the array, so the page is deterministic and lands on the live
 * record instead of a dead twin. `ambiguous` is returned so the page can tell the
 * operator that duplicates exist, which is the actual bug they need to fix.
 */
export function resolveServerBySlug<
  T extends { id: string; hostname?: string | null; name?: string | null; last_seen_at?: string | null },
>(
  slug: string,
  fleet: T[],
): { server: T | null; ambiguous: boolean } {
  const byId = fleet.find((s) => s.id === slug);
  if (byId) return { server: byId, ambiguous: false };

  const matches = fleet.filter((s) => toServerSlug(s) === slug);
  if (matches.length === 0) return { server: null, ambiguous: false };
  if (matches.length === 1) return { server: matches[0], ambiguous: false };

  const newest = [...matches].sort(
    (a, b) => new Date(b.last_seen_at ?? 0).getTime() - new Date(a.last_seen_at ?? 0).getTime(),
  )[0];
  return { server: newest, ambiguous: true };
}

/**
 * Absolute URL to a server's detail page. Wraps toServerSlug so the
 * notification call sites (Telegram, Slack, email, trend-warnings) cannot
 * drift from the /server/[slug] route's own slug derivation.
 */
export function serverDetailUrl(s: SlugInput): string {
  return `https://app.glassmkr.com/server/${toServerSlug(s)}`;
}
