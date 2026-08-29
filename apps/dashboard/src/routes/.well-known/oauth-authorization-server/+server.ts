import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  getSupportedMcpScopes,
  getMcpPublicOrigin,
  isMcpDynamicRegistrationEnabled,
  isMcpOAuthEnabled,
} from "$lib/server/oauth/constants.js";

export const GET: RequestHandler = async () => {
  if (!isMcpOAuthEnabled()) return new Response(null, { status: 404 });
  const issuer = getMcpPublicOrigin();
  return json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      ...(isMcpDynamicRegistrationEnabled()
        ? { registration_endpoint: `${issuer}/oauth/register` }
        : {}),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: getSupportedMcpScopes(),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
};
