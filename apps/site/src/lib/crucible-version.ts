// Single source of truth for the Crucible fallback version on the marketing
// site: the value advertised when the npm registry is unreachable, and the
// static default for isolated / screenshot-capture renders of the showcase
// components. The server-side getLatestCrucible() in $lib/server/version.ts
// prefers the live npm dist-tag and only falls back to this.
//
// IMPORTANT: bump only AFTER the corresponding `npm publish` lands; it must
// always be a real, installable release. gen-rules.mjs keeps its own mirror of
// this value for the build-time prebuild (it runs outside the module graph);
// bump both in lockstep.
export const FALLBACK_CRUCIBLE_VERSION = "1.2.1";
