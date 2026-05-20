-- Atlas — Postgres init
-- Runs once on a fresh data directory.

-- For UUID generation (modern, no extension needed via gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- For trigram text search (fuzzy trip/place lookup)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- For case-insensitive text columns (emails, etc.)
CREATE EXTENSION IF NOT EXISTS "citext";

-- Uncomment when adding map/geo features:
-- CREATE EXTENSION IF NOT EXISTS "postgis";
