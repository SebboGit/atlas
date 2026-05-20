-- Extracted carrier and airline names in `segments.data` arrive as
-- single CamelCase tokens — `AirAsia`, `MalaysianAirlinesSystem`,
-- `EasyJet`. The `simple` tsvector parser keeps a CamelCase run as one
-- token, so `to_tsvector('simple', 'AirAsia')` produces `'airasia':1`.
-- A query `"Air Asia"` parses as `'air' & 'asia'` (two required tokens)
-- which never matches the single-token index entry. Trigram similarity
-- also drops because the query and indexed text share fewer trigrams
-- once whitespace differs.
--
-- Fix: insert a space at every lowercase→uppercase boundary inside the
-- generated text and tsvector expressions. `AirAsia` becomes `Air Asia`
-- → `'air' & 'asia'` matches; pure uppercase strings (`MUC`, `KUL`) are
-- untouched; already-spaced names (`Vietnam Airlines`) are unaffected.
--
-- Same DROP / ADD / re-INDEX dance as migration 0011 for documents,
-- applied to segments here. The JSONB walk via extract_jsonb_text is
-- unchanged; the regex sits between the walk and tokenisation.

DROP INDEX IF EXISTS "segments_search_tsv_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "segments_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN IF EXISTS "search_text";
--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint

ALTER TABLE "segments"
  ADD COLUMN "search_text" text
    GENERATED ALWAYS AS (
      regexp_replace(
        coalesce("location_name", '') || ' ' || extract_jsonb_text("data"),
        '([a-z])([A-Z])', '\1 \2', 'g'
      )
    ) STORED;
--> statement-breakpoint
ALTER TABLE "segments"
  ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(
        to_tsvector(
          'simple',
          regexp_replace(coalesce("location_name", ''), '([a-z])([A-Z])', '\1 \2', 'g')
        ),
        'A'
      ) ||
      setweight(
        to_tsvector(
          'simple',
          regexp_replace(extract_jsonb_text("data"), '([a-z])([A-Z])', '\1 \2', 'g')
        ),
        'B'
      )
    ) STORED;
--> statement-breakpoint
CREATE INDEX "segments_search_tsv_idx" ON "segments" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "segments_search_text_trgm_idx" ON "segments" USING gin ("search_text" gin_trgm_ops);
