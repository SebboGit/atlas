ALTER TABLE "locations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "locations" CASCADE;--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verificationTokens" USING btree ("expires");