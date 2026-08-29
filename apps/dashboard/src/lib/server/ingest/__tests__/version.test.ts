import { describe, it, expect } from "vitest";
import { parseVersion, classifyRelease, isNotifiableRelease } from "../version";

describe("parseVersion", () => {
  it("strips leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
  });
  it("parses bare version", () => {
    expect(parseVersion("0.6.1")).toEqual([0, 6, 1]);
  });
});

describe("classifyRelease", () => {
  it("major on minor version bump (0.X.0)", () => {
    expect(classifyRelease("0.5.1", "0.6.0")).toBe("major");
    expect(classifyRelease("0.3.2", "0.4.0")).toBe("major");
  });
  it("major on major version bump (X.0.0)", () => {
    expect(classifyRelease("0.6.1", "1.0.0")).toBe("major");
  });
  it("patch on patch bump (0.0.X)", () => {
    expect(classifyRelease("0.6.0", "0.6.1")).toBe("patch");
    expect(classifyRelease("0.6.3", "0.6.4")).toBe("patch");
  });
  it("none when already current", () => {
    expect(classifyRelease("0.6.1", "0.6.1")).toBe("none");
    expect(classifyRelease("0.6.0", "0.6.0")).toBe("none");
  });
  it("none when current is ahead", () => {
    expect(classifyRelease("0.7.0", "0.6.0")).toBe("none");
    expect(classifyRelease("0.6.5", "0.6.4")).toBe("none");
  });
});

describe("classifyRelease: notified-version baseline (regression for 0.8.0 -> 0.8.1 mislabel)", () => {
  // The Telegram notification at the ingest endpoint anchors releaseType
  // to the customer's previously-notified version (`crucible_version_notified`)
  // when one exists, not to the agent's actual collector_version. This
  // ensures the label reflects "what changed since we last told you"
  // rather than "what changed since your stale agent shipped".
  it("0.7.1 -> 0.8.0 still classifies as major (first notification, baseline = collector)", () => {
    expect(classifyRelease("0.7.1", "0.8.0")).toBe("major");
  });
  it("0.8.0 -> 0.8.1 classifies as patch (baseline = previously-notified version)", () => {
    // Even if the agent is still on 0.7.1 (hasn't restarted), the
    // notification is anchored on the previous notification at 0.8.0.
    expect(classifyRelease("0.8.0", "0.8.1")).toBe("patch");
  });
  it("0.8.1 -> 0.9.0 classifies as major", () => {
    expect(classifyRelease("0.8.1", "0.9.0")).toBe("major");
  });
});

describe("isNotifiableRelease (legacy compat)", () => {
  it("returns true for both major and patch releases", () => {
    expect(isNotifiableRelease("0.5.1", "0.6.0")).toBe(true);
    expect(isNotifiableRelease("0.6.0", "0.6.1")).toBe(true);
  });
  it("returns false when current", () => {
    expect(isNotifiableRelease("0.6.1", "0.6.1")).toBe(false);
  });
});
