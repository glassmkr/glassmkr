# Security Policy

This repository holds the Glassmkr dashboard: the server that receives
snapshots from Crucible agents, evaluates alert rules, and stores fleet
telemetry. It handles API keys, account credentials, and an audit log, so its
security posture matters whether you self-host it or use the hosted instance.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through either channel:

- **GitHub private vulnerability reporting** (preferred): the repository's
  **Security** tab -> **Report a vulnerability**. This opens a private advisory
  visible only to you and the maintainers.
- **Email**: `security@glassmkr.com`.

Please include: the affected version or commit, a description of the issue,
reproduction steps or a proof of concept, and the impact you foresee. We aim to
acknowledge reports within 3 business days and to ship a fix or mitigation for
confirmed issues in the next release.

We will credit reporters in the release notes unless you prefer to remain
anonymous.

## Supported versions

The dashboard ships from a single line on `main`. Security fixes land there and
in the next tagged release; please reproduce against current `main` before
reporting, in case the issue is already fixed.

## How the stack is hardened

These are properties you can check in this repository, not assurances:

- **The application role is not a database superuser.** Postgres runs with a
  superuser that owns the schema and a separate unprivileged `agent` role that
  the application connects as. Grants are issued table by table, and
  `api_audit_log` is granted SELECT and INSERT only, so the application cannot
  rewrite or delete its own audit trail. The container entrypoint asserts this
  invariant at boot and refuses to start if it does not hold.
- **Secrets are distinct and generated.** `scripts/selfhost-setup.sh` generates
  the superuser password, the application password, the ClickHouse password,
  and the API-key pepper as separate values. A leaked application credential
  therefore cannot administer the database. A preflight container refuses to
  start the stack while any secret is still the shipped placeholder.
- **Outbound requests are guarded.** Alert channels take a customer-supplied
  URL, so every outbound send resolves the host first and refuses private,
  loopback, link-local, and cloud-metadata ranges, at channel creation as well
  as at send time. Redirects are not followed automatically.
- **Rate limits are per account and per key**, not only per IP, with tighter
  budgets on the endpoints that scan telemetry or trigger outbound requests.
- **The dashboard binds to loopback by default.** Docker publishes ports past
  ufw and firewalld, so binding to every interface would put a fresh dashboard
  on the public internet even on a host whose firewall looks closed.

## Your responsibilities when self-hosting

- Put TLS in front of the dashboard before exposing it beyond loopback.
- Close registration once your own account exists: set
  `GLASSMKR_DISABLE_REGISTRATION=1`. This closes every path that creates an
  account, including OAuth sign-in.
- Keep `.env` readable only by the user that runs the stack (setup sets `600`).
- Never change `GLASSMKR_KEY_PEPPER` after first boot; it invalidates every
  issued key.

## What we do not claim

Open source lets you inspect this code. It does not by itself prove the code is
correct, and this policy is not a warranty. If you find something we got wrong,
the reporting channels above are the fastest way to get it fixed.
