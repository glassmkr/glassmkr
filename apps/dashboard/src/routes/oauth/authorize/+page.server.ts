import { error, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { writeAudit } from "$lib/server/auth/audit.js";
import type { SessionPrincipal } from "$lib/server/auth/principal.js";
import {
  getMcpResourceUrl,
  isMcpAccountAllowed,
  isMcpClientAllowed,
  isMcpOAuthEnabled,
} from "$lib/server/oauth/constants.js";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
  denyAuthorizationRequest,
  getOAuthClient,
} from "$lib/server/oauth/store.js";
import {
  OAuthRequestError,
  parseRequestedScopes,
  requireExactRedirectUri,
  validatePkceChallenge,
} from "$lib/server/oauth/validation.js";

const CONSENT_COOKIE = "mcp_oauth_consent";

function sessionPrincipal(customer: NonNullable<App.Locals["customer"]>): SessionPrincipal {
  return {
    kind: "session",
    customer_id: customer.id,
    email: customer.email,
    plan: customer.plan,
  };
}

function consentCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: 10 * 60,
    path: "/oauth/authorize",
  };
}

export const load: PageServerLoad = async (event) => {
  if (!isMcpOAuthEnabled()) throw error(404, "Not found");
  if (!event.locals.customer) {
    const returnTo = `${event.url.pathname}${event.url.search}`;
    throw redirect(302, `/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  try {
    const responseType = event.url.searchParams.get("response_type");
    if (responseType !== "code") {
      throw new OAuthRequestError("unsupported_response_type", "response_type=code is required");
    }
    const clientId = event.url.searchParams.get("client_id");
    if (!clientId || clientId.length > 2048) {
      throw new OAuthRequestError("invalid_request", "client_id is required");
    }
    const client = await getOAuthClient(clientId);
    if (!client) throw new OAuthRequestError("invalid_request", "client is not registered");
    if (
      !isMcpAccountAllowed(event.locals.customer.id)
      || !isMcpClientAllowed(clientId)
    ) {
      throw new OAuthRequestError(
        "access_denied",
        "MCP access is not enabled for this account and client",
        403,
      );
    }
    const redirectUri = requireExactRedirectUri(
      event.url.searchParams.get("redirect_uri"),
      client.redirectUris,
    );
    const resource = event.url.searchParams.get("resource");
    if (resource !== getMcpResourceUrl()) {
      throw new OAuthRequestError("invalid_target", "resource is not the Glassmkr MCP endpoint");
    }
    const state = event.url.searchParams.get("state");
    if (state !== null && state.length > 1024) {
      throw new OAuthRequestError("invalid_request", "state is too long");
    }
    const request = await createAuthorizationRequest({
      customerId: event.locals.customer.id,
      clientId,
      redirectUri,
      scopes: parseRequestedScopes(event.url.searchParams.get("scope")),
      state,
      resource,
      codeChallenge: validatePkceChallenge(
        event.url.searchParams.get("code_challenge"),
        event.url.searchParams.get("code_challenge_method"),
      ),
    });
    event.cookies.set(
      CONSENT_COOKIE,
      request.csrf,
      consentCookieOptions(event.url.protocol === "https:"),
    );
    return {
      requestId: request.id,
      csrf: request.csrf,
      clientName: request.clientName,
      clientId: request.clientId,
      isVerified: request.isVerified,
      scopes: request.scopes,
      redirectHost: request.redirectHost,
      accountEmail: event.locals.customer.email,
    };
  } catch (cause) {
    if (cause instanceof OAuthRequestError) {
      throw error(cause.status, cause.message);
    }
    throw cause;
  }
};

export const actions: Actions = {
  default: async (event) => {
    if (!isMcpOAuthEnabled()) throw error(404, "Not found");
    if (!event.locals.customer) throw error(401, "Authentication required");
    const form = await event.request.formData();
    const requestId = form.get("request_id");
    const csrf = form.get("csrf");
    const decision = form.get("decision");
    const cookieCsrf = event.cookies.get(CONSENT_COOKIE);
    if (
      typeof requestId !== "string" ||
      typeof csrf !== "string" ||
      csrf !== cookieCsrf ||
      (decision !== "approve" && decision !== "deny")
    ) {
      throw error(400, "Authorization request is invalid or expired");
    }
    try {
      const principal = sessionPrincipal(event.locals.customer);
      const location = decision === "approve"
        ? await approveAuthorizationRequest({
            requestId,
            customerId: event.locals.customer.id,
            csrf,
          })
        : await denyAuthorizationRequest({
            requestId,
            customerId: event.locals.customer.id,
            csrf,
          });
      await writeAudit({
        event,
        principal,
        action: decision === "approve" ? "authorize_mcp_client" : "deny_mcp_client",
        result: "success",
        status_code: 303,
        resource_type: "mcp_authorization",
        resource_id: requestId,
      });
      event.cookies.delete(CONSENT_COOKIE, { path: "/oauth/authorize" });
      throw redirect(303, location);
    } catch (cause) {
      if (cause instanceof OAuthRequestError) {
        await writeAudit({
          event,
          principal: sessionPrincipal(event.locals.customer),
          action: "authorize_mcp_client",
          result: "invalid",
          status_code: cause.status,
          resource_type: "mcp_authorization",
          resource_id: requestId,
          metadata: { oauth_error: cause.code },
        });
        throw error(cause.status, cause.message);
      }
      throw cause;
    }
  },
};
