import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  getSupportedMcpScopes,
  getMcpPublicOrigin,
  getMcpResourceUrl,
  isMcpOAuthEnabled,
} from "$lib/server/oauth/constants.js";

export const GET: RequestHandler = async () => {
  if (!isMcpOAuthEnabled()) return new Response(null, { status: 404 });
  return json(
    {
      resource: getMcpResourceUrl(),
      authorization_servers: [getMcpPublicOrigin()],
      bearer_methods_supported: ["header"],
      scopes_supported: getSupportedMcpScopes(),
      resource_name: "Glassmkr MCP",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
};
