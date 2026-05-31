// Worker entrypoint — the long-running container that hosts pg-boss.
//
// Boot order matters. Each step must complete before the next:
//
//   1. JOBS_ROLE=worker          must be set before getJobs() is first
//                                called. ESM hoists imports above this
//                                line, so the assignment only works
//                                because getJobs() is lazy — the
//                                singleton is constructed on first call,
//                                inside main(). If a future contributor
//                                adds `getJobs()` at the top level of
//                                any transitively-imported module, role
//                                detection silently falls back to 'app'
//                                and register() throws. Keep getJobs()
//                                calls inside functions.
//   2. Drizzle migrations        forward-only application schema migrations;
//                                the worker is the single source of truth
//                                so the app process never races to migrate
//   3. Reference-data seed       idempotently load the ISO country table.
//                                Required, not optional: trip + visited-
//                                country rows FK to `countries.code`, so an
//                                empty table breaks "mark country visited"
//                                on a fresh deploy. onConflictDoNothing,
//                                so re-running every boot is harmless.
//   4. pg-boss start             installs/migrates the `pgboss.*` schema
//                                and starts the supervision loop
//   5. Boot-time status sweep    catches up trips that were `planned` /
//                                `active` before this worker version
//                                landed (idempotent — running once at
//                                boot + nightly is harmless)
//   6. PMTiles existence check   non-fatal warn if the bind-mount is
//                                missing; the map silently breaks
//                                otherwise and the cause is opaque
//   7. registerWorkerJobs        wire pg-boss handlers + schedules
//   8. Hold the process alive    until SIGTERM / SIGINT, then graceful
//                                stop so in-flight handlers finish
//
// If step 2, 3, or 4 fails the process exits non-zero and the orchestrator
// restarts us — `pg_isready`-style behaviour for the worker.

process.env.JOBS_ROLE = 'worker';

import { access, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from '../src/db/client';
import { seedCountries } from '../src/lib/countries/seed';
import { getJobs } from '../src/lib/jobs';
import { log } from '../src/lib/log';
import { runStatusSweep, registerWorkerJobs } from '../src/lib/scheduler';

const PMTILES_DEFAULT_REL = 'data/tiles/world.pmtiles';

// Docker compose's `depends_on: condition: service_healthy` blocks the
// app container's startup until this marker exists — see the worker
// service's healthcheck in docker-compose.yml. Written once at the end
// of the boot sequence, after migrations + pg-boss start + handler
// registration have all succeeded. Per-container ephemeral; recreated
// every boot.
const READY_MARKER_PATH = '/tmp/atlas-worker-ready';

async function runMigrations(): Promise<void> {
  const startedAt = Date.now();
  log.info({}, 'worker.migrate.started');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  log.info({ durationMs: Date.now() - startedAt }, 'worker.migrate.completed');
}

async function seedReferenceData(): Promise<void> {
  const startedAt = Date.now();
  log.info({}, 'worker.seed.started');
  const count = await seedCountries(db);
  log.info({ count, durationMs: Date.now() - startedAt }, 'worker.seed.completed');
}

async function runBootStatusSweep(): Promise<void> {
  const startedAt = Date.now();
  try {
    const counts = await runStatusSweep(db, new Date());
    log.info(
      {
        plannedToActive: counts.plannedToActive,
        activeToCompleted: counts.activeToCompleted,
        durationMs: Date.now() - startedAt,
      },
      'worker.boot.status_sweep_completed',
    );
  } catch (err) {
    // Non-fatal — the scheduled job will retry tonight. Log loudly so
    // operators see it surface in the first few minutes after upgrade.
    log.error(
      { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
      'worker.boot.status_sweep_failed',
    );
  }
}

async function checkPmtilesPresent(): Promise<void> {
  const configuredUrl = process.env.PROTOMAPS_PMTILES_URL?.trim();
  if (configuredUrl && /^https?:\/\//i.test(configuredUrl)) {
    // A remote `https://…/world.pmtiles` is left to the app to
    // fail-fast on first byte-range request; we only check the
    // on-disk bind-mount case here. A relative path (e.g.
    // `/api/tiles/world.pmtiles`) is the in-stack route and falls
    // through to the local-file check below.
    //
    // Log origin + pathname only — a signed or token-bearing URL
    // would otherwise leak credentials into the structured-log
    // stream via the query string. Parse defensively so a malformed
    // URL still logs *something*.
    let remoteLog: Record<string, string> = { source: 'remote' };
    try {
      const remote = new URL(configuredUrl);
      remoteLog = { source: 'remote', origin: remote.origin, pathname: remote.pathname };
    } catch {
      // configuredUrl matched the http(s) regex but URL parsing
      // failed — log generically rather than echoing the raw value.
    }
    log.info(remoteLog, 'worker.boot.pmtiles_remote');
    return;
  }
  const tilesDir = process.env.TILES_DIR?.trim();
  const path = tilesDir ? `${tilesDir}/world.pmtiles` : resolve(process.cwd(), PMTILES_DEFAULT_REL);
  try {
    await access(path);
    log.info({ path }, 'worker.boot.pmtiles_ok');
  } catch {
    log.warn(
      { path },
      'worker.boot.pmtiles_missing — map will not render until you run `pnpm tiles:fetch` (~33 GB, see scripts/fetch-tiles.sh)',
    );
  }
}

async function main(): Promise<void> {
  log.info({ pid: process.pid }, 'worker.boot.start');

  // If the process restarts in-place (orchestrator restart, supervisord,
  // etc.) the marker from a prior boot would otherwise let the
  // healthcheck pass before migrations + handler registration finish
  // for this boot. Clear it first; recreated at the end of main().
  await rm(READY_MARKER_PATH, { force: true });

  await runMigrations();

  // Reference data the app can't function without — seed before anything
  // serves requests. Idempotent, so running it on every boot is cheap.
  await seedReferenceData();

  const jobs = getJobs();
  await jobs.start();

  // Boot-time backfill — the sweep is idempotent, so running it both
  // at boot and on schedule is fine. Catches trips whose dates have
  // moved without a sweep firing yet (typically: just upgraded to a
  // version with this job for the first time).
  await runBootStatusSweep();

  await checkPmtilesPresent();

  await registerWorkerJobs(jobs, db);

  // Signal "boot complete" to compose's healthcheck. If this fails the
  // worker still runs, but the app container won't start — surface it
  // as an error rather than silently hanging the dependency chain.
  try {
    await writeFile(READY_MARKER_PATH, `${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    log.error(
      {
        path: READY_MARKER_PATH,
        err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown',
      },
      'worker.boot.ready_marker_failed',
    );
    throw err;
  }

  log.info({}, 'worker.boot.ready');

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'worker.shutdown.signal');
    try {
      await jobs.stop();
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
        'worker.shutdown.jobs_stop_failed',
      );
    }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // A handler-body fire-and-forget rejection would otherwise crash the
  // process under Node 24's default — fine, because the orchestrator
  // restarts us, but the log line is what tells the operator WHAT
  // crashed. Same for an unexpected uncaughtException.
  process.on('unhandledRejection', (reason) => {
    log.error(
      { err: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason) },
      'worker.unhandled_rejection',
    );
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.error(
      { err: `${err.name}: ${err.message}\n${err.stack ?? ''}` },
      'worker.uncaught_exception',
    );
    process.exit(1);
  });
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : 'unknown' },
    'worker.boot.failed',
  );
  process.exit(1);
});
