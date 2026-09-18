# syntax=docker/dockerfile:1.7
# =============================================================================
# Atlas — Multi-stage Dockerfile
# Targets:
#   dev   — development image with hot reload
#   prod  — minimal production image (standalone Next.js output)
# =============================================================================

# --- Base --------------------------------------------------------------------
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat curl
WORKDIR /app
# Enable corepack so we get the pinned pnpm version from package.json
RUN corepack enable

# --- Dependencies ------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Dev ---------------------------------------------------------------------
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure the storage dir exists when running in dev
RUN mkdir -p /app/data/documents
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["pnpm", "dev"]

# --- Build (for prod) --------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The upload request envelope (Server Action body limit + proxy body cap) is
# sized from STORAGE_MAX_BYTES in next.config.ts, and `output: 'standalone'`
# bakes the result into the bundle. Setting STORAGE_MAX_BYTES only at runtime
# therefore lets storage accept files the envelope still truncates, so the
# build has to learn the ceiling too:
#   docker build --build-arg STORAGE_MAX_BYTES=52428800 .
# Unset is the normal case and yields an empty string here; next.config.ts
# reads that as "not set" and falls back to the 20 MB default (a value that is
# set but unparseable fails the build). This ENV is scoped to the build stage:
# the prod stage never inherits it, and instead re-declares the same build arg
# to export the derived ATLAS_UPLOAD_ENVELOPE_BYTES.
ARG STORAGE_MAX_BYTES
ENV STORAGE_MAX_BYTES=${STORAGE_MAX_BYTES}
RUN pnpm build

# --- Prod runtime ------------------------------------------------------------
FROM node:24-alpine AS prod
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data/documents && \
    chown -R nextjs:nodejs /app/data

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Belt and braces for the baked upload ceiling. next.config.ts inlines this
# value into the bundle at build time, so the app normally never reads it at
# runtime; exporting it here keeps the clamp working if a future bundler stops
# inlining. Same build arg as the build stage, so the two can't disagree.
# STORAGE_MAX_BYTES itself is deliberately NOT exported into this stage — the
# runtime value belongs to the operator's env, not to the image.
ARG STORAGE_MAX_BYTES
ENV ATLAS_UPLOAD_ENVELOPE_BYTES=${STORAGE_MAX_BYTES:-20971520}

# Standalone output from Next.js — minimal runtime
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Use Node (always present in this stage) rather than curl — the prod stage is
# FROM node:24-alpine directly, NOT FROM base, so it never gets the curl that
# base installs. Node 24 ships a global fetch, so this needs no extra package.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "server.js"]

# --- Worker runtime (hardened) ----------------------------------------------
# The prod standalone image strips tsx + our source tree, which the worker
# needs at runtime (it runs scripts/worker.ts via tsx, non-root). Own stage.
# INTENTIONAL: this stage keeps the dev dependencies (notably tsx) at runtime
# because it executes TypeScript directly rather than a compiled bundle. Do
# NOT switch the deps stage to a `--prod` install for this image without first
# replacing tsx, or the worker will fail to start.
FROM base AS worker
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data/documents && \
    chown -R nextjs:nodejs /app/data
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json pnpm-lock.yaml* ./
COPY --chown=nextjs:nodejs tsconfig.json drizzle.config.ts ./
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs scripts ./scripts
USER nextjs
# Invoke the locally-installed tsx loader directly instead of `pnpm worker`.
# As non-root, `pnpm` via corepack can fail trying to provision itself into a
# dir it doesn't own; `node --import tsx` sidesteps corepack entirely. Env is
# injected by compose (no .env file in the container), and worker.ts reads
# from process.env, so the script's `--env-file-if-exists` flag isn't needed.
CMD ["node", "--import", "tsx", "scripts/worker.ts"]
