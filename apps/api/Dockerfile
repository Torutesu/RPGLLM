# syntax=docker/dockerfile:1.7
# Build context is the REPO ROOT (pnpm workspace):
#   docker build -f apps/api/Dockerfile -t rpgllm-api .
#
# Stages: base (runtime deps) → fetch (pnpm store) → build (install + prisma generate + typecheck)
#         → runtime (slim, non-root, HEALTHCHECK on /v1/health).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Prisma needs OpenSSL; curl is not installed — the healthcheck uses node's global fetch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# ---- fetch: lockfile-only layer so dependency downloads are cached across source changes ----
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

# ---- build: install just the api's workspace closure, generate the Prisma client, typecheck ----
FROM fetch AS build
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/llm/package.json packages/llm/
COPY apps/api/package.json apps/api/
RUN pnpm install --offline --frozen-lockfile --filter api...
COPY packages/shared packages/shared
COPY packages/llm packages/llm
COPY apps/api apps/api
RUN pnpm --filter api exec prisma generate \
 && pnpm --filter api typecheck

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 4000

# Fails the container when the API cannot answer, including when its database probe says "down"
# (GET /v1/health returns 503 in that case — see apps/api/src/routes/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here — run `pnpm --filter api exec prisma migrate deploy` as a
# release/init step (docs/deploy.md) so N replicas do not migrate concurrently.
#
# The API runs as **PID 1** (node directly, not `pnpm run …`): a pnpm/sh wrapper does not forward
# SIGTERM, and the graceful drain in src/index.ts would never run. The scheduler is the same image
# with a different command — see docs/deploy.md §5:
#
#   docker run … rpgllm-api:<tag> node --import tsx src/worker.ts
#
WORKDIR /repo/apps/api
CMD ["node", "--import", "tsx", "src/index.ts"]
