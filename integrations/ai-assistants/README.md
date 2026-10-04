# Glassmkr in AI assistants

Glassmkr runs an anonymous MCP server that ChatGPT, Claude and other MCP clients
can call when someone pastes Linux server hardware output into a conversation:

```
https://app.glassmkr.com/api/triage/mcp
```

Streamable HTTP, no sign-in, no account, no API key. It exposes three read-only
tools:

| Tool | What it does |
|---|---|
| `analyze_server_output` | Checks pasted `smartctl`, `zpool status`, `/proc/mdstat` or `mdadm --detail`, `dmesg` or `journalctl -k`, `ipmitool sel` and `nvidia-smi -q`, `nvidia-smi nvlink --status` or `nvidia-smi --query-gpu` CSV output against Glassmkr's alert rules (the same rule code the dashboard runs) and returns the findings, the rules that ran with no matching signal in this output, what one paste cannot determine, and the command to capture more. |
| `get_capture_command` | Returns the exact commands that produce output the analyzer can read, for a goal such as all disks, ZFS, mdadm RAID, kernel errors, GPUs or the BMC event log. |
| `get_monitoring_setup` | Returns the steps to install and enroll the open-source Crucible agent so the same rules run continuously. It never asks for a key; keys stay placeholders. |

The pasted text is processed in memory and not stored. A finding describes what
the paste shows; no finding means no matching signal in this output, not that
the hardware is healthy.

User documentation: https://glassmkr.com/docs/ai-assistants

## Try it now

You do not need the directory listings for any of these.

**ChatGPT (developer mode).** Settings, Security and login, turn on Developer
mode (availability depends on the account and workspace). Then open
`chatgpt.com/plugins`, press the plus button, name it "Glassmkr", enter the URL
above as the MCP server URL with no authentication, and create it. Install it from
your personal plugins, switch the home tab from Chat to Work, type `@`, pick
Glassmkr and paste some output.

**Claude (claude.ai, Claude Desktop).** Settings, Connectors, Add custom
connector, name it "Glassmkr", paste the URL above and leave the OAuth fields
empty. Menu labels may differ slightly between Claude versions.

**Claude Code.**

```
claude mcp add --transport http glassmkr-triage https://app.glassmkr.com/api/triage/mcp
```

**Any MCP client or a quick manual test.** Point it at the URL above as a
Streamable HTTP server with no auth, for example with the MCP Inspector:
`npx @modelcontextprotocol/inspector@latest`.

Something to paste:

```
Personalities : [raid1]
md0 : active raid1 sdb1[1](F) sda1[0]
      976630336 blocks super 1.2 [2/1] [U_]

unused devices: <none>
```

## This folder

| Path | Purpose |
|---|---|
| `openai-plugin/` | The package uploaded to OpenAI's plugin directory (ChatGPT and Codex): `plugin.json` (Agent Plugins format with the OpenAI listing, review cases and publication settings), `mcp.json` (the one remote server), `assets/` (icons rendered from `apps/site/static/favicon.svg`). |
| `REVIEW_TEST_CASES.md` | The 5 positive and 3 negative review cases, the starter prompts, and extra prompts for tuning. Mirrored into `plugin.json`. |
| `SUBMISSION_CHECKLIST.md` | Step-by-step submission for OpenAI and Anthropic, with paste-ready listing copy and the Cloudflare change the domain check needs. |
| `scripts/validate-openai-plugin.mjs` | Checks the package against the final-submission rules (limits, URLs, icons, copy rules, review cases). |
| `scripts/validate-openai-plugin.test.mjs` | Known-bad fixtures for that checker. |
| `scripts/build-openai-plugin-zip.sh` | Validates, then writes `dist/glassmkr-openai-plugin-<version>.zip`. |
| `mcp-registry/server.json` | The entry for the official MCP Registry (see below). Not published yet. |

```
node integrations/ai-assistants/scripts/validate-openai-plugin.test.mjs
bash integrations/ai-assistants/scripts/build-openai-plugin-zip.sh
```

The server itself lives in `apps/dashboard/src/lib/server/triage/` and
`apps/dashboard/src/routes/api/triage/mcp/`. OpenAI rescans a published
server daily and holds changed tool definitions until they pass its automated
checks, so keep tool schemas backward compatible. Changes to anything in
`openai-plugin/` need a new package version and a new OpenAI review.

## Official MCP Registry

`mcp-registry/server.json` is the remote server's entry for the official MCP
Registry, which marketplaces and aggregators read; it stores metadata only.
Its `version` is `TRIAGE_SERVER_VERSION` in `mcp-server.ts`: bump the two
together.

Publishing is Simon's step, not CI's, because the `com.glassmkr/*` namespace is
proven with a key only he holds:

1. Prove `glassmkr.com`, either with a DNS TXT record on the apex,
   `v=MCPv1; k=ed25519; p=<public key>`, or with the same line served at
   `https://glassmkr.com/.well-known/mcp-registry-auth` (it would go in
   `apps/site/static/.well-known/`).
2. From `mcp-registry/`, run `mcp-publisher login dns` (or `login http`) with
   `--domain glassmkr.com` and the private key, then `mcp-publisher publish`.
