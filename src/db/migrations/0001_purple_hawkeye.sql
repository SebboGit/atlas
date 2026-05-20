ALTER TABLE "segments" ADD COLUMN "country_code" char(2);--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "origin_country_code" char(2);--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_origin_country_code_countries_code_fk" FOREIGN KEY ("origin_country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_trip_country_idx" ON "segments" USING btree ("trip_id","country_code");--> statement-breakpoint
CREATE INDEX "segments_trip_origin_country_idx" ON "segments" USING btree ("trip_id","origin_country_code");