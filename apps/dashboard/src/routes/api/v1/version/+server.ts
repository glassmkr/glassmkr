// scope: public
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { execSync } from "node:child_process";
import { getLatestCrucible, MIN_SUPPORTED_CRUCIBLE } from "$lib/server/version";

// Resolved once at module load. The dashboard service runs from a checked-out
// repo (WorkingDirectory in the systemd unit), so `git rev-parse HEAD` works.
// Falls back to GIT_SHA env or "unknown" outside a repo (e.g., container build).
const DASHBOARD_GIT_SHA: string = (() => {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return process.env.GIT_SHA ?? "unknown";
  }
})();

// GET /api/v1/version - Public, used by Crucible for update checks and by
// the Dashboard dashboard to render the "Update to X" badge. Also returns the
// deployed Dashboard git SHA so ops can confirm which build is running.
export const GET: RequestHandler = async () => {
  const latest = await getLatestCrucible();
  return json({
    crucible: {
      latest,
      min_supported: MIN_SUPPORTED_CRUCIBLE,
      changelog_url: "https://github.com/glassmkr/crucible/releases",
    },
    dashboard: { version: "1.0.0", git_sha: DASHBOARD_GIT_SHA },
  });
};
