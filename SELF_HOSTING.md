# Self-hosting Glassmkr

The whole stack runs on your hardware: the dashboard (AGPL-3.0), Postgres, and
ClickHouse, with the Crucible agent (MIT) reporting to your own URL. Nothing
phones home; there is no license key; every feature is enabled.

## Prerequisites

- Docker with the compose plugin (or a Postgres 16 + ClickHouse 24 you operate
  yourself; the app is configured entirely by environment variables).

  On Debian and Ubuntu the convenience script works:

  ```
  curl -fsSL https://get.docker.com | sh
  ```

  On RHEL-family distributions use Docker's own repository instead. The
  convenience script refuses AlmaLinux outright and does not reliably resolve
  packages on current Rocky point releases:

  ```
  sudo dnf -y install dnf-plugins-core
  sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  ```
- 2 GB RAM is comfortable for a small fleet; ClickHouse is the hungriest part.
- Linux hosts to monitor, with Node 22.19.0+ for the npm agent install (the
  binary install needs no Node at all).
- Headroom on the monitored hosts for the agent itself. Measured on a two-disk
  Supermicro running Rocky 9.8: 40 samples over 20 minutes, spanning four
  collection cycles, gave 77 to 82 MB resident with a high-water mark of 103 MB
  that did not move during the run. Budget around 150 MB and you have room.
  Hosts with more disks and sensors to enumerate will sit higher, because the
  cost scales with what there is to walk.

## Quickstart

```
git clone https://github.com/glassmkr/glassmkr.git
cd glassmkr
cp env.selfhost.example .env
./scripts/selfhost-setup.sh     # generates the secrets
docker compose up -d
```

Then open http://localhost:3000, register the first account, and you are on the
dashboard.

If your agents will run on other hosts, which is the normal case, two settings
have to agree before you enrol any of them. `DASHBOARD_BIND` decides which
address the dashboard port is published on, and it is loopback by default for
the reason described below. `DASHBOARD_PUBLIC_URL` is the address this dashboard
hands to every agent as its ingest URL. Set `DASHBOARD_BIND` (or put a reverse
proxy in front and set `DASHBOARD_PUBLIC_URL` to the proxy address), then re-run
`./scripts/selfhost-setup.sh`, which keeps the two in step and prints what it
chose.

Getting this wrong fails quietly in both directions: an advertised address that
nothing serves leaves the agent logging `Push failed, will retry next cycle`,
and a `localhost` default on a multi-host install tells every agent to push to
its own loopback.

The dashboard binds to loopback by default. Docker publishes ports straight
past ufw and firewalld, so binding to every interface would put a fresh
dashboard on the public internet even on a box whose firewall looks closed. To
reach it from elsewhere, put a reverse proxy with TLS in front (the normal
production shape), or set `DASHBOARD_BIND` to an address you intend to serve
on. `GLASSMKR_SELF_HOSTED=1` is set by the compose file: no plans, no node
limits, no billing. The programmatic API is on. The AI analysis hook is on as
soon as you set `LLM_API_URL`. The MCP server ships in the box but needs
turning on; see below.

### The MCP server

The MCP server is included, not enabled by default, because it cannot run on
the stack exactly as shipped: its OAuth authorization server refuses a
non-HTTPS origin whenever `NODE_ENV` is `production`, which the compose file
sets. So it needs a reverse proxy with TLS in front, and then:

```
MCP_PUBLIC_ORIGIN=https://your-dashboard-host
MCP_OAUTH_TOKEN_PEPPER=<at least 32 bytes, generate once and keep>
MCP_OAUTH_ENABLED=1
MCP_READ_ENABLED=1
MCP_WRITE_ENABLED=1      # optional, adds the mutating tools
```

Leave `MCP_ADMIN_ENABLED` unset unless you specifically want the destructive
tools. Without a pepper of at least 32 bytes the server refuses to start the
OAuth paths rather than hashing tokens with a weak one, which is the behaviour
you want.

