---
name: atlas-backups
description: Use when backing up Atlas, restoring from backup, or working with the nightly DB prune. Covers DB dumps via the nfrastack/container-db-backup service, the rsync-based document snapshot script, retention/offsite rules, the interactive restore wizard, and the in-stack worker service (pg-boss) that sweeps expired Auth.js sessions, verification tokens, and geocode-cache rows.
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
- **PGDATA ownership after hardening:** the `restore` wizard above is a logical restore (`pg_dump` replayed into a running Postgres), so it is unaffected by anything here. The prod overlay (`docker-compose.prod.yml`) does run Postgres with a trimmed capability set, so it can no longer fix ownership on a data directory whose files belong to a uid other than 70 (the image's `postgres` user). If you ever relocate the raw PGDATA — off the Docker named volume onto a host bind mount, or from a filesystem snapshot/rsync — `chown -R 70:70` it before the first boot. Normal named-volume operation never triggers this.

## 2. Documents → `scripts/backup-documents.sh`

The DB-backup container only knows about Postgres. The documents directory is host-side, captured by a small rsync-based script.

- **Schedule:** suggested cron entry on the host at 03:35 (just after the DB dump).
- **Output:** `./data/backups/documents/<UTC-timestamp>/`.
- **Retention:** 30 days by default (env-tunable).

## 3. Offsite (operator's responsibility)

`./data/backups/` is the only directory you need to rsync offsite. One target captures both DB and documents.

When adding a second stateful service later, route its backups into `./data/backups/<service>/` so the offsite story stays "one directory."

## 4. Nightly DB prune (in-stack)

Auth.js doesn't reap its own expired `sessions` / `verificationTokens`, and the geocode cache (`src/db/schema/geocode-cache.ts`) treats past-expiry rows as cache misses on read but never deletes them. The `worker` compose service sweeps all three nightly via pg-boss.

- **How it runs:** the `worker` service in `docker-compose.yml` reuses the Atlas image with the `pnpm worker` entrypoint (`scripts/worker.ts`). Inside, `src/lib/scheduler/` registers handlers + schedules against pg-boss (ADR-0012). Today there are two scheduled jobs — `prune` and `status-sweep` — and two ad-hoc consumers (extraction, geocoding). New scheduled work registers in the same place.
- **Default schedule:** 03:40 UTC daily. Override with `CRON_PRUNE_SCHEDULE` (standard 5-field cron, `min hour day month weekday`) and `CRON_TZ` (IANA zone) in `.env`.
- **Behaviour:** the scheduled handler calls into `src/lib/maintenance/prune.ts`, the same module the CLI uses. They never diverge. pg-boss applies retry semantics on failure (no more "did it run?" guessing).
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
