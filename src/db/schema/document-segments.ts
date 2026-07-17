import { index, pgEnum, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { documents } from './documents';
import { segments } from './segments';

// Who created the link. Extraction-created rows are owned by the
// re-extract lifecycle: `markExtractionStarted` wipes them and the
// bridge's orphan sweep may hard-delete their segments. Manual rows
// (the #103 attach flow) are invisible to that lifecycle — a re-extract
// must never delete a segment the user linked by hand.
export const documentSegmentSource = pgEnum('document_segment_source', ['extraction', 'manual']);

// Many-to-many link between documents and segments. Replaced the
// `documents.segment_id` 1:1 FK once multi-flight documents (return
// trips, multi-leg bookings) became first-class — a single boarding-
// pass PDF can now extract to N segments and link to each.
//
// ON DELETE CASCADE on both sides so a deleted document or segment
// drops its link rows automatically; identical observable behaviour
// to the old `ON DELETE SET NULL` in the single-link case, but no
// dangling rows to sweep when one side goes away.
//
// Composite PK on (document_id, segment_id) doubles as the dedupe
// guarantee: a second attempt to link the same pair is a noop with
// ON CONFLICT DO NOTHING. The secondary index on segment_id
// supports "which documents back this segment?" lookups.
export const documentSegments = pgTable(
  'document_segments',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    // Default 'extraction': every row that existed before this column
    // was added came from the extraction bridge.
    source: documentSegmentSource('source').notNull().default('extraction'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.segmentId] }),
    index('document_segments_segment_idx').on(t.segmentId),
  ],
);

export type DocumentSegment = typeof documentSegments.$inferSelect;
export type NewDocumentSegment = typeof documentSegments.$inferInsert;
