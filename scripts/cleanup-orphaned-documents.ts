// Reclaims orphaned document rows and their underlying files. A
// document is orphaned when its `tripId` is NULL **and** it has no
// rows in the `document_segments` join table — there is no trip and
// no segment that points at it. This can happen via:
//
//   - Trip deleted with "keep documents" → action stamps `orphanedAt`.
//   - Old "Delete forever" runs (before this script existed) that
//     pre-dated the orphan-aware delete action and left files behind.
//   - Future periodic sweep can use the same query.
//
// Dry-run by default: prints what *would* be reclaimed and exits 0.
// Pass `--apply` to actually delete rows + files. Always print first;
// destructive operations should never be silent.
//
// Usage:
//   pnpm docs:cleanup-orphans            # dry-run
//   pnpm docs:cleanup-orphans --apply    # delete rows + files
//
// (Both forms load env vars from .env via tsx's --env-file-if-exists.)

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { and, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { documentSegments } from '../src/db/schema/document-segments';
import { documents } from '../src/db/schema/documents';

const APPLY = process.argv.includes('--apply');

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function resolveStorageRoot(): string {
  const dir = process.env.STORAGE_DIR;
  if (!dir) throw new Error('STORAGE_DIR is not set');
  return path.resolve(dir);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  const root = resolveStorageRoot();

  // tripId null AND no rows in document_segments = no trip and no
  // segment owns this row anymore. We don't gate on `orphanedAt`
  // here: pre-orphan-aware deletions never stamped that column, and
  // this script needs to clean those up too.
  const rows = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      objectKey: documents.objectKey,
      originalName: documents.originalName,
      bytes: documents.bytes,
      sha256: documents.sha256,
      orphanedAt: documents.orphanedAt,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        isNull(documents.tripId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${documentSegments}
          WHERE ${documentSegments.documentId} = ${documents.id}
        )`,
      ),
    );

  if (rows.length === 0) {
    console.log('▸ no orphaned documents');
    await pool.end();
    return;
  }

  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`▸ found ${rows.length} orphaned document(s), ${formatBytes(totalBytes)} total\n`);

  for (const r of rows) {
    const abs = path.join(root, r.objectKey);
    const onDisk = existsSync(abs);
    const orphaned = r.orphanedAt ? r.orphanedAt.toISOString() : '(never stamped)';
    console.log(`  · ${r.id}`);
    console.log(`      name:        ${r.originalName}`);
    console.log(`      key:         ${r.objectKey}  ${onDisk ? '' : '(missing on disk)'}`);
    console.log(`      bytes:       ${formatBytes(r.bytes)}`);
    console.log(`      sha256:      ${r.sha256.slice(0, 12)}…`);
    console.log(`      orphaned at: ${orphaned}`);
    console.log(`      uploaded at: ${r.createdAt.toISOString()}\n`);
  }

  if (!APPLY) {
    console.log('▸ dry-run — pass --apply to delete the rows and files');
    await pool.end();
    return;
  }

  console.log('▸ applying deletes…\n');

  let rowsDeleted = 0;
  let filesDeleted = 0;
  let fileErrors = 0;

  for (const r of rows) {
    // Delete the row first so we never leave the DB pointing at a
    // missing file. If `fs.rm` then fails the file is orphaned on
    // disk — re-running this script picks it up via the FS scan path
    // (not implemented here; a future "scan disk for unreferenced
    // files" pass would be a separate concern).
    await db
      .delete(documents)
      .where(sql`${documents.id} = ${r.id}`)
      .execute();
    rowsDeleted += 1;

    const abs = path.join(root, r.objectKey);
    try {
      await fs.rm(abs, { force: true });
      filesDeleted += 1;
    } catch (e) {
      fileErrors += 1;
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
      console.error(`  ! failed to remove ${r.objectKey}: ${msg}`);
    }
  }

  console.log(
    `\n▸ done — ${rowsDeleted} row(s) deleted, ${filesDeleted} file(s) reclaimed${
      fileErrors > 0 ? `, ${fileErrors} file error(s)` : ''
    }`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error('cleanup failed:', err);
  process.exit(1);
});
