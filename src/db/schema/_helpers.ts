import { sql } from 'drizzle-orm';
import { customType, uuid } from 'drizzle-orm/pg-core';

/**
 * UUIDv7 primary key column. Uses Postgres 18's native `uuidv7()`
 * function — no extension needed.
 *
 * Why v7 instead of v4? UUIDv7 embeds a millisecond timestamp prefix,
 * so newly-inserted rows cluster by insertion time on disk. That makes
 * `ORDER BY id DESC LIMIT N` (and similar pagination queries on hot
 * tables like documents and segments) far cheaper than they'd be with
 * v4's random distribution.
 *
 * One helper, one place to flip if Drizzle adds a first-class
 * `defaultUuidV7()` helper or if PG renames the function.
 *
 * NOTE: the return type is intentionally left inferred. Drizzle's
 * insert-type machinery walks the builder chain to decide which columns
 * are optional in insert; an explicit annotation here erases the
 * "has default" flag and breaks `values({ email })` calls that should
 * omit `id`.
 */
export function uuidv7Pk() {
  return uuid('id').default(sql`uuidv7()`);
}

/**
 * Postgres `tsvector`. READ-ONLY from the app side: every consumer is
 * `GENERATED ALWAYS AS (...) STORED`, so Postgres maintains the value.
 * Don't .insert()/.update() these columns.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
