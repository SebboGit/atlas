CREATE TYPE "public"."notification_delivery_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"topic" text NOT NULL,
	"kind" text NOT NULL,
	"segment_id" uuid NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_notification_mutes" (
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_notification_mutes_user_id_trip_id_pk" PRIMARY KEY("user_id","trip_id")
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_notification_mutes" ADD CONSTRAINT "trip_notification_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_notification_mutes" ADD CONSTRAINT "trip_notification_mutes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedupe_idx" ON "notification_deliveries" USING btree ("topic","kind","segment_id","fire_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_segment_idx" ON "notification_deliveries" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trip_notification_mutes_trip_idx" ON "trip_notification_mutes" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "segments_starts_at_idx" ON "segments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "segments_hotel_ends_at_idx" ON "segments" USING btree ("ends_at") WHERE "segments"."type" = 'hotel';