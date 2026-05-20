---
name: atlas-backups
description: Use when backing up Atlas, restoring from backup, or working with the nightly DB prune. Covers DB dumps via the nfrastack/container-db-backup service, the rsync-based document snapshot script, retention/offsite rules, the interactive restore wizard, and the in-stack cron service that sweeps expired Auth.js sessions, verification tokens, and geocode-cache rows.
---

# Atlas — Backups

Two layers, captured into the same snapshot tree so a single offsite sync covers both.

## 1. Postgres → `nfrastack/container-db-backup`

Runs as the `db-backup` service in compose.

- **Schedule:** daily at 03:30 (configurable via `DB01_BACKUP_BEGIN`).
- **Compression:** ZSTD level 3 (good ratio, fast).
- **Checksums:** SHA1 alongside each dump.
- **Retention:** 30 days in dev, 90 in prod (configurable via `DB01_CLEANUP_TIME`).
- **Archive:** older dumps move to an `archive/` subdir for offsite-friendly handling.
- **Output:** `./data/backups/db/` on the host.
- **Profile:** opt-in (`--profile backup`) in dev; activated in prod via the same flag.
- **Restores:** enter the container and run `restore` for an interactive wizard. Document any restoration drills in `docs/OPERATIONS.md` when it's written.

## 2. Documents → `scripts/backup-documents.sh`

The DB-backup container only knows about Postgres. The documents directory is host-side, captured by a small rsync-based script.

- **Schedule:** suggested cron entry on the host at 03:35 (just after the DB dump).
- **Output:** `./data/backups/documents/<UTC-timestamp>/`.
- **Retention:** 30 days by default (env-tunable).

## 3. Offsite (operator's responsibility)

`./data/backups/` is the only directory you need to rsync offsite. One target captures both DB and documents.

When adding a second stateful service later, route its backups into `./data/backups/<service>/` so the offsite story stays "one directory."

## 4. Nightly DB prune (in-stack)

Auth.js doesn't reap its own expired `sessions` / `verificationTokens`, and the geocode cache (`src/db/schema/geocode-cache.ts`) treats past-expiry rows as cache misses on read but never deletes them. The `cron` compose service sweeps all three nightly.

- **How it runs:** the `cron` service in `docker-compose.yml` reuses the Atlas image with the `pnpm cron` entrypoint (`scripts/cron.ts`). Inside, `src/lib/scheduler/` uses `croner` to register jobs. Today there's one job — `prune` — but new scheduled work (e.g. upcoming-flight ntfy reminders) registers in the same place.
- **Default schedule:** 03:40 daily, UTC. Override with `CRON_PRUNE_SCHEDULE` (six-field cron expression, `sec min hour day month weekday`) and `CRON_TZ` (IANA zone) in `.env`.
- **Behaviour:** the cron job calls into `src/lib/maintenance/prune.ts`, the same module the CLI uses. They never diverge. Concurrent runs are blocked (`protect: true` in `Cron`), so a stuck DB won't pile up parallel attempts.
- **Manual run (anytime):** `pnpm db:prune` (dry-run) or `pnpm db:prune --apply`.
- **No host cron required.** This works out of the box on plain Docker Compose or any single-host orchestrator that can run a second container.
- Pruning is purely housekeeping — the read paths already ignore expired rows, so this only reclaims storage, it doesn't change behaviour.

## Common commands

```bash
./scripts/backup-documents.sh                  # docs snapshot (DB handled by the container)
docker compose exec db-backup backup-now       # trigger an ad-hoc DB dump
docker compose exec -it db-backup restore      # interactive restore wizard

pnpm db:prune                                  # list expired rows (dry-run)
pnpm db:prune --apply                          # delete expired rows from all three tables
pnpm db:prune --sessions --apply               # scope to a single table (also --tokens, --geocode)
```
