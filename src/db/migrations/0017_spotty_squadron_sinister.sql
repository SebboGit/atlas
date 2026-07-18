-- User-editable document title (#102). `title` must exist before the
-- regenerated search columns reference it, so it is added first —
-- drizzle-kit emitted it last, which would fail. Dropping a generated
-- column also drops its indexes, so the GIN indexes are recreated
-- explicitly (same dance as migration 0011).
ALTER TABLE "documents" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "documents" drop column "search_text";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_text" text GENERATED ALWAYS AS (coalesce(title, '') || ' ' || regexp_replace(coalesce(original_name, ''), '[^a-zA-Z0-9]+', ' ', 'g') || ' ' || extract_jsonb_text(coalesce(parsed, '{}'::jsonb)) || ' ' || extract_jsonb_text(coalesce(overrides, '{}'::jsonb))) STORED;--> statement-breakpoint
ALTER TABLE "documents" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '') || ' ' || regexp_replace(coalesce(original_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'A') || setweight(to_tsvector('simple', extract_jsonb_text(coalesce(parsed, '{}'::jsonb)) || ' ' || extract_jsonb_text(coalesce(overrides, '{}'::jsonb))), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "documents_search_tsv_idx" ON "documents" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "documents_search_text_trgm_idx" ON "documents" USING gin ("search_text" gin_trgm_ops);
