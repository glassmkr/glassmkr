import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeToSlugCycle,
  lookupLifecycle,
  setLifecycleCache,
  __resetLifecycleCacheForTests,
  type LifecycleRow,
} from "../cache";

describe("normalizeToSlugCycle", () => {
  it("Ubuntu point release collapses to the YY.MM cycle", () => {
    expect(normalizeToSlugCycle("ubuntu", "24.04.1", "Ubuntu 24.04.1 LTS")).toEqual({
      product: "ubuntu",
      cycle: "24.04",
    });
    expect(normalizeToSlugCycle("ubuntu", "24.04", "Ubuntu")).toEqual({
      product: "ubuntu",
      cycle: "24.04",
    });
  });

  it("RHEL-family maps to the major cycle", () => {
    expect(normalizeToSlugCycle("rhel", "9.5", "Red Hat")).toEqual({ product: "rhel", cycle: "9" });
    expect(normalizeToSlugCycle("rocky", "9.5", "Rocky Linux 9.5")).toEqual({
      product: "rocky-linux",
      cycle: "9",
    });
    expect(normalizeToSlugCycle("almalinux", "10.0", "AlmaLinux")).toEqual({
      product: "almalinux",
      cycle: "10",
    });
  });

  it("distinguishes centos-stream from legacy centos by PRETTY_NAME", () => {
    expect(normalizeToSlugCycle("centos", "9", "CentOS Stream 9")).toEqual({
      product: "centos-stream",
      cycle: "9",
    });
    expect(normalizeToSlugCycle("centos", "7", "CentOS Linux 7 (Core)")).toEqual({
      product: "centos",
      cycle: "7",
    });
  });

  it("Amazon Linux 2 vs 2023 keep their idiosyncratic cycle", () => {
    expect(normalizeToSlugCycle("amzn", "2", "Amazon Linux 2")).toEqual({
      product: "amazon-linux",
      cycle: "2",
    });
    expect(normalizeToSlugCycle("amzn", "2023", "Amazon Linux 2023")).toEqual({
      product: "amazon-linux",
      cycle: "2023",
    });
  });

  it("SLES / openSUSE Leap keep the minor (service pack)", () => {
    expect(normalizeToSlugCycle("sles", "15.7", "SLES")).toEqual({ product: "sles", cycle: "15.7" });
    expect(normalizeToSlugCycle("opensuse-leap", "15.6", "openSUSE Leap")).toEqual({
      product: "opensuse",
      cycle: "15.6",
    });
  });

  it("Oracle Linux (os_id ol) maps to oracle-linux major", () => {
    expect(normalizeToSlugCycle("ol", "9.4", "Oracle Linux Server 9.4")).toEqual({
      product: "oracle-linux",
      cycle: "9",
    });
  });

  it("returns null for unmodelled distros or missing fields", () => {
    expect(normalizeToSlugCycle("arch", "rolling", "Arch")).toBeNull();
    expect(normalizeToSlugCycle("ubuntu", undefined, "Ubuntu")).toBeNull();
    expect(normalizeToSlugCycle(undefined, "24.04", "Ubuntu")).toBeNull();
  });
});

describe("lookupLifecycle", () => {
  beforeEach(() => __resetLifecycleCacheForTests());

  const rows: LifecycleRow[] = [
    { product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: "2029-05-31", eoes_from: "2036-04-25", is_lts: true },
    { product: "rocky-linux", cycle: "9", label: "9", eol_from: "2032-05-31", eoes_from: null, is_lts: false },
  ];

  it("returns a parsed record for a cached (product, cycle)", () => {
    setLifecycleCache(rows);
    const r = lookupLifecycle({ os_id: "ubuntu", os_version_id: "24.04.4", os: "Ubuntu 24.04.4 LTS" });
    expect(r?.product).toBe("ubuntu");
    expect(r?.cycle).toBe("24.04");
    expect(r?.eolFrom?.toISOString().slice(0, 10)).toBe("2029-05-31");
    expect(r?.eoesFrom?.toISOString().slice(0, 10)).toBe("2036-04-25");
    expect(r?.isLts).toBe(true);
  });

  it("returns null when the cache has no row for the cycle", () => {
    setLifecycleCache(rows);
    expect(lookupLifecycle({ os_id: "ubuntu", os_version_id: "18.04", os: "Ubuntu" })).toBeNull();
  });

  it("returns null when the cache is empty (cold start)", () => {
    expect(lookupLifecycle({ os_id: "ubuntu", os_version_id: "24.04", os: "Ubuntu" })).toBeNull();
  });
});
