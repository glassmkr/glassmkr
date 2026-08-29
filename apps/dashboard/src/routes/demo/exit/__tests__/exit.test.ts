import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/self-hosted", () => ({ SELF_HOSTED: false }));

import { GET } from "../+server";

// Leaving the demo must never take a real account with it. Before the demo had
// its own cookie, "Exit demo" was a link to the logout route, which cleared the
// shared session cookie on the parent domain. These pin the condition that
// replaced it, in both directions.
function fakeEvent(customer: { isDemo: boolean } | null) {
  const deleted: Array<{ name: string; domain?: string }> = [];
  return {
    deleted,
    event: {
      cookies: {
        delete: (name: string, opts: { path: string; domain?: string }) =>
          deleted.push({ name, domain: opts.domain }),
      },
      locals: { customer },
    },
  };
}

async function run(customer: { isDemo: boolean } | null) {
  const { deleted, event } = fakeEvent(customer);
  // The handler always redirects, which SvelteKit models as a throw.
  await expect(GET(event as never)).rejects.toBeTruthy();
  return deleted.map((d) => d.name);
}

describe("exiting the demo", () => {
  it("always drops the demo cookie", async () => {
    expect(await run({ isDemo: true })).toContain("glassmkr_demo");
  });

  it("clears a demo-shaped guardian_token, so pre-change visitors can leave", async () => {
    // Anyone who entered the demo before the split holds their demo token in
    // guardian_token; clearing only the new cookie would strand them.
    expect(await run({ isDemo: true })).toContain("guardian_token");
  });

  it("leaves guardian_token alone for a real session", async () => {
    const names = await run({ isDemo: false });
    expect(names).toContain("glassmkr_demo");
    expect(names).not.toContain("guardian_token");
  });

  it("leaves guardian_token alone when no session resolved at all", async () => {
    // Fails safe: an unverifiable token in that slot is not proof of a demo
    // session, so it is not something this route gets to delete.
    const names = await run(null);
    expect(names).toContain("glassmkr_demo");
    expect(names).not.toContain("guardian_token");
  });
});
