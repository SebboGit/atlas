import { defineConfig } from '@playwright/test';

// E2E suite. Not part of the CI workflow today (it'd nearly double our
// minute budget). Run locally with `pnpm test:e2e`. When CI flips it on
// it should be a PR-only job that skips when src/app/ wasn't touched.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
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
      // Inert values — the smoke run never hits Auth.js callbacks.
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
