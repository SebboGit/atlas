# Worker

> Living document. Sections here are binding until superseded by an ADR
> (see [`adr/`](./adr/)). Last reviewed: 2026-05-24.

The **worker** is the second container in the Atlas stack (alongside `app`
and `postgres`). It owns every piece of background work the application
needs: document extraction, geocode fetches, the nightly cleanup, and the
daily trip-status sweep. It is the only process that runs Drizzle
migrations, and it is the only process that registers job handlers or
schedules with pg-boss. The `app` container is request-handling only.

This split exists for one reason: durable background work has different
lifecycle expectations than HTTP request handling. Treating extraction as a
floating promise inside Next.js was fine while the app was tiny, but it
couldn't survive restarts, it couldn't dedupe across processes, and it gave
operators nothing to point at when something went wrong. [ADR-0012] covers
the rationale; the worker container is its concrete form.

[ADR-0012]: ./adr/0012-pg-boss-jobs-and-scheduling.md

## How it boots

`scripts/worker.ts` is the entrypoint. On start it:

1. Sets `JOBS_ROLE=worker` so any code that calls `register()` or
   `schedule()` knows it's allowed to (the app role throws).
2. Runs Drizzle migrations against `DATABASE_URL`. Single source of truth:
   the app container's `depends_on` keeps it from serving requests until
   the worker is healthy, which means no race between two containers both
   trying to migrate.
3. Calls `getJobs().start()`, which boots pg-boss and creates or migrates
   the `pgboss.*` schema in the same database.
4. Runs the trip-status sweep once. This is a catch-up backfill so trips
   that went stale before the worker existed (or before its last restart)
   get classified before the next scheduled firing.
5. Verifies the Protomaps PMTiles file exists at `TILES_DIR`. Non-fatal —
   the worker only warns and points at `pnpm tiles:fetch`. The basemap
   isn't a worker concern, but it's the most convenient place to surface
   missing-file errors at boot.
6. Calls `registerWorkerJobs(jobs, db)` (in [`src/lib/scheduler/index.ts`])
   to register every handler and schedule pg-boss is expected to run.
7. Writes `/tmp/atlas-worker-ready` so the compose healthcheck flips to
   `healthy` and the `app` container is released to start serving.

[`src/lib/scheduler/index.ts`]: ../src/lib/scheduler/index.ts

A `SIGTERM` or `SIGINT` triggers a graceful pg-boss `stop()` so any
in-flight job has a chance to finish before the orchestrator restarts the
container.

## The jobs it runs

The worker registers four named jobs. Two are ad-hoc — the app fires them
from server actions. Two are scheduled — pg-boss fires them on a cron
expression.

### Ad-hoc

**`extraction`** — runs the OCR + Ollama pipeline against an uploaded
document and writes the structured payload + linked segments back to the
database. The handler lives at
[`src/lib/documents/extraction-job.ts`](../src/lib/documents/extraction-job.ts).
Job is registered with `expireInSeconds: 1800` — Ollama on a large PDF
can legitimately take 5–10 minutes, and we don't want pg-boss's default
15-minute active-state timeout to mark it stuck. The
`extractionStartedAt` claim row makes any eventual retry idempotent: only
one worker wins.

**`geocode-fetch`** — looks up a hotel / activity / transit / food query
through Nominatim and writes the result into `geocode_cache`. Handler
lives at
[`src/lib/geocoding/lifecycle.ts`](../src/lib/geocoding/lifecycle.ts).
Registered with `policy: 'short'`, which makes pg-boss enforce
"at-most-one queued job per `singletonKey`" cross-process. Without that,
two near-simultaneous page renders for the same address would both
fan out to the public Nominatim endpoint.

### Scheduled

**`prune`** — sweeps expired Auth.js sessions, expired verification
tokens, and past-expiry rows in `geocode_cache`. Same code as
`pnpm db:prune --apply`, just invoked from pg-boss. Defaults to `40 3 * * *`
(03:40 UTC daily). Override with `CRON_PRUNE_SCHEDULE`.

**`status-sweep`** — flips trip statuses forward through their lifecycle:
`planned → active` when today falls inside the trip window, and
`active → completed` once the end date has passed. Forward-only — a
trip that's already `completed` or `archived` is never touched, and a
trip with no `startDate` (wishlist) is never touched. Pure helper in
[`src/lib/maintenance/status.ts`](../src/lib/maintenance/status.ts);
defaults to `5 0 * * *` (00:05 UTC daily). Override with
`CRON_STATUS_SCHEDULE`.

Both schedules respect `CRON_TZ` (defaults to `UTC`). Cron expressions
use the standard 5-field form. pg-boss's parser also accepts the legacy
6-field form, so values from before the croner → pg-boss migration keep
working unchanged.

## Adding a new job

The whole surface lives in `src/lib/scheduler/index.ts`. To add a new
background job:

1. Write the handler somewhere appropriate under `src/lib/<feature>/`,
   exporting a `JOB_NAME` constant and a `runFooJob(data)` function.
2. Import both into `registerWorkerJobs` and call `jobs.register(...)`.
3. If it's a recurring job, add a `jobs.schedule(JOB_NAME, cron, null, { tz })`
   call below and expose a `CRON_<JOB>_SCHEDULE` env var in `.env.example`.
4. To enqueue from app code: `import { getJobs } from '@/lib/jobs'`
   then `await getJobs().send(JOB_NAME, payload)`. Never call
   `register()` or `schedule()` from the app role — both throw.

Per-job tuning (`expireInSeconds`, `policy`, retry config) belongs in the
`register()` call. The `Jobs` interface mirrors the subset of pg-boss
options that make sense for Atlas; see
[`src/lib/jobs/types.ts`](../src/lib/jobs/types.ts).

## Operating it

In dev you have three sensible setups. `pnpm dev:up` on its own only
starts postgres and Next on the host — nothing fires background work.
Add `pnpm worker` in a second terminal to get a full host-side stack.
`docker compose up -d --build` brings up the containerised version
(postgres, worker, app, in that dependency order) and is the only way
to exercise the compose healthcheck gating.

Worker logs are structured JSON via the shared `log` module. Useful
search terms when something is wrong:

- `worker.boot.*` — startup sequence; missing a step usually means the
  boot failed before it got there.
- `worker.job.started` / `worker.job.completed` / `worker.job.failed` —
  per-firing lifecycle for the four named jobs.
- `jobs.pgboss.handler_registered` / `jobs.pgboss.schedule_registered` —
  emitted once per boot; if a job you expect isn't here, it isn't
  registered.

Environment variables that shape the worker live in `.env.example`:
`DATABASE_URL`, `CRON_PRUNE_SCHEDULE`, `CRON_STATUS_SCHEDULE`, `CRON_TZ`,
`OLLAMA_URL` / `OLLAMA_MODEL` (used by the extraction handler),
`NOMINATIM_CONTACT_EMAIL` (required for the geocode-fetch handler to
identify itself politely), and `TILES_DIR` (read at boot for the
PMTiles existence check).
