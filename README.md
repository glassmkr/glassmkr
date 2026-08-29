# Glassmkr

Monitoring for bare metal: the parts of a server that fail quietly. SMART
attributes, IPMI sensors and SEL, ECC and machine-check counters, RAID and ZFS
state, network interface errors including bonds, GPU state, and kernel and patch
state.

This repository is the dashboard, the backend, the alert rules, the trend
engine, and the remediation library, under AGPL-3.0-only. The agent is a separate
MIT-licensed project: [glassmkr/crucible](https://github.com/glassmkr/crucible).

Every rule carries a distro-aware remediation workflow: prerequisites, the
command, how to check it worked, and how to roll it back. Those are instructions
for you. Glassmkr does not execute repairs on your machines.

## Self-hosting

```
git clone https://github.com/glassmkr/glassmkr.git
cd glassmkr
cp env.selfhost.example .env
./scripts/selfhost-setup.sh     # generates the secrets
docker compose up -d
```

That brings up the dashboard, Postgres, and ClickHouse, and applies migrations on
boot. Then open http://localhost:3000 and register the first account.

The agent installs separately on each machine you want to watch. Read
[SELF_HOSTING.md](SELF_HOSTING.md) first if your agents will run on other hosts,
because `DASHBOARD_BIND` and `DASHBOARD_PUBLIC_URL` have to agree before you
enrol any of them.

Self-hosted has no node limit, no license key, and no plan gates. Nothing reports
back to us. Two third parties are contacted by default and you should know which:
the dashboard reads the endoflife.date dataset to judge OS support windows, and
asks the npm registry which agent version is current. Both are lookups.

## Documentation

- [SELF_HOSTING.md](SELF_HOSTING.md): install, backups, upgrades, retention, and
  the MCP server
- [CONTRIBUTING.md](CONTRIBUTING.md): contributions are DCO, not a CLA
- [SECURITY.md](SECURITY.md): private disclosure channel
- [AGENTS.md](AGENTS.md): how to work in this repository. Written for AI coding
  agents and useful to anyone. Canonical: `CLAUDE.md` points here rather than
  keeping its own copy
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): production dependency
  licenses, generated from the lockfile

## The hosted service

[app.glassmkr.com](https://app.glassmkr.com) runs this same code for people who
would rather not operate the stack, free up to 10 nodes per account. There is a
[live demo with no signup](https://app.glassmkr.com/demo).

## Licenses

The dashboard and everything in this repository is AGPL-3.0-only: if you modify
it and run it as a service, your users get the same source access you have. The
agent is MIT, because it goes on every machine you own and should carry the most
permissive license that makes sense.

Component mapping, since one repository does not mean one license:

| Component | License | Where |
|---|---|---|
| Dashboard, backend, alert rules, trend engine, remediation library | AGPL-3.0-only | this repository, [LICENSE](LICENSE) |
| Crucible agent | MIT | [glassmkr/crucible](https://github.com/glassmkr/crucible) |
| Production dependencies | various, all permissive or compatible | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), generated from the lockfile |

The API is covered by the repository license. It is not proprietary; an earlier
version of the OpenAPI document said it was, which was wrong.
