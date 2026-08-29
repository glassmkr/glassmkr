# Glassmkr dashboard, self-host image.
#
# Multi-stage: build the SvelteKit (adapter-node) app out of the pnpm monorepo,
# then run it on a slim runtime. `pnpm deploy` produces a standalone directory
# with a real node_modules (no workspace symlinks), which is what makes the
# runtime stage copyable.
#
# The runtime stage installs postgresql-client because scripts/migrate-postgres.mjs
# applies migrations via `psql -f` (deliberately: the same path an operator runs
# by hand). ClickHouse migrations are NOT run here; they run in the one-shot
# `clickhouse-migrate` compose service, which has clickhouse-client.

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter dashboard build
# Standalone production tree: real node_modules, no symlinks out of the repo.
RUN pnpm --filter dashboard --prod deploy /out
RUN cp -r apps/dashboard/build /out/build \
 && mkdir -p /out/scripts /out/migrations \
 && cp scripts/migrate-postgres.mjs /out/scripts/ \
 && cp -r migrations/postgres /out/migrations/postgres

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
