// scope: public
// The conventional path, redirecting to the canonical one.
//
// The document lives at /api/openapi.json, which is correct: it describes the
// API and sits beside it. But /openapi.json is where a client looks first,
// because that is the convention, and it answered 404. An agent that guesses
// the conventional path and gets nothing concludes there is no machine
// contract, which is the opposite of true.
//
// 308 rather than 302 so the method and body are preserved and the redirect is
// cacheable as permanent: the canonical location is not going to move.
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const CANONICAL = "/api/openapi.json";

export const GET: RequestHandler = async () => {
  throw redirect(308, CANONICAL);
};

// HEAD too: a client probing for existence before fetching should get the same
// answer as one that fetches.
export const HEAD: RequestHandler = async () => {
  throw redirect(308, CANONICAL);
};
