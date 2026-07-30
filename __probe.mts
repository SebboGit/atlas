import { searchCountries } from './src/lib/countries/match';
import { ISO_COUNTRIES } from './src/lib/countries/data';
for (const q of ['ST', 'st', 'sao', 'sao tome', 'S.T.', 'saint', 'sa', 'JP', 'ma']) {
  const r = searchCountries(q, ISO_COUNTRIES).slice(0, 8);
  console.log(JSON.stringify(q), '->', r.map((c) => `${c.code}:${c.name}`).join(' | '));
}
