CREATE TYPE "public"."wishlist_item_type" AS ENUM('food', 'activity');--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "wishlist_item_type" NOT NULL,
	"country_code" char(2) NOT NULL,
	"location_name" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_text" text GENERATED ALWAYS AS (regexp_replace(coalesce(location_name, '') || ' ' || coalesce(notes, '') || ' ' || extract_jsonb_text(data), '([a-z])([A-Z])', '\1 \2', 'g')) STORED,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', regexp_replace(extract_jsonb_text(data), '([a-z])([A-Z])', '\1 \2', 'g')), 'A') || setweight(to_tsvector('simple', regexp_replace(coalesce(location_name, ''), '([a-z])([A-Z])', '\1 \2', 'g')), 'B') || setweight(to_tsvector('simple', coalesce(notes, '')), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "wishlist_item_id" uuid;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_items_country_type_idx" ON "wishlist_items" USING btree ("country_code","type");--> statement-breakpoint
CREATE INDEX "wishlist_items_created_at_idx" ON "wishlist_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wishlist_items_search_tsv_idx" ON "wishlist_items" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "wishlist_items_search_text_trgm_idx" ON "wishlist_items" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_wishlist_item_id_wishlist_items_id_fk" FOREIGN KEY ("wishlist_item_id") REFERENCES "public"."wishlist_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_wishlist_item_id_idx" ON "segments" USING btree ("wishlist_item_id") WHERE "segments"."wishlist_item_id" IS NOT NULL;