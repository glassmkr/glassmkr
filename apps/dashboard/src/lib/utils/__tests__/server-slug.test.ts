// Tests for the shared server-slug builder.
//
// Regression coverage for the 2026-05-20 bug where
// trend-warnings/+page.svelte linked to /servers/{server_id} (plural
// path + raw ID) producing a 404. The fix routes through this helper
// so both the link-emitter and the [slug]/+page.svelte resolver use
// the same shape.

import { describe, expect, it } from "vitest";

import {
  toServerSlug,
  isSlugAmbiguous,
  serverLinkPath,
  resolveServerBySlug,
} from "../server-slug";

describe("toServerSlug", () => {
  it("prefers hostname when present", () => {
    expect(
      toServerSlug({ hostname: "glassmkr-val-supermicro-h12sst", name: "alt", id: "srv_x" }),
    ).toBe("glassmkr-val-supermicro-h12sst");
  });

  it("falls back to name when hostname missing", () => {
    expect(toServerSlug({ hostname: null, name: "MyServer", id: "srv_x" })).toBe("myserver");
  });

  it("falls back to id when both hostname and name missing (underscores in id become dashes)", () => {
    expect(toServerSlug({ id: "srv_x" })).toBe("srv-x");
  });

  it("lowercases and strips non-[a-z0-9-] characters", () => {
    expect(toServerSlug({ hostname: "Host.Name_With Spaces" })).toBe("host-name-with-spaces");
  });

  it("returns empty string on entirely empty input", () => {
    expect(toServerSlug({})).toBe("");
  });

  it("matches the regression case: glassmkr-val-supermicro-h12sst", () => {
    // The exact value from the 2026-05-20 screenshot bug report.
    expect(toServerSlug({ hostname: "glassmkr-val-supermicro-h12sst" })).toBe(
      "glassmkr-val-supermicro-h12sst",
    );
  });
});

// Duplicate-hostname handling, added 2026-07-29.
//
// Real case: rebuilding web-01 left a dead `crucible-web-01-debian` record
// alongside the live `crucible-web-01-ubuntu`, both with hostname
// `web-01`. Both dashboard rows therefore linked to /server/web-01 and the
// resolver's find() took whichever came back first, so one record had NO reachable
// URL (it could not be inspected or deleted) and the page shown for that hostname
// depended on array order. The live twin happened to win, but had the order flipped
// the page would have shown 191-hour-stale data for a healthy machine.
describe("duplicate hostname slugs", () => {
  const ghost = { id: "srv_ghost", hostname: "web-01", name: "crucible-web-01-debian", last_seen_at: "2026-07-21T20:22:06.154Z" };
  const live = { id: "srv_live", hostname: "web-01", name: "crucible-web-01-ubuntu", last_seen_at: "2026-07-29T19:46:16.857Z" };
  const other = { id: "srv_other", hostname: "web-02", name: "crucible-web-02-rocky", last_seen_at: "2026-07-29T19:45:00.000Z" };
  const fleet = [live, ghost, other];

  it("flags a slug shared by two servers, and does not flag a unique one", () => {
    expect(isSlugAmbiguous(live, fleet)).toBe(true);
    expect(isSlugAmbiguous(ghost, fleet)).toBe(true);
    expect(isSlugAmbiguous(other, fleet)).toBe(false);
  });

  it("links a colliding server by id so BOTH records are reachable", () => {
    // The load-bearing assertion: before this, these two returned the same path.
    expect(serverLinkPath(live, fleet)).toBe("/server/srv_live");
    expect(serverLinkPath(ghost, fleet)).toBe("/server/srv_ghost");
    expect(serverLinkPath(live, fleet)).not.toBe(serverLinkPath(ghost, fleet));
  });

  it("keeps the readable slug when the hostname is unique", () => {
    expect(serverLinkPath(other, fleet)).toBe("/server/web-02");
  });

  it("resolves a raw id, so serverLinkPath's id form works", () => {
    expect(resolveServerBySlug("srv_ghost", fleet).server?.id).toBe("srv_ghost");
    expect(resolveServerBySlug("srv_ghost", fleet).ambiguous).toBe(false);
  });

  it("resolves an ambiguous hostname to the MOST RECENTLY SEEN record, not the first", () => {
    // `ghost` is deliberately listed before `live` here: the old find() would have
    // returned the dead record and shown stale data for a healthy host.
    const arrayGhostFirst = [ghost, live, other];
    const r = resolveServerBySlug("web-01", arrayGhostFirst);
    expect(r.server?.id).toBe("srv_live");
    expect(r.ambiguous).toBe(true);
  });

  it("resolves a unique hostname without flagging ambiguity", () => {
    const r = resolveServerBySlug("web-02", fleet);
    expect(r.server?.id).toBe("srv_other");
    expect(r.ambiguous).toBe(false);
  });

  it("returns null for an unknown slug rather than a wrong server", () => {
    expect(resolveServerBySlug("does-not-exist", fleet).server).toBeNull();
  });

  it("treats a missing last_seen_at as oldest rather than crashing", () => {
    const never = { id: "srv_never", hostname: "web-01", name: "never-connected", last_seen_at: null };
    const r = resolveServerBySlug("web-01", [never, live]);
    expect(r.server?.id).toBe("srv_live");
    expect(r.ambiguous).toBe(true);
  });
});
