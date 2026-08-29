// scope: public
// Catch-all for unmatched /api/ paths.
//
// Without this, an unknown route under /api/v1/ falls through to SvelteKit's
// page error path and gets the server-rendered app shell: a 404 whose body is
// `<!doctype html>`. A browser recovers from that. A client that asked for JSON
// and is handed HTML cannot tell "this endpoint does not exist" from "the
// service is broken", which is exactly the distinction an autonomous client
// needs in order to stop rather than retry.
//
// This sits at src/routes/api/, so it is less specific than every real
// api/v1/** route and cannot shadow one. It does not intercept
// /api/openapi.json: that is a static asset served by adapter-node's sirv
// handler before the router runs.
//
// Every method is exported on purpose. Exporting only GET would leave a POST to
// an unknown path hitting SvelteKit's own 405 instead of this 404, which is the
// wrong answer (the path does not exist; the method is not the problem).
import { json } from "@sveltejs/kit";
import { apiErrorBody } from "$lib/server/api/errors";
import type { RequestHandler } from "./$types";

const notFound: RequestHandler = async ({ params, locals }) => {
  return json(
    apiErrorBody({
      status: 404,
      code: "unknown_endpoint",
      message: `No API endpoint at /api/${params.path ?? ""}. See the OpenAPI document at /api/openapi.json for the routes this deployment serves.`,
      requestId: locals.request_id ?? null,
    }),
    { status: 404 },
  );
};

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
