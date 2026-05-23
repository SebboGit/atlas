---
name: atlas-commands
description: Use when running Atlas dev/db/backup/scheduler commands, starting the stack, resetting the DB, applying migrations, seeding data, running tests, taking a manual backup, or triggering maintenance. Reference for pnpm dev:up, db:setup/reset/migrate/seed/studio, the compose stack, the quality gates, the documents snapshot script, db:prune, docs:cleanup-orphans, and pnpm worker.
---

# Atlas — Common Commands

```bash
# First-time setup (one-time)
pnpm install
cp .env.example .env       # then edit .env — set AUTH_SECRET and (for sign-in) OIDC_*

# The one-shot dev command — every iteration after first-time setup
pnpm dev:up                # docker compose up -d --wait postgres → migrate → seed → next dev

# Individual pieces (when dev:up is overkill)
pnpm dev                   # just next dev (requires postgres running + DB migrated)
pnpm db:setup              # migrate + seed
pnpm db:reset              # nuke postgres volume, bring up fresh, migrate + seed
pnpm db:generate           # generate a migration from schema changes
pnpm db:migrate            # apply pending migrations only
pnpm db:seed               # seed dev data only
pnpm db:studio             # Drizzle Studio (browse DB)

# Full compose stack (app container, not just postgres)
docker compose up -d                      # app + postgres
docker compose --profile backup up -d     # also activate scheduled DB backups

# Quality gates (what CI runs)
pnpm typecheck
pnpm lint
pnpm test                  # Vitest
pnpm test:e2e              # Playwright (local only — not in CI yet)
pnpm build                 # Production build

# Backups
./scripts/backup-documents.sh                  # docs snapshot (DB handled by the container)
docker compose exec db-backup backup-now       # trigger an ad-hoc DB dump
docker compose exec -it db-backup restore      # interactive restore wizard

# Maintenance
pnpm docs:cleanup-orphans                      # list documents with no trip/segment links (dry-run)
pnpm docs:cleanup-orphans --apply              # delete the orphan rows + files
pnpm db:prune                                  # list expired sessions/tokens/geocode rows (dry-run)
pnpm db:prune --apply                          # delete expired rows from all three tables
pnpm db:prune --sessions --apply               # scope to a single table (also --tokens, --geocode)

# Worker — pg-boss host (extraction, geocoding, prune, status sweep)
pnpm worker                                    # boot the worker locally (foreground, SIGINT to stop)
docker compose logs -f worker                  # tail the in-stack worker running in Docker
```
