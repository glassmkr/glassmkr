// Latest advertised Crucible release for the marketing site.
//
// Same pattern as `apps/dashboard/src/lib/server/version.ts`: customers
// install via `npm install -g @glassmkr/crucible`, so npm's
// `dist-tags.latest` is the gate, not GitHub tags or Releases (which
// can drift; both have).
//
// Fetched on a 10-minute in-process cache. Concurrent requests share a
// single in-flight fetch.
//
// IMPORTANT: never advertise a version that isn't actually published on
// npm. FALLBACK_LATEST is used only when the registry is unreachable;
// it must always be a real, installable release. Bump it only AFTER
// the corresponding `npm publish` lands. Don't bump it ahead of time
// to "prepare" for a release.

import { FALLBACK_CRUCIBLE_VERSION } from "$lib/crucible-version";

export const FALLBACK_LATEST = FALLBACK_CRUCIBLE_VERSION;

const CACHE_TTL_MS = 10 * 60 * 1000;
const NPM_DIST_TAGS_URL =
  "https://registry.npmjs.org/-/package/@glassmkr/crucible/dist-tags";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

let cached: { version: string; at: number } | null = null;
let inflight: Promise<string> | null = null;

async function fetchLatest(): Promise<string> {
  try {
    const res = await fetch(NPM_DIST_TAGS_URL, {
      headers: {
        "user-agent": "glassmkr-site",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`npm ${res.status}`);
    const body = (await res.json()) as { latest?: string };
    const tag = (body.latest ?? "").replace(/^v/, "");
    if (!SEMVER_RE.test(tag)) throw new Error(`unparseable version ${JSON.stringify(tag)}`);
    return tag;
  } catch (err: any) {
    console.warn(
      `[site/version] npm registry fetch failed, falling back to ${FALLBACK_LATEST}: ${err?.message}`,
    );
    return FALLBACK_LATEST;
  }
}

/**
 * Returns the latest Crucible version. Cached in process memory for 10
 * minutes; refreshed lazily on the next call after expiry. Concurrent
 * callers that hit an expired cache share a single in-flight fetch.
 */
export async function getLatestCrucible(): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.version;
  if (inflight) return inflight;
  inflight = fetchLatest().then((version) => {
    cached = { version, at: Date.now() };
    inflight = null;
    return version;
  });
  return inflight;
}

/**
 * Convenience for SvelteKit page server loads that just need the
 * Crucible version in their returned data. Wraps getLatestCrucible
 * in a fallback guard and shapes the result as { crucibleVersion },
 * the property the homepage and vertical pages consume. Used by the
 * homepage loader and the three for-* vertical page-server loaders.
 */
export async function loadCrucibleVersion(): Promise<{ crucibleVersion: string }> {
  let crucibleVersion: string;
  try {
    crucibleVersion = await getLatestCrucible();
  } catch {
    crucibleVersion = FALLBACK_LATEST;
  }
  return { crucibleVersion };
}

/** Test-only helper. Do not call from production code. */
export function _resetLatestCrucibleCache(): void {
  cached = null;
  inflight = null;
}
