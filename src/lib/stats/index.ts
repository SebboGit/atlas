// Stats feature barrel.
//
// Server-only: `repo.ts` transitively imports `pg` via @/db/client, so
// this barrel must not be pulled into a client bundle. The /stats page
// is a Server Component and imports it directly.
//
// The pure-function helper (`haversineKm`) is also re-exported for tests
// and future drill-down work. The trip-visibility boundary now lives in
// `@/lib/trips/repo` (tripVisibleToViewer), shared across features, so it
// is no longer re-exported here.

export {
  getStatsDashboardData,
  type LifetimeStats,
  type PersonalRecords,
  type StatsDashboardData,
  type YearOverYearStats,
  type YearTally,
} from './repo';
export { haversineKm, type GeoPoint } from './geo';
