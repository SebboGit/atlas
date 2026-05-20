# Development

How to set up a local development environment, run the quality gates, and
work in this codebase. The architectural conventions and rules live in
[`CLAUDE.md`](../CLAUDE.md) — this file documents the day-to-day workflow.

---

## Prerequisites

| Tool    | Version | Notes                                       |
| ------- | ------- | ------------------------------------------- |
| Node.js | 24.x    | Pinned in [`.nvmrc`](../.nvmrc)             |
| pnpm    | 9.15+   | `corepack enable` picks the pinned version  |
| Docker  | 24+     | With Compose v2                             |
| Ollama  | 0.3+    | Optional locally — only for extraction work |

---

## First-run setup

```bash
git clone <repository-url> atlas
cd atlas
pnpm install
cp .env.example .env
# Edit .env: set AUTH_SECRET with `openssl rand -base64 32`.
# OIDC_* values are only needed if you want to test the sign-in flow —
# the landing page renders without them.

pnpm dev:up    # postgres → migrate → seed → next dev
```

The app comes up on http://localhost:3000.

## Daily workflow

```bash
pnpm dev:up         # one-shot: start postgres, migrate, seed, run dev server
pnpm dev            # just next dev (requires postgres + migrations already done)
pnpm db:reset       # nuke postgres volume and re-seed from scratch
pnpm db:studio      # Drizzle Studio — browse and edit the DB
```

---

## Quality gates

These are what CI runs. Run them locally before opening a PR:

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint (flat config)
pnpm test           # Vitest (unit)
pnpm build          # Next.js production build
```

End-to-end tests with Playwright run locally only (not wired into CI yet
to stay inside the free GitHub Actions minute budget):

```bash
pnpm test:e2e
```

---

## Project conventions

The full set of conventions lives in [`CLAUDE.md`](../CLAUDE.md). The
short version:

### TypeScript

- `"strict": true` plus `noUncheckedIndexedAccess`.
- No `any` without a justification comment.
- Absolute imports via the `@/*` alias rooted at `src/`.

### File naming

- `kebab-case.ts` for files, `PascalCase` for React components inside
  (e.g. `trip-card.tsx` exports `TripCard`).
- Server actions colocated with the feature, exported from `actions.ts`,
  all input Zod-validated.
- Unit tests live next to the file they cover: `foo.ts` + `foo.test.ts`.
- E2E tests live in `tests/e2e/`.

### Architecture rules (a few highlights)

- **Server Components by default.** Use `'use client'` only when a hook,
  browser API, or interactivity demands it.
- **Server Actions for mutations.** Don't add `/api/*` routes for
  first-party UI mutations.
- **No leaking the DB layer.** Components never import from `src/db/*`.
  All DB access goes through `src/lib/<feature>/repo.ts`.
- **No leaking the storage layer.** Components never import from
  `src/lib/storage/*` directly.
- **Validation at trust boundaries.** Every server action and API route
  validates input with Zod.
- **Migrations are forward-only.** Use `pnpm db:generate` to create one,
  review the SQL, commit both.

See [CLAUDE.md → Architectural Guardrails](../CLAUDE.md#architectural-guardrails)
for the full list.

---

## Database

The schema lives in `src/db/schema/`, one file per domain aggregate.

```bash
# After editing a schema file:
pnpm db:generate         # generates SQL migration
# Review the generated SQL in src/db/migrations/
pnpm db:migrate          # applies pending migrations
git add src/db/schema src/db/migrations
```

Migrations are forward-only. If a migration produces unwanted behaviour
in production, write a corrective forward-fix migration — never roll
back.

---

## Git workflow

### Branches

- `main` — always deployable
- `feat/<short-name>` — new feature
- `fix/<short-name>` — bug fix
- `chore/<short-name>` — tooling, refactor, dependency bumps
- `docs/<short-name>` — documentation only

### Commits

[Conventional Commits](https://www.conventionalcommits.org/) format:

- `feat:` new feature
- `fix:` bug fix
- `chore:` tooling, deps, refactor
- `refactor:` non-functional restructure
- `docs:` documentation only
- `test:` adding or fixing tests

One logical change per commit. Keep diffs small and reviewable.

### Pull requests

Use the [PR template](../.github/pull_request_template.md). Every PR
should:

- Be small and focused (one logical change).
- Reference an ADR if it introduces an architectural decision.
- Pass all four gates (typecheck, lint, test, build).
- Include screenshots for any UI change, captured at **360×640**
  (mobile) and **1440×900** (laptop) — both must look intentional.

---

## Architecture Decision Records (ADRs)

Non-obvious decisions live in [`docs/adr/`](./adr/) as numbered ADRs.
When you make a choice that future-you would want a paper trail for
(library, pattern, tradeoff), write an ADR using the template at
[`docs/adr/0000-template.md`](./adr/0000-template.md).

ADRs are immutable once accepted. To change a decision, write a new ADR
that supersedes the old one — see ADR-0009 superseding ADR-0007 for an
example.

---

## Responsive design

This is **non-negotiable** per [CLAUDE.md → Responsive Design](../CLAUDE.md#responsive-design-non-negotiable):
every UI feature must look intentional at both 360×640 and 1440×900.
Stretching a mobile layout to fill a laptop, or cropping a laptop layout
onto a phone, is not acceptable.

Before declaring a UI change done:

- [ ] Sketched at 360 and 1440 first, not retrofitted.
- [ ] Touch targets ≥ 44×44px on touch devices.
- [ ] Native input modes on mobile (`inputMode`, `type="date"`).
- [ ] Keyboard-first on laptop (Tab order, `Esc` closes, `Enter` submits).
- [ ] No horizontal scroll outside intentional components.
- [ ] Tested at both breakpoints in browser devtools.

---

## Working with Claude Code

This project is designed for Claude Code-assisted development.

1. Read [`CLAUDE.md`](../CLAUDE.md) — it's the canonical reference for
   conventions, architecture, and agents.
2. Sub-agents are installed at the user scope (`~/.claude/agents/`), not
   in this repository.
3. Reference agents by name when invoking: _"Use the Backend Architect
   agent to design X."_, _"Have the Security Engineer review this file
   upload code."_

Recommended agents for common Atlas tasks are listed in
[CLAUDE.md → Agents](../CLAUDE.md#agents).

---

## Useful commands

```bash
# Maintenance
pnpm docs:cleanup-orphans            # list orphan documents (dry-run)
pnpm docs:cleanup-orphans --apply    # delete orphan rows + files
pnpm db:prune                        # list expired sessions/tokens (dry-run)
pnpm db:prune --apply                # delete them

# Scheduler (runs automatically in the `cron` compose service)
pnpm cron                            # boot scheduler locally (SIGINT to stop)
docker compose logs -f cron          # tail in-stack scheduler

# Reference data refresh
pnpm tsx scripts/fetch-airlines.ts   # rebuild iata-airlines.json
```

See [`package.json`](../package.json) for the full script list.
