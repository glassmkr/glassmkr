// The status page deploys to Cloudflare Pages, deliberately OFF the Glassmkr
// infrastructure it reports on. Hosting it on the production host meant a
// services outage took the status page down with it, so it could never tell
// anyone the dashboard was down: a services reboot on 2026-07-25 took
// status.glassmkr.com offline for the duration. On Cloudflare the uptime probes
// in lib/server/state.ts also become genuinely external.
//
// Nothing here needs a Node runtime: incident markdown is inlined at build time
// by import.meta.glob (eager, raw) and the probes use fetch. gray-matter parses
// those inlined strings at request time and reaches for Node builtins, so the
// Pages project runs with the nodejs_compat compatibility flag.
import adapter from "@sveltejs/adapter-cloudflare";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
  },
};

export default config;
