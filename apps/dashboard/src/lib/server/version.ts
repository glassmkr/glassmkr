// Latest advertised Crucible release.
//
// The only trustworthy source is "it's installable right now." Customers
// install via `npm install -g @glassmkr/crucible`, so the gate is npm's
// `dist-tags.latest` on the package, not the GitHub repo (which can have
// tags or Releases that never made it to npm, or the reverse). We fetch
// the npm registry on a 10-minute in-process cache.
//
// IMPORTANT: never advertise a version that isn't actually published.
// An earlier iteration used a hardcoded LATEST_CRUCIBLE constant that
// was bumped *before* publish, which caused ingest to fire "update
// available" notifications (Telegram/Slack) for a version customers
// couldn't install. Don't reintroduce that pattern.
//
// FALLBACK_LATEST is used only when npm is unreachable. It must always
// be a real, installable release (not what's in-progress). Bump it only
// after the corresponding release is live on npm.

export const FALLBACK_LATEST = "1.2.2";
export const MIN_SUPPORTED_CRUCIBLE = "0.1.0";

const CACHE_TTL_MS = 10 * 60 * 1000;
const NPM_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/@glassmkr/crucible/dist-tags";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

let cached: { version: string; at: number } | null = null;
let inflight: Promise<string> | null = null;

async function fetchLatest(): Promise<string> {
  try {
    const res = await fetch(NPM_DIST_TAGS_URL, {
      headers: { "user-agent": "glassmkr-dashboard", accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`npm ${res.status}`);
    const body = (await res.json()) as { latest?: string };
    const tag = (body.latest ?? "").replace(/^v/, "");
    if (!SEMVER_RE.test(tag)) throw new Error(`unparseable version ${JSON.stringify(tag)}`);
    return tag;
  } catch (err: any) {
    console.warn(`[version] npm registry fetch failed, falling back to ${FALLBACK_LATEST}: ${err?.message}`);
    return FALLBACK_LATEST;
  }
}

/**
 * Returns the latest Crucible version. Cached in process memory for 10 min.
 * Refreshes lazily on the next call after expiry. Concurrent callers that
 * hit an expired cache share a single in-flight fetch.
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
 * Reset the cache. Test-only helper; never called from production code.
 */
export function _resetLatestCrucibleCache(): void {
  cached = null;
  inflight = null;
}
