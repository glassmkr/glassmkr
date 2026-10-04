import { describe, expect, it } from "vitest";
import { FALLBACK_LATEST } from "$lib/server/version.js";
import { monitoringSetup, renderSetupText, setupOutputSchema, type SetupResult } from "../setup.js";

const COMMERCIAL = /\b(price|pricing|free|trial|plans?|tier|upgrade|discount|subscription|billing)\b|node[- ]cap|10[- ]node|retention/i;

function commands(r: SetupResult): string[] {
  return r.steps.flatMap((s) => s.commands);
}

function valid(r: SetupResult): SetupResult {
  const parsed = setupOutputSchema.safeParse(r);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return r;
}

const CASES: Array<[string, Parameters<typeof monitoringSetup>[0]]> = [
  ["hosted, ubuntu", { target: "hosted", distro: "ubuntu" }],
  ["hosted, rocky", { target: "hosted", distro: "rocky" }],
  ["hosted, alpine", { target: "hosted", distro: "alpine" }],
  ["hosted, unspecified", { target: "hosted" }],
  ["self-hosted, debian", { target: "self_hosted", distro: "debian" }],
  ["self-hosted, arch", { target: "self_hosted", distro: "arch" }],
];

describe("monitoringSetup: rules that hold for every variant", () => {
  it.each(CASES)("%s", (_label, input) => {
    const r = valid(monitoringSetup(input));
    const all = JSON.stringify(r) + renderSetupText(r);

    // No pricing, plan, free-tier or node-cap text, and no em-dashes.
    expect(all).not.toMatch(COMMERCIAL);
    expect(all).not.toContain("\u2014");
    // Alpine gets no install commands at all (R3-20).
    if (input.distro === "alpine") return;

    // The key is never placed on a command line: no literal key argument, and
    // every init reads it from stdin.
    for (const cmd of commands(r)) {
      expect(cmd).not.toMatch(/--api-key\s+(?!-(\s|$))/);
      expect(cmd).not.toMatch(/gmk_(cru|acct)_live_[A-Za-z0-9]/);
    }
    expect(commands(r)).toContain("read -rs GLASSMKR_API_KEY && export GLASSMKR_API_KEY");
    expect(commands(r)).toContain("unset GLASSMKR_API_KEY");
    expect(r.key_handling).toContain("Never paste an API key");

    // Docs links carry the attribution ref.
    expect(r.docs.length).toBeGreaterThan(0);
    for (const d of r.docs) expect(d.url).toMatch(/^https:\/\/glassmkr\.com\/docs\/[a-z-]+\?ref=mcp-triage$/);
    expect(r.source_url).toBe("https://github.com/glassmkr/crucible");

    expect(r.verify.map((v) => v.command)).toEqual([
      "sudo systemctl status glassmkr-crucible --no-pager",
      `sudo journalctl -u glassmkr-crucible --since "5 min ago" --no-pager`,
    ]);
  });
});

describe("monitoringSetup: install path per distro family", () => {
  it("uses the one-line installer with the key carried in the environment on apt and dnf hosts", () => {
    for (const distro of ["ubuntu", "debian", "rhel", "almalinux"]) {
      const r = monitoringSetup({ target: "hosted", distro });
      expect(commands(r)).toContain("curl -fsSL https://glassmkr.com/install.sh | sudo -E bash");
      expect(commands(r).some((c) => c.includes("releases/download"))).toBe(false);
    }
  });

  it("uses the checksummed single-file binary where install.sh has no package manager to use", () => {
    const r = monitoringSetup({ target: "hosted", distro: "arch" });
    expect(r.distro_family).toBe("other");
    const cmds = commands(r);
    expect(cmds).not.toContain("curl -fsSL https://glassmkr.com/install.sh | sudo -E bash");
    expect(cmds).toContain(`curl -fsSLO https://github.com/glassmkr/crucible/releases/download/v${FALLBACK_LATEST}/glassmkr-crucible-linux-x64`);
    expect(cmds).toContain("sha256sum --ignore-missing -c SHA256SUMS");
    expect(cmds).toContain(`printf '%s' "$GLASSMKR_API_KEY" | sudo glassmkr-crucible init --api-key -`);
  });

  it("offers both paths when the distro is unknown", () => {
    const r = monitoringSetup({ target: "hosted" });
    expect(r.distro_family).toBe("unspecified");
    expect(commands(r)).toContain("curl -fsSL https://glassmkr.com/install.sh | sudo -E bash");
    expect(commands(r).some((c) => c.includes("releases/download"))).toBe(true);
  });

  it("does not claim installer support for distributions install.sh does not name", () => {
    const r = monitoringSetup({ target: "hosted", distro: "rhel" });
    const installer = r.steps.find((s) => s.commands.some((c) => c.includes("install.sh")))!;
    expect(installer.detail).toContain("Debian, Ubuntu, RHEL, Rocky, AlmaLinux, CentOS, Fedora");
    expect(installer.detail).not.toMatch(/Arch|Alpine|SUSE/);
  });
});