One caveat, stated because it has not been proven rather than because it is
known to fail: the OAuth flow has been exercised against the hosted origin, not
against a self-hosted one. The origin check accepts any HTTPS origin, so there
is no known reason it would not work behind your own TLS, but nobody has run it
end to end on a self-hosted hostname yet. If you try it, the maintainer would
genuinely like to hear how it went.

### Closing registration

A fresh instance accepts signups, because the first thing you do is register
your own account. Once it exists, make the instance single-tenant:

```
GLASSMKR_DISABLE_REGISTRATION=1
```

Then `docker compose up -d` to pick it up. `true` and `yes` work too, and the
value is case-insensitive; anything else leaves registration open rather than
guessing.

This closes every path that CREATES an account, not just the password form: if
you have configured GitHub or Google sign-in, an unrecognised provider identity
is refused as well, which would otherwise hand an account to anyone who could
click the button. Signing in to an account that already exists is unaffected,
so this closes the door without locking anyone out. Set it before you expose
the dashboard beyond loopback.

Migrations run automatically: ClickHouse's on every `up` (they are idempotent),
Postgres's from the dashboard container before the app starts (tracked, so only
new ones apply).

## Pointing an agent at your dashboard

Create the server in your dashboard (or via `POST /api/v1/servers` with a
write key from Settings); it returns the per-server `gmk_cru_live_...` key
once. Then on the server, one command installs the agent and points it at
YOUR dashboard:

```
curl -fsSL https://glassmkr.com/install.sh | sudo bash -s -- \
  --api-key "gmk_cru_live_..." \
  --ingest-url "http://your-dashboard-host:3000/api/v1/ingest"
```

The URL must be the full `/api/v1/ingest` endpoint. The installer allowlists
exactly that origin for the agent's endpoint policy, which is what makes an
http or private-network dashboard address work; https endpoints on public DNS
need nothing extra. If you install the npm package yourself instead, the same
two flags on `glassmkr-crucible init` do the same thing (plus
`--allow-endpoint-origin <origin>` for http/private endpoints; run
`glassmkr-crucible init --help` for the full surface).

The agent stores the URL in `/etc/glassmkr/crucible.yaml`, so the flags are
only needed at init time. Snapshots arrive roughly every five minutes; the
first one appears on the dashboard within one cycle.

## AI analysis (optional)

Set `LLM_API_URL` in `.env` to any OpenAI-compatible endpoint and `LLM_MODEL`
to the model name. Local Ollama works:

```
LLM_API_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1:8b
```

Leave it empty and the analyze button reports that AI analysis is not
configured; everything else is unaffected.

## Upgrading

```
git pull
./scripts/selfhost-setup.sh
docker compose build dashboard
docker compose up -d
```

Run the setup script on every upgrade. It is idempotent and never touches a
value you already have, so on most upgrades it prints four "already set" lines
and does nothing. Its job here is the upgrade where a release needs a secret
your `.env` predates: without it, `docker compose` refuses to parse and tells
you which variable is missing, which is a confusing way to find out. Nothing
generated by the script is ever rotated by it, so your API keys keep working.

New migrations apply on boot, the ClickHouse set idempotently and the Postgres
set tracked. Read the changelog before major version jumps.

## Retention

Snapshots are kept for 90 days, alert history for 365. That is enforced by
ClickHouse table TTLs, not by a cron job, so it happens whether or not you run
anything extra. It is your database: to keep more (or less), change the TTL.

```
docker compose exec clickhouse clickhouse-client --query \
  "ALTER TABLE glassmkr.snapshots MODIFY TTL toDateTime(timestamp) + toIntervalDay(365)"
```

Storage grows roughly with snapshot count: one row per server per five minutes.

## Backups

State lives in the two Docker volumes: `pgdata` (accounts, servers, alert
state, keys) and `chdata` (telemetry history). Snapshot both. Postgres is the
one you cannot afford to lose; telemetry history is rebuildable by time.

## Self-hosted vs hosted

Same codebase. The hosted instance at app.glassmkr.com is the maintained
reference deployment and live demo; self-hosted is the same thing on your
hardware with every gate removed by the `GLASSMKR_SELF_HOSTED` flag. If you
ever move between them, agents re-point with one `init` and the API is
identical.
