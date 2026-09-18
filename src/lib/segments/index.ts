// Client-safe barrel: validators + types only. Repo lives at
// '@/lib/segments/repo' so it isn't pulled into client bundles (it
// transitively imports `pg`). Server code does
// `import * as segmentsRepo from '@/lib/segments/repo'` directly.
//
// `export type { Segment }` is a TS re-export and is erased at compile
// time — no runtime import of repo.ts happens here.
export * from './validators';
export * from './transit-endpoints';
// Load-bearing for the client bundle: `export type` is erased, so the
// segment form's query builder can import this barrel. A value export
// from './repo' here would pull Drizzle and `pg` into the browser.
export type { Segment } from './repo';