describe("monitoringSetup: hosted vs self-hosted", () => {
  it("hosted points at app.glassmkr.com and the getting-started docs", () => {
    const r = monitoringSetup({ target: "hosted", distro: "ubuntu" });
    expect(r.steps[0].detail).toContain("https://app.glassmkr.com");
    expect(r.docs[0].url).toBe("https://glassmkr.com/docs/getting-started?ref=mcp-triage");
    expect(JSON.stringify(r)).not.toContain("GLASSMKR_INGEST_URL");
  });

  it("self-hosted runs the stack first and points the agent at the operator's ingest URL", () => {
    const r = monitoringSetup({ target: "self_hosted", distro: "debian" });
    expect(r.steps[0].commands).toEqual([
      "git clone https://github.com/glassmkr/glassmkr.git",
      "cd glassmkr",
      "cp env.selfhost.example .env",
      "./scripts/selfhost-setup.sh",
      "docker compose up -d",
    ]);
    expect(commands(r)).toContain(`export GLASSMKR_INGEST_URL="http://your-dashboard-host:3000/api/v1/ingest"`);
    expect(r.docs.map((d) => d.title)).toContain("Self-hosting");
    const arch = monitoringSetup({ target: "self_hosted", distro: "arch" });
    expect(commands(arch).some((c) => c.includes("--ingest-url http://your-dashboard-host:3000/api/v1/ingest --allow-endpoint-origin http://your-dashboard-host:3000"))).toBe(true);
  });
});

describe("key handling copy", () => {
  it("does not promise the key stays out of the process list (install.sh passes it to init as an argument)", () => {
    for (const target of ["hosted", "self_hosted"] as const) {
      const r = monitoringSetup({ target });
      const all = JSON.stringify(r);
      expect(all).not.toMatch(/process list/i);
      expect(r.key_handling).toContain("does not enter shell history");
    }
  });
});

// R2-15: the text block carried step titles and commands only, so a
// content-only client could not say where the key comes from, what to install
// first, or what a working agent prints.
describe("renderSetupText carries every field (R2-15)", () => {
  function leaves(v: unknown, out: string[] = []): string[] {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) leaves(x, out);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "target" && k !== "distro_family") leaves(x, out);
    return out;
  }
  it.each(CASES)("%s", (_label, input) => {
    const r = monitoringSetup(input);
    const text = renderSetupText(r);
    for (const s of leaves(r)) expect(text, s).toContain(s);
  });

  it("names where the key comes from and what a working agent prints", () => {
    const text = renderSetupText(monitoringSetup({ target: "hosted", distro: "debian" }));
    expect(text).toContain("https://app.glassmkr.com");
    expect(text).toContain("gmk_cru_live_");
    expect(text).toContain("smartmontools and ipmitool");
    expect(text).toContain("active (running)");
    expect(text).toContain("Push successful");
  });
});

// R2-20: compose publishes the dashboard on 127.0.0.1 unless DASHBOARD_BIND is
// set, so agents on other hosts following the steps could never connect.
describe("self-hosted steps make the dashboard reachable from other hosts (R2-20)", () => {
  it("sets DASHBOARD_BIND or a reverse proxy before the setup script runs", () => {
    const r = monitoringSetup({ target: "self_hosted", distro: "debian" });
    const stack = r.steps[0];
    expect(stack.detail).toMatch(/DASHBOARD_BIND/);
    expect(stack.detail).toMatch(/127\.0\.0\.1/);
    expect(stack.detail).toMatch(/reverse proxy/);
    const setupAt = stack.commands.indexOf("./scripts/selfhost-setup.sh");
    expect(setupAt).toBeGreaterThan(-1);
    const install = r.steps.find((s) => s.commands.some((c) => c.includes("GLASSMKR_INGEST_URL")))!;
    expect(install.detail).toMatch(/the address you set in DASHBOARD_BIND|DASHBOARD_PUBLIC_URL/);
  });
});

// R3-20: the release binary is linked against glibc and init installs a
// systemd unit; Alpine has musl and OpenRC, so every command the tool gave
// for it failed.
describe("Alpine is not offered an install path that cannot work (R3-20)", () => {
  it("says the installer and the binary do not support Alpine, with no commands to try", () => {
    const r = valid(monitoringSetup({ target: "hosted", distro: "alpine" }));
    expect(commands(r)).toEqual([]);
    expect(r.verify).toEqual([]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].title).toBe("No packaged install for Alpine Linux");
    expect(r.steps[0].detail).toMatch(/glibc/);
    expect(r.steps[0].detail).toMatch(/systemd/);
    expect(renderSetupText(r)).not.toMatch(/systemctl|sha256sum/);
  });

  // R4-8: ground-truth.yaml keeps runtime support (Alpine listed) apart from
  // install-path support; the wording said the agent itself does not run
  // there, and "yet" promised a future the sources do not.
  it("scopes the claim to the install paths and promises nothing", () => {
    const step = monitoringSetup({ target: "hosted", distro: "alpine" }).steps[0];
    expect(`${step.title} ${step.detail}`).not.toMatch(/\byet\b|agent does not run|not supported/i);
    expect(step.detail).toMatch(/one-line installer and the single-file binary do not support Alpine/);
  });

  it("the binary step no longer names Alpine", () => {
    for (const distro of ["arch", undefined]) {
      const binary = monitoringSetup({ target: "hosted", distro }).steps.find((s) => s.commands.some((c) => c.includes("releases/download")))!;
      expect(binary.detail).not.toMatch(/Alpine/);
      expect(binary.detail).toMatch(/glibc and systemd/);
    }
  });
});

// R3-21: the one-line installer adds Node.js only when no node is on PATH;
// an older distro node makes init stop with a version error.
describe("the Node.js prerequisite (R3-21)", () => {
  it("says an older node on PATH has to be upgraded first", () => {
    const r = monitoringSetup({ target: "hosted", distro: "ubuntu" });
    const node = r.prerequisites.find((p) => /Node\.js/.test(p))!;
    expect(node).not.toMatch(/only if you install with npm/);
    expect(node).toMatch(/only when no node is installed/);
    const installer = r.steps.find((s) => s.commands.some((c) => c.includes("install.sh")))!;
    expect(installer.detail).toMatch(/adds Node\.js 24 only when no node is installed/);
    expect(installer.detail).not.toMatch(/if it is missing/);
  });
});
