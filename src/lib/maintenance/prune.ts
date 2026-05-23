// Reusable prune logic for the three tables Atlas owns that don't
// self-reap:
//
//   - sessions             — Auth.js doesn't delete expired rows
//   - verificationTokens   — Auth.js doesn't delete expired rows
//   - geocode_cache        — read path treats past-expiry as a miss
//                            but never deletes (see src/db/schema/geocode-cache.ts)
//
// Two consumers share this module so they always agree on what
// "expired" means and what gets reclaimed:
//
//   - scripts/prune.ts                       (CLI: `pnpm db:prune`)
//   - src/lib/scheduler/index.ts             (worker-side scheduled handler)

import { lt, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sessions, verificationTokens } from '@/db/schema/auth';
import { geocodeCache } from '@/db/schema/geocode-cache';

export const PRUNE_TARGETS = ['sessions', 'tokens', 'geocode'] as const;
export type PruneTarget = (typeof PRUNE_TARGETS)[number];
export type PruneScope = Record<PruneTarget, boolean>;
export type PruneCount = { target: PruneTarget; expired: number };

// Both the CLI script (bare `drizzle(pool)`) and the scheduler (the
// schema-aware singleton from src/db/client.ts) hit this module.
// Their static types differ — they only share `select`/`delete` etc.
// from the base class — so the lib is parameterized on a structurally
// compatible NodePgDatabase. The `any` here is justified: this module
// is genuinely schema-agnostic, all real queries are typed via the
// imported table objects, not the generic.
type AnyDb = NodePgDatabase<Record<string, unknown>>;

export const ALL_TARGETS: PruneScope = {
  sessions: true,
  tokens: true,
  geocode: true,
};

const TABLE_LABEL: Record<PruneTarget, string> = {
  sessions: 'sessions',
  tokens: 'verificationTokens',
  geocode: 'geocode_cache',
};

export function pruneLabel(target: PruneTarget): string {
  return TABLE_LABEL[target];
}

function tableFor(target: PruneTarget) {
  switch (target) {
    case 'sessions':
      return sessions;
    case 'tokens':
      return verificationTokens;
    case 'geocode':
      return geocodeCache;
  }
}

function whereFor(target: PruneTarget, cutoff: Date): SQL {
  switch (target) {
    case 'sessions':
      return lt(sessions.expires, cutoff);
    case 'tokens':
      return lt(verificationTokens.expires, cutoff);
    case 'geocode':
      return lt(geocodeCache.expiresAt, cutoff);
  }
}

export async function countExpired(db: AnyDb, target: PruneTarget, cutoff: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(tableFor(target))
    .where(whereFor(target, cutoff));
  return row?.n ?? 0;
}

export async function deleteExpired(db: AnyDb, target: PruneTarget, cutoff: Date): Promise<void> {
  await db.delete(tableFor(target)).where(whereFor(target, cutoff)).execute();
}

// High-level convenience: count every selected target, optionally
// delete, return the per-target counts. The cron job uses
// `apply: true` and trusts the counts for its log line; the CLI uses
// `apply: false` for dry-run and `true` for the actual sweep.
export async function runPrune(
  db: AnyDb,
  scope: PruneScope,
  cutoff: Date,
  apply: boolean,
): Promise<PruneCount[]> {
  const selected = PRUNE_TARGETS.filter((t) => scope[t]);

  const counts = await Promise.all(
    selected.map(async (target) => ({
      target,
      expired: await countExpired(db, target, cutoff),
    })),
  );

  if (apply) {
    for (const { target, expired } of counts) {
      if (expired === 0) continue;
      await deleteExpired(db, target, cutoff);
    }
  }

  return counts;
}
