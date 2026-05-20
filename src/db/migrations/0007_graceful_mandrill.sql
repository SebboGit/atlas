CREATE TABLE "document_segments" (
	"document_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_segments_document_id_segment_id_pk" PRIMARY KEY("document_id","segment_id")
);
--> statement-breakpoint
ALTER TABLE "document_segments" ADD CONSTRAINT "document_segments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_segments" ADD CONSTRAINT "document_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_segments_segment_idx" ON "document_segments" USING btree ("segment_id");--> statement-breakpoint
-- Backfill: lift the existing 1:1 documents.segment_id link into the new
-- many-to-many table before dropping the column. Uses the document's
-- createdAt as a stand-in for "when the link was made" — we never
-- recorded the actual link time on the old single-column model, so this
-- is the closest non-arbitrary value available. ON CONFLICT DO NOTHING
-- is cheap insurance against a future re-run of the same migration on a
-- partially-applied DB; with the 1:1 source it cannot otherwise conflict.
INSERT INTO "document_segments" ("document_id", "segment_id", "created_at")
	SELECT "id", "segment_id", "created_at" FROM "documents" WHERE "segment_id" IS NOT NULL
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_segment_id_segments_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "segment_id";
--> statement-breakpoint
-- Folded-in: hot-path index for trip-level document listings. The
-- column has lived on `documents` since 0000 but was never indexed;
-- now that we're touching the table in this migration, add it.
-- Partial WHERE skips orphaned rows (tripId = NULL) to keep the
-- index small.
CREATE INDEX "documents_trip_id_idx" ON "documents" USING btree ("trip_id") WHERE "documents"."trip_id" IS NOT NULL;

