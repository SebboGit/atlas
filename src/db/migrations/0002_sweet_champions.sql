CREATE TABLE "flight_metadata_cache" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"carrier" varchar(3) NOT NULL,
	"flight_number" varchar(10) NOT NULL,
	"flight_date" date NOT NULL,
	"payload" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "flight_metadata_cache_key_uq" ON "flight_metadata_cache" USING btree ("carrier","flight_number","flight_date");--> statement-breakpoint
CREATE INDEX "flight_metadata_cache_expires_at_idx" ON "flight_metadata_cache" USING btree ("expires_at");