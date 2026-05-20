// Client-safe barrel: only validators + types. Repo lives at
// '@/lib/trips/repo' so it isn't pulled into client bundles (it
// transitively imports `pg`). Server code does `import * as tripsRepo
// from '@/lib/trips/repo'` directly.
//
// `export type { Trip } from './repo'` is purely a TS re-export and is
// erased at compile time — no runtime import of repo.ts happens here.
export * from './validators';
export type { Trip } from './repo';
