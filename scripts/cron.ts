// Entrypoint for the `cron` compose service.
//
// Boots the in-stack scheduler (src/lib/scheduler/index.ts) and keeps
// the Node process alive until SIGINT/SIGTERM. Container orchestrators
// send SIGTERM on `docker compose stop` and host-level stop signals;
// graceful shutdown cancels pending jobs so a half-fired prune can't
// run during teardown.

import { db } from '../src/db/client';
import { log } from '../src/lib/log';
import { startScheduler } from '../src/lib/scheduler';

const scheduler = startScheduler(db);

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'cron.shutdown.signal');
  scheduler.stop();
  // Give in-flight jobs a moment to log their final state, then exit.
  // Croner's protected runs are typically <1s for the workloads we
  // schedule today; a 5s grace covers that with margin.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log.info({ jobs: scheduler.jobs.map((j) => j.name) }, 'cron.scheduler.started');
