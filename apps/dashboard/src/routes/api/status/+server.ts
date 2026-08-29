// scope: public
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// GET /api/status - Public status endpoint
export const GET: RequestHandler = async () => {
  return json({
    health: {
      overall: "ok",
      checks: [{ name: "dashboard_alive", status: "ok", message: "Dashboard is running", timestamp: Date.now() }],
      lastRun: Date.now(),
    },
    version: "0.8.0",
  });
};
