// CLI wrapper around src/lib/maintenance/prune.ts.
//
// Dry-run by default — prints what *would* be deleted and exits 0.
// Pass `--apply` to actually delete. Selector flags scope the sweep;
// with no selectors, all three tables are pruned.
//
// Usage:
//   pnpm db:prune                        # dry-run, all three tables
//   pnpm db:prune --apply                # delete from all three
//   pnpm db:prune --sessions --apply     # only sessions
//   pnpm db:prune --geocode --tokens     # dry-run, only those two
//
// The same prune logic also runs from the `cron` compose service (see
// src/lib/scheduler/index.ts) so the nightly housekeeping and this
// manual CLI never diverge.

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';
import {
  ALL_TARGETS,
  PRUNE_TARGETS,
  pruneLabel,
  runPrune,
  type PruneScope,
  type PruneTarget,
} from '../src/lib/maintenance/prune';

const args = new Set(process.argv.slice(2));
const APPLY = args.delete('--apply');

const SELECTORS = ['--sessions', '--tokens', '--geocode'] as const;
type SelectorFlag = (typeof SELECTORS)[number];
const FLAG_TO_TARGET: Record<SelectorFlag, PruneTarget> = {
  '--sessions': 'sessions',
  '--tokens': 'tokens',
  '--geocode': 'geocode',
};

const selected: PruneTarget[] = [];
for (const flag of SELECTORS) {
  if (args.delete(flag)) selected.push(FLAG_TO_TARGET[flag]);
}

// Refuse unknown flags so a typo can't silently widen the sweep (zero
// explicit scopes means "do everything" — easy to misread).
if (args.size > 0) {
  console.error(`unknown flag(s): ${[...args].join(' ')}`);
  console.error('valid: --apply --sessions --tokens --geocode');
  process.exit(2);
}

const scope: PruneScope =
  selected.length === 0
    ? ALL_TARGETS
    : PRUNE_TARGETS.reduce<PruneScope>((acc, t) => ({ ...acc, [t]: selected.includes(t) }), {
        sessions: false,
        tokens: false,
        geocode: false,
      });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  const now = new Date();

  console.log(`▸ prune cutoff: ${now.toISOString()} (${APPLY ? 'apply' : 'dry-run'})\n`);

  const counts = await runPrune(db, scope, now, APPLY);
  const total = counts.reduce((sum, c) => sum + c.expired, 0);

  for (const { target, expired } of counts) {
    console.log(`  · ${pruneLabel(target).padEnd(20)} ${expired} expired row(s)`);
  }

  if (total === 0) {
    console.log('\n▸ nothing to prune');
  } else if (!APPLY) {
    console.log('\n▸ dry-run — pass --apply to delete');
  } else {
    console.log(`\n▸ done — ${total} row(s) reclaimed`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('prune failed:', err);
  process.exit(1);
});
