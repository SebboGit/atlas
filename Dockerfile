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

# Standalone output from Next.js — minimal runtime
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]

# --- Worker runtime (hardened) ----------------------------------------------
# The prod standalone image strips tsx + our source tree, which the worker
# needs at runtime (it runs scripts/worker.ts via tsx, non-root). Own stage.
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
CMD ["pnpm", "worker"]
