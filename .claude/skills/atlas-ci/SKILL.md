---
name: atlas-ci
description: Use when editing `.github/workflows/`, adding a new CI job to Atlas, or evaluating CI cost. Covers what the existing pipeline runs, the 2,000-minute private-repo free-tier budget, the cost-discipline rules (Linux-only runners, concurrency cancellation, pnpm cache, per-job timeouts), and guidance on which kinds of workflows to defer or gate.
---

# Atlas — CI / GitHub Actions

The repo runs on GitHub Actions under the free 2,000-minute private-repo allowance. Defaults are chosen to stay well inside that budget.

## What runs

`.github/workflows/ci.yml` runs on every push to `main` and every PR targeting it:

1. Set up pnpm + Node (version pinned by `.nvmrc`)
2. `pnpm install --frozen-lockfile` (cached by pnpm-lock hash)
3. `pnpm db:migrate` against a Postgres service container
4. `pnpm typecheck` · `pnpm lint` · `pnpm test --run` · `pnpm build`

## Cost discipline

- **Linux runners only** (1x multiplier). No macOS or Windows.
- `concurrency` group cancels superseded runs on the same branch.
- pnpm cache enabled via `actions/setup-node`.
- `timeout-minutes: 15` per job — fail fast on a stuck pipeline.
- Dependabot groups minor/patch updates, so one PR triggers one CI run, not ten.

Rough budget at 4 minutes/run: ~500 runs/month before exhausting the free tier. Track usage at _Settings → Billing → Plans and usage_.

## Adding workflows

Be careful about adding workflows that burn minutes. Heavy candidates to defer or gate:

- Docker image builds → push to GHCR. Only on tag, not every push.
- E2E (Playwright) → only on PRs, not push to main, or only when changed paths include `src/app/`.
- Security scans → fine, usually fast.

## E2E status

Playwright is deliberately **not wired into CI** — it lives locally only (see the `e2e-not-in-ci` memory). Reintroducing it requires either a path-gated trigger or accepting the minute-budget impact.
