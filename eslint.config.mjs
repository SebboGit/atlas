// @ts-check
import next from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'src/db/migrations/**',
      'next-env.d.ts',
    ],
  },

  ...next,

  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Enforce the "no leaking the auth provider" guardrail.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next-auth',
              message:
                'Import from @/lib/auth/* instead. See CLAUDE.md → Architectural Guardrails.',
            },
            {
              name: 'next-auth/providers/oidc',
              message: 'Provider config lives in @/lib/auth/providers/.',
            },
          ],
          patterns: [
            {
              group: ['@/lib/storage/fs', '@/lib/storage/fs.*'],
              message:
                'Import the Storage interface from @/lib/storage instead of the fs implementation directly.',
            },
            {
              group: ['@/db/*'],
              message:
                'Components must not import @/db/* directly. Go through a feature repo or server action.',
            },
          ],
        },
      ],

      // Tighten any-usage. Allow it only when annotated with a justification.
      '@typescript-eslint/no-explicit-any': 'error',

      // Unused vars: allow _-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Storage implementation may import its own fs.ts.
  {
    files: ['src/lib/storage/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Auth lib may import next-auth.
  {
    files: ['src/lib/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Server-side repos and actions may import @/db/*.
  // Test files may also reach into @/db/* for fixture setup and assertions.
  {
    files: [
      'src/db/**/*.ts',
      'src/lib/**/repo.ts',
      'src/lib/**/actions.ts',
      'src/lib/auth/**/*.ts',
      'src/lib/extraction/flight-cache.ts',
      'src/lib/geocoding/cache.ts',
      // Reference-data seed (ISO countries). Takes a db argument so the
      // one-shot `pnpm db:seed` script and the worker's boot-time seed
      // share one idempotent insert. Not a request-scoped repo.
      'src/lib/countries/seed.ts',
      // Maintenance owns cross-table cleanup (sessions, tokens, geocode
      // cache) and the auto-status sweep. Shared by `pnpm db:prune` /
      // the worker's boot-time backfill and the scheduled jobs.
      'src/lib/maintenance/prune.ts',
      'src/lib/maintenance/status.ts',
      'src/app/api/**/*.ts',
      'scripts/**/*.ts',
      '**/*.test.ts',
      // E2E specs + fixtures reach into @/db/* to insert sentinel test
      // users, sessions, and seed data for authed flows.
      'tests/e2e/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Playwright's fixture API destructures a parameter named `use`.
  // The `react-hooks/rules-of-hooks` heuristic flags any `use*`
  // identifier called as a function, so it fires on Playwright's
  // fixture `use(value)` call. Scoped to fixtures only — a real
  // `useFoo()` mistake in a spec file should still surface as a
  // lint error.
  {
    files: ['tests/e2e/fixtures/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];

export default config;
