---
name: atlas-quality-gates
description: Use before declaring any Atlas code change complete. Pre-merge checklist of `pnpm typecheck`, `pnpm lint`, `pnpm test`, and (when routing/RSC/config changed) `pnpm build`. For UI changes, also requires responsive verification at 360×640 and 1440×900 viewports per the responsive-design rules in CLAUDE.md. Complements the user-level `verify` skill (which runs the app in a browser).
---

# Atlas — Quality Gates

Run these before declaring any change done. CI runs the same set, so failing locally means failing CI.

## Required for every code change

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## Required when routing/RSC/config changed

- `pnpm build` — production build sanity check.

A change touches "routing/RSC/config" when it edits:

- `src/app/**` route boundaries (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`)
- `'use client'` boundaries
- `next.config.ts` / `drizzle.config.ts` / `tsconfig.json` / `package.json`
- middleware (`src/proxy.ts`)

## Required for UI changes

Verify in browser devtools at both anchor viewports per CLAUDE.md's responsive-design rules:

- **360 × 640** — iPhone SE class, smallest realistic target
- **1440 × 900** — typical MacBook viewport

Both should look intentional. If one looks like a compromise made for the other, the design isn't done. The full responsive-design rule set lives in `CLAUDE.md`.

## E2E

Playwright (`pnpm test:e2e`) is **local-only** today — it's not wired into CI per the CI minute budget. Run it before merging anything user-flow-shaped (sign-in, document upload, segment create/edit).

## Complements the `verify` skill

The user-level `verify` skill covers running the app in a real browser and observing behavior. `atlas-quality-gates` is the static/automated side. For a feature-sized change, do both.

## After the gates pass

- Update `CLAUDE.md` if conventions/structure/tech choices changed.
- Schema changes follow the `atlas-migrations` workflow.
- New external integrations follow the External Integrations rules in `CLAUDE.md`.
