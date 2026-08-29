export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable error code from the response body when present.
     *  Useful for branching UI flows (e.g. `reauth_required` →
     *  prompt for password) without parsing the human-readable
     *  message. */
    public code?: string,
  ) {
    super(message);
  }
}

/** Typed fetch wrapper for internal API calls. Includes credentials and JSON headers. */
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Dashboard routes emit two error shapes:
    //   - App routes: { error: "<code>", message: "<human>" }
    //   - SvelteKit's `error(status, {...})` helper: { message: "..." }
    //     with no top-level `error` field.
    // Prefer the human message, fall back to the code, then a generic.
    const message = body.message || body.error || "Request failed";
    throw new ApiError(res.status, message, body.error);
  }
  return res.json();
}
