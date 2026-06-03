CREATE TYPE "public"."trip_visibility" AS ENUM('household', 'private');--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "visibility" "trip_visibility" DEFAULT 'household' NOT NULL;