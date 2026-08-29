# Contributing to Glassmkr

Glassmkr's dashboard and backend are AGPL-3.0-only (see [LICENSE](LICENSE));
the Crucible agent lives in [its own MIT repository](https://github.com/glassmkr/crucible).
Bug reports, fixes, and improvements are welcome.

## Developer Certificate of Origin (DCO)

Every commit must carry a `Signed-off-by:` line (`git commit -s` adds it).
By signing off you certify the [Developer Certificate of Origin](https://developercertificate.org/):
in plain words, that you wrote the change or otherwise have the right to
submit it under this repository's license, and that you understand the
contribution is public and recorded permanently. That is the whole
agreement; there is no CLA and no copyright assignment. Your code stays
yours, licensed to the project under AGPL-3.0-only like everything else
here. CI rejects unsigned commits on pull requests.

## Security tooling (local setup)

### gitleaks pre-commit hook (recommended)

The repo runs `gitleaks` as a CI gate on every PR (`.github/workflows/secret-scan.yml`). To catch secrets before they ever reach a commit, install the local pre-commit hook:

```bash
# 1. Install gitleaks (macOS)
brew install gitleaks
#    or Linux: download from https://github.com/gitleaks/gitleaks/releases

# 2. Wire the staged-files hook
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
gitleaks protect --staged --redact --verbose
EOF
chmod +x .git/hooks/pre-commit
```

`gitleaks protect --staged` scans only what you're about to commit, so it's fast. The CI gate is the backstop that scans full history.

This matters because the Crucible repo is public and historical secrets in git history are assumed permanently compromised even if force-pushed away (catalog T-704). Never commit a real token; if one slips, rotate it immediately and tell Simon.

## Dependency hygiene

- Dependabot opens **security-only** PRs (`.github/dependabot.yml`); routine version bumps are intentionally off.
- `pnpm audit --prod` is the source of truth for live advisories. The CI gate blocks only on **critical**; run the full audit locally before a dependency PR.
- Dependency bumps follow **minimum-patched-version** policy: bump to the lowest version that clears the advisory, no opportunistic major jumps (see `apps/dashboard/docs/security/README.md`).

## Conventions

- US English. No em-dashes in customer-facing copy or the YAML rule library (enforced by `lint:emdash`).
- One PR per concern. Auto-merge with squash on CI green. Auth / billing / ingest / request-handling PRs are draft-first for founder review.
- See `apps/dashboard/docs/security/` for the threat catalog + audit findings.
