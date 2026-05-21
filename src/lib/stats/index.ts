// Stats feature barrel.
//
// Server-only: `repo.ts` transitively imports `pg` via @/db/client, so
// this barrel must not be pulled into a client bundle. The /stats page
// is a Server Component and imports it directly.
//
// Pure-function helpers (`haversineKm`) and the visibility predicate
// builder are also re-exported for tests and future drill-down work.

export {
  getStatsDashboardData,
  type LifetimeStats,
  type PersonalRecords,
  type StatsDashboardData,
  type YearOverYearStats,
  type YearTally,
} from './repo';
export { haversineKm, type GeoPoint } from './geo';
export { visibleTripsPredicate } from './visibility';
