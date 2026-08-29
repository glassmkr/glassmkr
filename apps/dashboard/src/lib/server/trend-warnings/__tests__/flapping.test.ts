import { describe, it, expect } from "vitest";
import { clusterFires, classifyFlapping, flapStatToFinding } from "../flapping";

const min = (m: number) => m * 60_000;

describe("clusterFires", () => {
  it("groups fires within the gap into one cluster and splits on a quiet gap", () => {
    // two fires 5 min apart (same cluster), then one 60 min later (new cluster)
    const clusters = clusterFires([min(0), min(5), min(65)]);
    expect(clusters.length).toBe(2);
    expect(clusters[0]).toEqual([min(0), min(5)]);
    expect(clusters[1]).toEqual([min(65)]);
  });

  it("collapses a dense burst with no quiet gaps into a single cluster", () => {
    // a chronic alert that logged every 5 min for 2h (pre-B-1 flood shape):
    // no gap exceeds 10 min, so it is ONE cluster, not flapping.
    const dense = Array.from({ length: 25 }, (_, i) => min(i * 5));
    expect(clusterFires(dense).length).toBe(1);
  });
});

describe("classifyFlapping", () => {
  it("flags >=3 separated clusters and computes cadence", () => {
    const ts = [min(0), min(5), min(60), min(120)]; // clusters at 0, 60, 120
    const stat = classifyFlapping("gpu_pcie_link_degraded", ts);
    expect(stat).not.toBeNull();
    expect(stat!.clusters).toBe(3);
    expect(stat!.episodes).toBe(4);
    expect(stat!.cadence_min).toBe(60); // starts 0,60,120 -> mean gap 60 min
  });

  it("does NOT flag a chronic single cluster (always-firing alert)", () => {
    const dense = Array.from({ length: 25 }, (_, i) => min(i * 5));
    expect(classifyFlapping("gpu_power_cap_throttling", dense)).toBeNull();
  });

  it("does NOT flag fewer than 3 clusters", () => {
    expect(classifyFlapping("disk_latency_high", [min(0), min(60)])).toBeNull();
  });

  it("returns null on an empty stream", () => {
    expect(classifyFlapping("x", [])).toBeNull();
  });
});

describe("flapStatToFinding", () => {
  it("builds a medium host-resource finding keyed on the rule", () => {
    const stat = classifyFlapping("gpu_pcie_link_degraded", [min(0), min(30), min(60)])!;
    const f = flapStatToFinding(stat, "datapacketvastlistings-2");
    expect(f.type).toBe("alert_flapping");
    expect(f.severity).toBe("medium");
    expect(f.resource.kind).toBe("host");
    // resource.name = the rule, so persistence keys one warning per (host, rule)
    expect(f.resource.name).toBe("gpu_pcie_link_degraded");
    expect(f.evidence_summary).toContain("datapacketvastlistings-2");
    expect(f.evidence_summary).toContain("3 separate times");
  });
});
