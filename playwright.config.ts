import { defineConfig } from '@playwright/test';

// E2E suite. Runs in CI via .github/workflows/e2e.yml and locally via
// `pnpm test:e2e`. Tests share a single sentinel test user
// (`e2e@test.invalid`) inserted + torn down by the auth fixture, so
// `fullyParallel: false` + `workers: 1` keeps them serial — parallel
// workers would race on the cleanup-and-insert step.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // 60s per test rather than the default 30s. `next dev` cold-compiles
  // each route on first hit (no .next cache on CI runners), and the
  // first `goto()` in a fresh worker can routinely take 15–25s before
  // assertions even start.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Spin the app up for the suite. We use `next dev` rather than
  // `pnpm start` because `output: 'standalone'` makes `next start` exit
  // with an error — the standalone artifact is meant to run via
  // `node .next/standalone/server.js`. `next dev` is closer to what a
  // developer iterates against and avoids needing a fresh `pnpm build`
  // before every e2e run.
  webServer: {
    command: 'pnpm dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // AUTH_SECRET in CI is generated per-run (see e2e.yml). Locally
      // the fallback keeps `pnpm test:e2e` runnable without ceremony.
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'playwright-only-secret',
      AUTH_URL: process.env.AUTH_URL ?? 'http://localhost:3000',
      OIDC_ISSUER_URL: process.env.OIDC_ISSUER_URL ?? 'http://localhost:0',
      OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID ?? 'playwright',
      OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? 'playwright',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://atlas:atlas@localhost:5432/atlas',
      STORAGE_DIR: process.env.STORAGE_DIR ?? '/tmp/atlas-documents',
    },
  },
});
