// Continuous-monitoring setup steps for the get_monitoring_setup tool.
//
// Source of truth, in this order: apps/site/static/install.sh (what the
// one-line installer really does and which package managers it supports), then
// the getting-started, automated-onboarding and self-hosting docs pages. When
// those change, this file changes with them.
//
// Key handling is the one hard rule: no step puts a key on a command line the
// user types or asks for it in the chat. The installer reads GLASSMKR_API_KEY
// from the environment (`sudo -E` keeps it across sudo) and `glassmkr-crucible
// init --api-key -` reads it from stdin, so the key is entered once at a hidden
// prompt on the server and never lands in shell history or the conversation.
// Do not promise more than that: install.sh itself passes the key to
// `glassmkr-crucible init --api-key "$API_KEY"`, so on the installer path it is
// briefly visible in the process list while init runs.

import { z } from "zod";
import { FALLBACK_LATEST } from "$lib/server/version.js";
import { distroFamily, type DistroFamily } from "./capture.js";

export const SETUP_TARGETS = ["hosted", "self_hosted"] as const;
export type SetupTarget = (typeof SETUP_TARGETS)[number];

const REF = "?ref=mcp-triage";
const DOCS_GETTING_STARTED = `https://glassmkr.com/docs/getting-started${REF}`;
const DOCS_AUTOMATED = `https://glassmkr.com/docs/automated-onboarding${REF}`;
const DOCS_SELF_HOSTING = `https://glassmkr.com/docs/self-hosting${REF}`;
const SOURCE_URL = "https://github.com/glassmkr/crucible" as const;

const READ_KEY = "read -rs GLASSMKR_API_KEY && export GLASSMKR_API_KEY";
const UNSET_KEY = "unset GLASSMKR_API_KEY";
const SELF_HOSTED_INGEST = "http://your-dashboard-host:3000/api/v1/ingest";
const SELF_HOSTED_ORIGIN = "http://your-dashboard-host:3000";

const INSTALLER_FAMILIES =
  "apt and dnf/yum distributions (Debian, Ubuntu, RHEL, Rocky, AlmaLinux, CentOS, Fedora)";

interface SetupStep {
  title: string;
  detail: string;
  commands: string[];
}

export const setupOutputShape = {
  target: z.enum(SETUP_TARGETS),
  distro_family: z.enum(["apt", "dnf", "other", "unspecified"]),
  prerequisites: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      commands: z.array(z.string()),
    }).strict(),
  ),
  verify: z.array(
    z.object({
      command: z.string(),
      expect: z.string(),
    }).strict(),
  ),
  key_handling: z.string(),
  docs: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
    }).strict(),
  ),
  source_url: z.literal(SOURCE_URL),
};

export const setupOutputSchema = z.object(setupOutputShape).strict();
export type SetupResult = z.infer<typeof setupOutputSchema>;

function installerStep(target: SetupTarget): SetupStep {
  const commands = [READ_KEY];
  if (target === "self_hosted") {
    commands.push(`export GLASSMKR_INGEST_URL="${SELF_HOSTED_INGEST}"`);
  }
  commands.push("curl -fsSL https://glassmkr.com/install.sh | sudo -E bash", UNSET_KEY);
  return {
    title: "Install and start the agent with the one-line installer",
    detail:
      `For ${INSTALLER_FAMILIES}. The first command waits for you to paste the collector key and press Enter; the key is not echoed and does not enter shell history. ` +
      "The installer adds Node.js 24 if it is missing, installs smartmontools and ipmitool where available, installs @glassmkr/crucible, writes /etc/glassmkr/crucible.yaml (mode 0600) and starts the glassmkr-crucible service as the non-root glassmkr user." +
      (target === "self_hosted"
        ? " GLASSMKR_INGEST_URL points the agent at your own dashboard: replace the host and port with your DASHBOARD_PUBLIC_URL (the address you set in DASHBOARD_BIND, or your reverse proxy)."
        : ""),
    commands,
  };
}

function binaryStep(target: SetupTarget, family: DistroFamily): SetupStep {
  const base = `https://github.com/glassmkr/crucible/releases/download/v${FALLBACK_LATEST}`;
  const init = target === "self_hosted"
    ? `printf '%s' "$GLASSMKR_API_KEY" | sudo glassmkr-crucible init --api-key - --ingest-url ${SELF_HOSTED_INGEST} --allow-endpoint-origin ${SELF_HOSTED_ORIGIN}`
    : `printf '%s' "$GLASSMKR_API_KEY" | sudo glassmkr-crucible init --api-key -`;
  return {
    title: family === "unspecified"
      ? "Other distributions: install the single-file binary"
      : "Install the single-file binary",
    detail:
      `For distributions without apt or dnf (for example Arch or Alpine). The binary bundles its own runtime, so no Node.js is needed; use glassmkr-crucible-linux-arm64 on arm64. ` +
      "Install smartmontools and ipmitool with your package manager for SMART and IPMI data. init reads the collector key from stdin, validates it, writes /etc/glassmkr/crucible.yaml and installs the systemd unit.",
    commands: [
      `curl -fsSLO ${base}/glassmkr-crucible-linux-x64`,
      `curl -fsSLO ${base}/SHA256SUMS`,
      "sha256sum --ignore-missing -c SHA256SUMS",
      "sudo install -m 0755 glassmkr-crucible-linux-x64 /usr/local/bin/glassmkr-crucible",
      READ_KEY,
      init,
      UNSET_KEY,
    ],
  };
}

