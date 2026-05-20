---
name: atlas-migrations
description: Use when adding or modifying Atlas database schema (anything under `src/db/schema/`). Covers the Drizzle schema edit → `pnpm db:generate` → review SQL → commit workflow, the forward-only no-rollback rule, what to commit together, and how schema changes ripple through repos and server actions without leaking the DB layer into UI code.
---

# Atlas — Database Migrations

Schema lives in `src/db/schema/`, one file per domain aggregate. Migrations are generated SQL committed under `src/db/migrations/`.

## Workflow

1. **Edit the Drizzle schema** in `src/db/schema/<aggregate>.ts`.
2. **Generate the migration:** `pnpm db:generate`.
3. **Review the generated SQL** in `src/db/migrations/`. Catch:
   - Destructive changes you didn't intend (column drops, type changes that lose data).
   - Missing indexes on new foreign keys.
   - `NOT NULL` columns without a default on an existing populated table.
4. **Commit both** the schema edit and the generated migration file together. They are one logical change.
5. **Apply locally:** `pnpm db:migrate` (or just `pnpm dev:up`, which runs it).

## Rules

- **Forward-only.** Migrations don't roll back in production. If a migration is wrong, write a follow-up forward-fix migration. Never edit an applied migration.
- **No leaking the DB layer.** Components never import from `src/db/*`. Schema changes ripple through repos and server actions in `src/lib/<feature>/`, not into UI code.
- **Reference data is a committed snapshot, not a table.** IATA codes, ISO countries, airport coords etc. live as JSON under `src/lib/<thing>/`, not as DB tables. Don't migrate reference data into Postgres without an ADR (see Architectural Guardrail #13 + ADR-0009).
- **Search uses generated `tsvector` columns on source tables** per ADR-0013. No central `search_index` table.
- **`userId` semantics.** New `userId` columns are now `createdBy` provenance, not ownership — household sharing is the default visibility model.

## Adding a new aggregate

- One schema file per aggregate.
- Repo lives at `src/lib/<feature>/repo.ts`. Server actions colocated.
- All input validated with Zod at the action boundary.
- Include `createdAt` / `updatedAt` `timestamptz` columns by convention.
