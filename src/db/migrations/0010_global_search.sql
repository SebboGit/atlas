-- Global Cmd+K search over trips, segments, documents.
--
-- Index lives on the source tables — not a central search_index — via
-- GENERATED ALWAYS columns. Postgres recomputes them on every write,
-- so there is zero application-side reindex logic and zero drift risk.
--
-- Two parallel generated columns per table:
--   search_text  (text)     — canonical text soup; pg_trgm fuzzy matching.
--   search_tsv   (tsvector) — full-text index for keyword matching.
--
-- Text-search config is `simple` (no stemming). Multilingual content
-- (Hanoi, München, Tōkyō, Vietnamese hotel names) — English stemming
-- would mangle non-English tokens.
--
-- pg_trgm is already enabled in docker/postgres/init/01-extensions.sql;
-- IF NOT EXISTS keeps fresh DBs without that init script safe.
--
-- Trip-level country search is intentionally NOT folded in. Country
-- names live one join away (segments.country_code → countries.name).
-- Callers searching "Japan" still find the trip via its segments.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Walk a JSONB tree and concatenate every string leaf. IMMUTABLE +
-- PARALLEL SAFE so generated columns can use it.
--
-- The aggregate uses ORDER BY ordinality to honour the IMMUTABLE
-- contract under parallel execution. Without the ordering, a parallel
-- string_agg could combine partial results in any order on a future
-- planner; the resulting `search_text` would still be a valid string
-- but its bytes would differ across rebuilds — silently corrupting the
-- stored generated column when a CHECK or COMPARE runs against it.
CREATE OR REPLACE FUNCTION extract_jsonb_text(j jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    (
      SELECT string_agg(value #>> '{}', ' ' ORDER BY ord)
      FROM jsonb_path_query(j, 'strict $.**')
        WITH ORDINALITY AS t(value, ord)
      WHERE jsonb_typeof(value) = 'string'
    ),
    ''
  );
$$;
--> statement-breakpoint

-- TRIPS
ALTER TABLE "trips"
  ADD COLUMN "search_text" text
    GENERATED ALWAYS AS (
      coalesce("title", '') || ' ' || coalesce("summary", '')
    ) STORED;
--> statement-breakpoint
ALTER TABLE "trips"
  ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("summary", '')), 'B')
    ) STORED;
--> statement-breakpoint
CREATE INDEX "trips_search_tsv_idx" ON "trips" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "trips_search_text_trgm_idx" ON "trips" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint

-- SEGMENTS
-- A: location_name. B: every string leaf in the data JSONB.
ALTER TABLE "segments"
  ADD COLUMN "search_text" text
    GENERATED ALWAYS AS (
      coalesce("location_name", '') || ' ' || extract_jsonb_text("data")
    ) STORED;
--> statement-breakpoint
ALTER TABLE "segments"
  ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("location_name", '')), 'A') ||
      setweight(to_tsvector('simple', extract_jsonb_text("data")), 'B')
    ) STORED;
--> statement-breakpoint
CREATE INDEX "segments_search_tsv_idx" ON "segments" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "segments_search_text_trgm_idx" ON "segments" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint

-- DOCUMENTS
-- A: original_name. B: parsed payload + user-confirmed overrides.
ALTER TABLE "documents"
  ADD COLUMN "search_text" text
    GENERATED ALWAYS AS (
      coalesce("original_name", '') || ' ' ||
      extract_jsonb_text(coalesce("parsed", '{}'::jsonb)) || ' ' ||
      extract_jsonb_text(coalesce("overrides", '{}'::jsonb))
    ) STORED;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("original_name", '')), 'A') ||
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
