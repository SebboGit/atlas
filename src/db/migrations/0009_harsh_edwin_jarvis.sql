CREATE TABLE "geocode_cache" (
	"query_normalized" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"display_name" text,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
