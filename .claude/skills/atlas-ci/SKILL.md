---
name: atlas-ci
description: Use when editing `.github/workflows/`, adding a new CI job to Atlas, or evaluating CI cost. Covers what the existing pipeline runs, the 2,000-minute private-repo free-tier budget, the cost-discipline rules (Linux-only runners, concurrency cancellation, pnpm cache, per-job timeouts), and guidance on which kinds of workflows to defer or gate.
---

# Atlas — CI / GitHub Actions

The repo runs on GitHub Actions under the free 2,000-minute private-repo allowance. Defaults are chosen to stay well inside that budget.

## What runs

`.github/workflows/ci.yml` runs on every push to `main` and every PR targeting it:

1. Set up pnpm + Node (version pinned by `.nvmrc`)
2. `pnpm install --frozen-lockfile` (cached by pnpm-lock hash; the same install is reused by an advisory `pnpm audit --prod` step at the end of the job, non-blocking; no allow-listed baseline today, `pnpm.auditConfig.ignoreGhsas` is where one would go)
3. `pnpm db:migrate` against a Postgres service container
4. `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`

Vitest runs three times in step 4 — once on the runner's UTC default, then at `TZ=Pacific/Kiritimati` and `TZ=Pacific/Niue` — so a date path that leans on the runner's zone fails the build (ADR-0014/0016). All three are steps in the same job and reuse the warm install. A second job in the same workflow, `secrets`, scans the full history with gitleaks off its own `fetch-depth: 0` checkout.

## Cost discipline

- **Linux runners only** (1x multiplier). No macOS or Windows.
- `concurrency` group cancels superseded runs on the same branch.
- pnpm cache enabled via `actions/setup-node`.
- `timeout-minutes: 15` per job — fail fast on a stuck pipeline.
- Dependabot groups minor/patch updates, so one PR triggers one CI run, not ten.
- A PR matching the e2e `paths` filter spends two workflows, not one: `ci.yml` plus the Chromium + Postgres job in `e2e.yml`. That filter is the only thing keeping the browser job off unrelated PRs.

Rough budget: `ci.yml` bills 4 minutes per run — the quality job runs just past two minutes and the gitleaks job about ten seconds, each rounded up to the minute — so the free tier covers roughly 500 runs a month. A path-matching PR adds the 3-minute browser job for 7, cutting that to under 300. Track usage at _Settings → Billing → Plans and usage_.

## Adding workflows

Be careful about adding workflows that burn minutes. Heavy candidates to defer or gate:

- Docker image builds → push to GHCR. Only on tag, not every push.
- E2E (Playwright) → gated by a `paths` filter in `e2e.yml`; see below.
- Security scans → fine, usually fast.

## E2E status

Playwright runs in CI as its own workflow, `.github/workflows/e2e.yml`, on pull requests and on pushes to `main`. It is kept separate from `ci.yml` so a `paths` filter can gate it: doc-only and unrelated changes skip the browser job while lint/typecheck/test/build still run on everything.

The filter lists every file the job executes — source, e2e specs, the seed script, the lockfile, and the toolchain and config inputs. The Dockerfile and `drizzle.config.ts` are deliberately absent because the job never touches either. Keep the push and pull_request lists identical, and add a file whenever the job starts depending on it. The workflow header comment carries the full rationale.

Because a skipped `paths`-filtered workflow never reports a result, this job must not be a required status check on `main`.
