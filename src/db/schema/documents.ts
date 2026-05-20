import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tsvector, uuidv7Pk } from './_helpers';
import { trips } from './trips';
import { users } from './users';

export const extractionMethod = pgEnum('extraction_method', [
  'pdf-text',
  'ocr-tesseract',
  'ocr-paddle',
  'llm-haiku',
  'llm-local',
  'pkpass',
  'manual',
]);

// Text-extractor stage that produced the input to the LLM (or null when
// a direct extractor like pkpass bypassed the LLM entirely). Persisted
// separately from `parsedBy` so we can audit which OCR / text path fed
// each row without losing the "what produced the structured payload"
// answer.
export const textExtractionMethod = pgEnum('text_extraction_method', [
  'pdf-text',
  'ocr-tesseract',
  'email',
]);

// Closed set of failure reasons emitted by the extraction orchestrator.
// Mirrors `ExtractionFailureReason` in src/lib/extraction/types.ts.
// Constrained to a pgEnum so a stray write (e.g. accidentally writing
// `err.message`) can't quietly corrupt the column.
export const extractionFailureReason = pgEnum('extraction_failure_reason', [
  'pdf-empty',
  'ocr-empty',
  'llm-unavailable',
  'llm-invalid-json',
  'all-extractors-failed',
]);

export const reviewStatus = pgEnum('review_status', ['pending', 'confirmed', 'rejected']);

export const documents = pgTable(
  'documents',
  {
    id: uuidv7Pk().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),

    // Filesystem key relative to STORAGE_DIR. Immutable.
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    originalName: text('original_name').notNull(),

    parsed: jsonb('parsed'),
    parsedConfidence: real('parsed_confidence'),
    parsedBy: extractionMethod('parsed_by'),
    // Which text-extraction stage fed the LLM. NULL for direct extractors
    // (pkpass) and for documents that haven't been attempted yet. The
    // pair (parsedBy, textMethod) tells the full audit story:
    //   parsedBy=llm-local, textMethod=pdf-text   → text-PDF → LLM
    //   parsedBy=pkpass,    textMethod=null       → pkpass direct, no LLM
    //   parsedBy=null,      textMethod=null       → never attempted
    textMethod: textExtractionMethod('text_method'),
    // Populated when the extraction pipeline fails to produce a structured
    // payload — records *why*. NULL means "not attempted" or "succeeded".
    // Distinct from `parsedBy` which records which extractor won.
    extractionError: extractionFailureReason('extraction_error'),

    // Set when an extraction job is enqueued; cleared when the job
    // finishes (success or failure). NULL means "not currently being
    // extracted." Drives the UI's "Extracting…" state via the Jobs
    // interface (see src/lib/jobs/). A stale value indicates the
    // Node process restarted mid-job — the UI treats anything older
    // than EXTRACTION_STALE_MS as eligible to re-trigger; the periodic
    // sweep (future) can reset it.
    extractionStartedAt: timestamp('extraction_started_at', {
      withTimezone: true,
      mode: 'date',
    }),

    // User-confirmed values that survive a re-extract.
    overrides: jsonb('overrides').notNull().default({}),
    reviewStatus: reviewStatus('review_status').notNull().default('pending'),

    // Set by the repo layer when a document is unlinked from both
    // trip and segment. The periodic sweep job uses this to apply
    // a grace period before deleting the underlying file. NULL means
    // "not orphaned" (currently linked, or never linked but waiting
    // for the first link). See DOMAIN_MODEL.md invariant #7.
    orphanedAt: timestamp('orphaned_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Global Cmd+K search. Postgres maintains both columns via
    // GENERATED ALWAYS — never .insert()/.update() them. The
    // regexp_replace splits punctuation in `original_name` (filenames
    // like `oman_air.pdf` are otherwise one opaque token under the
    // `simple` tsvector parser). See migration 0011.
    searchText: text('search_text').generatedAlwaysAs(
      sql`regexp_replace(coalesce(original_name, ''), '[^a-zA-Z0-9]+', ' ', 'g') || ' ' || extract_jsonb_text(coalesce(parsed, '{}'::jsonb)) || ' ' || extract_jsonb_text(coalesce(overrides, '{}'::jsonb))`,
    ),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', regexp_replace(coalesce(original_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'A') || setweight(to_tsvector('simple', extract_jsonb_text(coalesce(parsed, '{}'::jsonb)) || ' ' || extract_jsonb_text(coalesce(overrides, '{}'::jsonb))), 'B')`,
    ),
  },
  (d) => [
    // Idempotent imports: same content + same user is a no-op.
    uniqueIndex('documents_user_sha256_uq').on(d.userId, d.sha256),
    // Sweep query — only scan rows that are actually orphaned.
    index('documents_orphaned_at_idx')
      .on(d.orphanedAt)
      .where(sql`${d.orphanedAt} IS NOT NULL`),
    // Trip-level document list (every trip-detail render). Partial
    // index skips rows that have been detached from their trip
    // (orphans waiting for sweep) — keeps the index small without
    // losing any hot-path coverage.
    index('documents_trip_id_idx')
      .on(d.tripId)
      .where(sql`${d.tripId} IS NOT NULL`),
    index('documents_search_tsv_idx').using('gin', d.searchTsv),
    index('documents_search_text_trgm_idx').using('gin', sql`${d.searchText} gin_trgm_ops`),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
