// Client-safe barrel: reference data + name lookup only. The repo at
// `./repo` transitively imports `pg` and must not be pulled into
// client bundles — server code imports it directly as
// `import * as countriesRepo from '@/lib/countries/repo'`.
export { ISO_COUNTRIES, countryName, type CountryRef } from './data';