function keyStep(target: SetupTarget): SetupStep {
  if (target === "self_hosted") {
    return {
      title: "Create the server in your dashboard",
      detail:
        "Sign in to your dashboard, add a server and copy its collector key (it starts with gmk_cru_live_ and is shown once). Keep it on your machine; it is entered on the server in the next step, not in this chat.",
      commands: [],
    };
  }
  return {
    title: "Create the server in the Glassmkr dashboard",
    detail:
      "Sign in or sign up at https://app.glassmkr.com, click + Add Server, and copy the collector key (it starts with gmk_cru_live_ and is shown once). Keep it on your machine; it is entered on the server in the next step, not in this chat.",
    commands: [],
  };
}

// The compose file publishes the dashboard on 127.0.0.1 unless DASHBOARD_BIND
// says otherwise, so agents on other hosts, the normal case, could not reach
// the ingest URL these steps gave them (R2-20). SELF_HOSTING.md is the source.
const SELF_HOSTED_STACK: SetupStep = {
  title: "Run the dashboard on your own hardware",
  detail:
    "Starts the dashboard, Postgres and ClickHouse with Docker Compose; migrations apply on boot. Then open http://localhost:3000 and register the first account. " +
    "The dashboard is published on 127.0.0.1 only by default. If agents will run on other hosts, before running selfhost-setup.sh set DASHBOARD_BIND in .env to an address they can reach, or put a reverse proxy with TLS in front and set DASHBOARD_PUBLIC_URL to it; selfhost-setup.sh keeps DASHBOARD_PUBLIC_URL in step with DASHBOARD_BIND (re-run it after a change).",
  commands: [
    "git clone https://github.com/glassmkr/glassmkr.git",
    "cd glassmkr",
    "cp env.selfhost.example .env",
    "./scripts/selfhost-setup.sh",
    "docker compose up -d",
  ],
};

/** Install, enroll and verify steps for running Crucible continuously. */
export function monitoringSetup(input: { distro?: string | null; target: SetupTarget }): SetupResult {
  const target = input.target;
  const family = distroFamily(input.distro);

  const steps: SetupStep[] = [];
  if (target === "self_hosted") steps.push(SELF_HOSTED_STACK);
  steps.push(keyStep(target));
  if (family === "apt" || family === "dnf") {
    steps.push(installerStep(target));
  } else if (family === "other") {
    steps.push(binaryStep(target, family));
  } else {
    steps.push(installerStep(target), binaryStep(target, family));
  }

  const prerequisites = [
    "A Linux server with root or sudo access.",
    target === "self_hosted"
      ? "Outbound access from the server to your dashboard's ingest URL. No inbound ports on the monitored server."
      : "Outbound HTTPS (port 443) from the server to app.glassmkr.com. No inbound ports.",
    "Node.js 22.19.0 or newer only if you install with npm; the one-line installer adds Node.js 24 where it is missing, and the single-file binary needs no Node.js.",
    "smartmontools and ipmitool for SMART and IPMI data (the one-line installer adds them).",
  ];
  if (target === "self_hosted") {
    prerequisites.unshift("Docker with the compose plugin on the machine that will run the dashboard.");
  }

  const docs = [{ title: "Getting started", url: DOCS_GETTING_STARTED }];
  if (target === "self_hosted") docs.push({ title: "Self-hosting", url: DOCS_SELF_HOSTING });
  docs.push({ title: "Automated fleet onboarding", url: DOCS_AUTOMATED });

  return {
    target,
    distro_family: family,
    prerequisites,
    steps,
    verify: [
      {
        command: "sudo systemctl status glassmkr-crucible --no-pager",
        expect: "active (running)",
      },
      {
        command: `sudo journalctl -u glassmkr-crucible --since "5 min ago" --no-pager`,
        expect: "A \"Push successful\" line after the first collection. The server then appears on the dashboard within one collection interval (about five minutes).",
      },
    ],
    key_handling:
      "Never paste an API key or collector key into this chat. The commands read the key on the server at a hidden prompt, so it is not echoed, does not enter shell history, and never reaches this conversation.",
    docs,
    source_url: SOURCE_URL,
  };
}

/**
 * Plain-text rendering for the tool result's content block. Every field is in
 * it: clients that forward only content lost where the key comes from, the
 * prerequisites and what a working agent prints (R2-15).
 */
export function renderSetupText(result: SetupResult): string {
  const lines: string[] = ["Prerequisites:"];
  for (const p of result.prerequisites) lines.push(`- ${p}`);
  result.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title}`);
    lines.push(`   ${step.detail}`);
    for (const c of step.commands) lines.push(`   ${c}`);
  });
  lines.push("Verify:");
  for (const v of result.verify) {
    lines.push(`   ${v.command}`);
    lines.push(`   Expect: ${v.expect}`);
  }
  lines.push(result.key_handling);
  for (const d of result.docs) lines.push(`${d.title}: ${d.url}`);
  lines.push(`Agent source: ${result.source_url}`);
  return lines.join("\n");
}
