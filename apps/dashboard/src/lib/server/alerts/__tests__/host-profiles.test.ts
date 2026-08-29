import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOST_PROFILES, HOST_PROFILE_IDS, profileSuppressedRules, suggestMarketplaceProfile } from "../host-profiles";

describe("host-profiles", () => {
  it("marketplace_gpu suppresses the expected-by-design marketplace rules", () => {
    expect(profileSuppressedRules("marketplace_gpu")).toEqual([
      "no_firewall",
      "unattended_upgrades_disabled",
      "kernel_vulnerabilities",
      "gpu_power_cap_throttling",
      "io_pressure_high",
      "cpu_iowait_high",
      "disk_fill_projection",
    ]);
  });

  it("returns no suppressions for null, undefined, or an unknown profile", () => {
    expect(profileSuppressedRules(null)).toEqual([]);
    expect(profileSuppressedRules(undefined)).toEqual([]);
    expect(profileSuppressedRules("not_a_profile")).toEqual([]);
  });

  it("every profile id resolves to a profile carrying a suppressed_rules array", () => {
    expect(HOST_PROFILE_IDS.length).toBeGreaterThan(0);
    for (const id of HOST_PROFILE_IDS) {
      expect(HOST_PROFILES[id]).toBeDefined();
      expect(Array.isArray(HOST_PROFILES[id].suppressed_rules)).toBe(true);
      expect(HOST_PROFILES[id].suppressed_rules.length).toBeGreaterThan(0);
    }
  });

  it("every suppressed rule id is a real rule (matches a rules/<id>.yaml)", () => {
    // Guards against a typo in a profile silently suppressing nothing.
    const rulesDir = fileURLToPath(new URL("../rules", import.meta.url));
    const ruleIds = new Set(
      readdirSync(rulesDir)
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => f.replace(/\.yaml$/, "")),
    );
    for (const id of HOST_PROFILE_IDS) {
      for (const rule of HOST_PROFILES[id].suppressed_rules) {
        expect(ruleIds.has(rule), `profile "${id}" suppresses unknown rule "${rule}"`).toBe(true);
      }
    }
  });
});

describe("suggestMarketplaceProfile", () => {
  it("suggests marketplace_gpu for a vast-tagged host with no profile", () => {
    expect(suggestMarketplaceProfile(["vast", "datapacket"], null)).toBe("marketplace_gpu");
    expect(suggestMarketplaceProfile(["VAST"], null)).toBe("marketplace_gpu"); // case-insensitive
    expect(suggestMarketplaceProfile(["marketplace"], undefined)).toBe("marketplace_gpu");
  });

  it("does not suggest when a profile is already set", () => {
    expect(suggestMarketplaceProfile(["vast"], "marketplace_gpu")).toBeNull();
    expect(suggestMarketplaceProfile(["vast"], "general")).toBeNull();
  });

  it("does not suggest for non-marketplace or missing tags", () => {
    expect(suggestMarketplaceProfile(["prod", "web"], null)).toBeNull();
    expect(suggestMarketplaceProfile([], null)).toBeNull();
    expect(suggestMarketplaceProfile(null, null)).toBeNull();
    expect(suggestMarketplaceProfile(undefined, null)).toBeNull();
  });
});
