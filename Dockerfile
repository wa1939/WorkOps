# WorkOps application images.
#
# This file builds TWO images:
#   * runner — the lean production server: standalone Next.js output only.
#     It omits application dev tooling, Prisma CLI and scripts/setup.
#   * tools  — a builder-derived image with the full dependency tree
#     (npm, tsx, Prisma CLI) plus the setup scripts, used for one-off
#     database work via `docker compose run --rm tools npm run <script>`.
#
# Build secrets are never passed as build args: the images contain no
# database URL, no auth secret, no API keys. All runtime configuration is
# injected via environment at `docker run` / compose time.
#
# `NEXT_OUTPUT_STANDALONE=1` opts next.config.mjs into the lean standalone
# server output; default (non-Docker) builds are unchanged.

# syntax=docker/dockerfile:1

# ---------- deps + build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# OpenSSL must be installed BEFORE the Prisma client is generated: the
# generated Prisma engines link against the system libssl (Debian bookworm),
# both during generation and at runtime.
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install exactly what the lockfile pins; scripts off, then generate the
# Prisma client deterministically (same behavior as npm ci --ignore-scripts
# + prisma generate used in CI).
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts --legacy-peer-deps \
    && node ./node_modules/prisma/build/index.js generate

# Application source (context is trimmed by .dockerignore; in particular
# .env* files never enter the build context).
COPY . .
# Docker-only build output mode (see next.config.mjs).
ENV NEXT_OUTPUT_STANDALONE=1
RUN npm run build

# ---------- tools: one-off DB setup / admin bootstrap / migrations ----------
# Builder-derived on purpose: full dev dependencies (npm, tsx, Prisma CLI)
# plus prisma/ and scripts/. Nothing here is needed to serve requests, which
# is why the runtime image below stays minimal. Declared BEFORE the runner
# stage so a plain `docker build .` (no --target) yields the lean runner.
FROM builder AS tools
WORKDIR /app

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Prisma engines (Debian bookworm build) require OpenSSL at runtime.
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/LICENSE /app/THIRD_PARTY_NOTICES.md /app/BRAND.md ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Serve the standalone Next.js server. Migrations are NOT auto-run on boot:
# apply them explicitly with `docker compose run --rm tools npm run db:deploy`
# (or db:setup on a fresh, empty database). The runner image cannot run these
# scripts itself — that is the point of the separate tools image above.
CMD ["node", "server.js"]
