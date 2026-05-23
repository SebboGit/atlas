# ADR-0012: pg-boss for durable jobs and in-stack scheduling

- **Status:** Accepted
- **Date:** 2026-05-19 (proposed) · 2026-05-23 (accepted, bundled with auto-status)
- **Deciders:** @SebboGit

## Context

Atlas currently has two seams for background work:

- **`src/lib/jobs/`** — a `Jobs` interface with one method (`enqueue(thunk)`) and a single `InlineJobs` implementation. Work runs as a floating promise on the same Node process that handled the server action. If the app container restarts mid-flight, the work is lost; there are no retries and no record that it ever ran. Today's only caller is the extraction pipeline, which is acceptable because extraction failures surface in the document review UI and the user can retry by hand.
- **`src/lib/scheduler/`** — a [croner](https://github.com/Hexagon/croner)-driven scheduler running in a dedicated `cron` compose service. Today's only job is the nightly DB prune, which is idempotent and fine to skip a day.

Both seams are intentionally minimal, and CLAUDE.md's "Extension Points" section names BullMQ + Redis as the eventual graduation path for `Jobs`.

The roadmap adds two consumers that strain the current setup:

1. **ntfy push notifications** for upcoming-flight reminders and extraction events. Reminders fire from scheduled jobs and from server actions. A failed `POST` to ntfy must retry with backoff — a missed flight reminder is the kind of bug that makes the whole app feel untrustworthy. The user must also be able to see _which_ reminders fired and which didn't.
2. **Auto-status cron** that transitions trips `planned → active → completed` by date. Idempotent like prune, but now the scheduler is running three to five jobs instead of one, and we want history when something looks wrong ("did yesterday's status sweep actually run?").

The current primitives don't cover either case well:

- `InlineJobs` has no retries and no durability. Adding retries on top of it means inventing a job table, idempotency keys, and a worker loop. That's literally what a job queue is.
- croner has no run history, no retry semantics, and no notion of "this job failed, surface it." A thrown job is logged once and forgotten.

Building either of those on top of what we have would amount to a hand-rolled queue. We've already crossed the threshold where CLAUDE.md says to swap implementations behind the `Jobs` interface; the only open question is _which_ queue.

## Decision

Adopt **[pg-boss](https://github.com/timgit/pg-boss)** as the implementation behind both the `Jobs` interface and the in-stack scheduler.

- **Storage:** pg-boss installs its own `pgboss` schema in the existing Postgres instance on first boot. No new service, no new container, no new credential.
- **Jobs interface:** a new `PgBossJobs` implementation in `src/lib/jobs/pgboss.ts` replaces `InlineJobs` as the singleton returned by `getJobs()`. The interface gains two methods on top of an evolved `send(name, data)` (replacing `enqueue(thunk)`): `register(name, handler)` and `schedule(name, cron, data, opts)`. Both are worker-only by convention — the app process throws if it tries to register handlers or schedules. Call discipline, not enforcement: one container per role, simple ownership.
- **Scheduler:** pg-boss's `schedule(name, cron, data, opts)` replaces croner. Job registration moves from `src/lib/scheduler/index.ts`'s `startScheduler()` to a `registerWorkerJobs(jobs, db)` function called once at worker boot, which registers both ad-hoc handlers and recurring schedules. Standard 5-field cron syntax. `CRON_PRUNE_SCHEDULE` and `CRON_TZ` keep their meanings; new `CRON_STATUS_SCHEDULE` follows the same convention.
- **Worker process:** the existing `cron` compose service is renamed to `worker` and runs `pnpm worker` (a new `scripts/worker.ts`). It hosts both the scheduler and the ad-hoc job consumers. One process, one container, same deployment shape.
- **Migrations on boot:** the worker runs Drizzle migrations before starting pg-boss; the app container `depends_on: worker: service_healthy` via a `/tmp/atlas-worker-ready` marker. Single source of truth for migrations, no race between containers.
- **Maintenance CLI:** `pnpm db:prune` keeps working unchanged. Both the CLI and the scheduled job call into `src/lib/maintenance/prune.ts` — the maintenance modules never learn that pg-boss exists.
- **Croner is removed** from `package.json` in the same PR. Running both schedulers in parallel is pure churn.

The migration lands the next time we add a scheduled job — concretely, alongside the auto-status cron. We don't wait for ntfy: auto-status is itself a good reason to have run history and retries, and doing the swap while the scheduler surface is still small (one job today) keeps the diff manageable. ntfy then arrives on top of pg-boss as its first ad-hoc-job consumer.

## Consequences

### Positive

- **Durable work.** A reminder that fails because ntfy is briefly down retries with exponential backoff and eventually surfaces as a dead-letter row. No more "did that fire?" guessing.
- **Run history.** The `pgboss.job` and `pgboss.archive` tables answer "what ran, when, and did it succeed?" without scraping logs.
- **No new service.** Postgres is already in the stack, already backed up, already monitored. Adding Redis purely for BullMQ would double the stateful surface area for a personal app.
- **Atomic enqueue, natively.** pg-boss ships a Drizzle transaction adapter (`fromDrizzle(tx, sql)`) that lets `boss.send()` participate in a Drizzle-opened transaction. A server action can insert a domain row and enqueue the follow-up job in the same `db.transaction(...)` block — either both commit or neither does. With `InlineJobs` this is impossible: the floating promise can fire before the row is visible to other readers. Sibling adapters exist for Knex, Kysely, and Prisma, so we're not betting on a one-off integration.
- **One operational model.** Cron jobs and ad-hoc jobs share retry policy, observability, and the same worker container. Fewer abstractions to reason about.
- **Distributed lock semantics for free.** If we ever run a second worker (multi-process, a second VM), pg-boss's `singletonKey` prevents duplicate scheduled runs without us inventing leader election.

### Negative / tradeoffs

- **Postgres becomes the queue too.** Job throughput now shares CPU and connections with the app. For Atlas's workload (single-digit jobs per minute at peak) this is irrelevant, but it's worth naming: we're choosing operational simplicity over the kind of isolation Redis would give us.
- **pg-boss owns its own schema.** Job tables live in `pgboss.*` and pg-boss runs its own DDL and migrations on boot — the same shape as PostGIS or `pg_cron`. They never appear in `drizzle-kit generate` output and feature code never reads from them directly. The Drizzle integration is at the _transaction_ layer (`fromDrizzle`), not the schema layer, so this isn't a workaround for missing ORM support — it's how pg-boss is designed to be used. Worth naming so future-you doesn't try to `drizzle-kit pull` it or hand-roll a migration on top.
- **Workers need handler registration on boot.** Unlike `InlineJobs`, you can't just hand pg-boss an arbitrary closure to run later — each job name needs a registered handler in the worker process. That's a small ergonomic step down at the call site; feature code now passes `(name, data)` to `send()` instead of a thunk to `enqueue()`. The `Jobs` interface gains `register(name, handler)` (called from the worker entrypoint) and `schedule(name, cron, data, opts)` (likewise worker-only).
- **Backup story slightly bigger.** Job history lives in Postgres, so it's already covered by the nightly dump. The `archive` table grows over time; pg-boss has a built-in `maintenance` job that prunes it, but we need to make sure it's enabled.
- **One more dependency to track.** pg-boss is well-maintained (active commits, Postgres 18 supported) but it's a meaningful runtime piece. Pinning + dependabot grouping mitigates this.

### Neutral

- The `Jobs` interface stays the swap door it always was. If pg-boss ever stops being enough — genuine multi-tenant scale, sub-second latency requirements — BullMQ + Redis remains a viable next step behind the same interface. This ADR does not preclude it; it just defers it past the point where it earns its keep.
- The CLI ↔ scheduler co-location of maintenance code (`src/lib/maintenance/*`) stays. Both invocation paths still call the same module.
- `InlineJobs` is removed, not kept as a fallback. Two implementations is two test matrices; pick one. Tests that need synchronous behaviour use `vi.mock('@/lib/jobs', …)` exactly as they do today.

## Alternatives considered

- **Stay on `InlineJobs` + croner and add retry logic ourselves.** This is what we'd be doing if we shipped ntfy without changing primitives: a job table, an idempotency key column, a worker loop, a retry policy, a dead-letter view. By the time it works, we've rebuilt pg-boss with bugs. Rejected on principle — don't reinvent infrastructure.
- **BullMQ + Redis.** The graduation path CLAUDE.md names today. Excellent ecosystem, Bull Board UI, mature retry semantics. Costs a Redis container, a Redis env var, a second stateful service in `docker-compose.yml`, and a second thing to think about during restores. For Atlas's actual workload (a handful of jobs per day), the performance headroom BullMQ buys is invisible. Rejected: the marginal capability doesn't justify the operational footprint for a personal app. The interface boundary stays in place, so this remains the next-next step if pg-boss ever runs out.
- **River (Postgres-backed Go queue with a Node client).** Same Postgres-as-queue thesis as pg-boss, newer, smaller community, and the Node client is a thin layer over a Go service. Rejected: more moving parts for the same outcome, and pg-boss has a longer track record on Node.
- **Temporal / Inngest / Hatchet.** Proper workflow engines. Massive overkill for "send a push, sweep some rows nightly." Rejected without much deliberation.
- **Host cron + `/api/internal/run-job` endpoints.** Pushes scheduling out of the stack and onto the host's cron. Loses the "the source of truth for jobs is the repo" property the current setup already has. Rejected: same reason we picked croner-in-a-container over host cron in the first place.

## References

- ADR-0001 — Local filesystem storage. Same "fewer moving parts unless earned" energy.
- ADR-0006 — Ollama-only LLM extraction. Same "remove the optional path so it can't be misconfigured" energy.
- CLAUDE.md → Extension Points → "Job queue" (will be updated in the same PR to point at this ADR instead of BullMQ).
- CLAUDE.md → Backups → "Nightly DB prune (in-stack)" (will be updated to describe the worker service).
- [pg-boss documentation](https://github.com/timgit/pg-boss)
- [BullMQ](https://docs.bullmq.io/) — the rejected alternative kept named so a future ADR can supersede this one without re-litigating the comparison.
