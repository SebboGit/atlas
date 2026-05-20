CREATE TABLE "user_visited_countries" (
	"user_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_visited_countries_user_id_country_code_pk" PRIMARY KEY("user_id","country_code")
);
--> statement-breakpoint
ALTER TABLE "user_visited_countries" ADD CONSTRAINT "user_visited_countries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_visited_countries" ADD CONSTRAINT "user_visited_countries_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;