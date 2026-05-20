-- Filenames are often punctuation-glued tokens — `oman_air.pdf`,
-- `boarding_pass_VN.pdf`, `Reservation-2024-08-12.pdf`. The `simple`
-- tsvector parser keeps underscores, dots, and hyphens as word
-- characters, so `to_tsvector('simple', 'oman_air.pdf')` produces a
-- single token `'oman_air.pdf'`. A query for `"oman"` doesn't match,
-- and trigram similarity against the full search_text (a long line of
-- route codes + dates) drops below the 0.2 threshold.
--
-- Fix: rewrite the generated expression on `documents.search_text` and
-- `documents.search_tsv` so `original_name` is passed through
-- `regexp_replace('[^a-zA-Z0-9]+', ' ')` before tokenisation. The JSONB
-- walks on `parsed` and `overrides` are unchanged.
--
-- Generated column expressions are immutable once defined — to change
-- them we DROP and re-ADD the columns. The GIN indexes are dependent
-- so they drop with the columns; we recreate them after.

DROP INDEX IF EXISTS "documents_search_tsv_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "documents_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "search_text";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint

ALTER TABLE "documents"
  ADD COLUMN "search_text" text
    GENERATED ALWAYS AS (
      regexp_replace(coalesce("original_name", ''), '[^a-zA-Z0-9]+', ' ', 'g') || ' ' ||
      extract_jsonb_text(coalesce("parsed", '{}'::jsonb)) || ' ' ||
      extract_jsonb_text(coalesce("overrides", '{}'::jsonb))
    ) STORED;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(
        to_tsvector(
          'simple',
          regexp_replace(coalesce("original_name", ''), '[^a-zA-Z0-9]+', ' ', 'g')
        ),
        'A'
      ) ||
      setweight(
        to_tsvector(
          'simple',
          extract_jsonb_text(coalesce("parsed", '{}'::jsonb)) || ' ' ||
          extract_jsonb_text(coalesce("overrides", '{}'::jsonb))
        ),
        'B'
      )
    ) STORED;
--> statement-breakpoint
CREATE INDEX "documents_search_tsv_idx" ON "documents" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "documents_search_text_trgm_idx" ON "documents" USING gin ("search_text" gin_trgm_ops);
