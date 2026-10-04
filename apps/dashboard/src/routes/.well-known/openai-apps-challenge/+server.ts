// OpenAI app submission domain check: OpenAI fetches this path and expects the
// verification token it issued, as plain text. The token comes from the
// OPENAI_APPS_CHALLENGE env var; with it unset the path does not exist.
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(token, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
