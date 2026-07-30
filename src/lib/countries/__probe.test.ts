import { describe, it } from 'vitest';
import { searchCountries } from '@/lib/countries/match';
import { ISO_COUNTRIES } from '@/lib/countries/data';

describe('st probe', () => {
  it('prints', () => {
    for (const q of ['ST', 'st', 'sao', 'sao tome', 'Sāo', 'S.T.', 'saint', 'sa']) {
      const r = searchCountries(q, ISO_COUNTRIES).slice(0, 10);
      console.log(JSON.stringify(q), '->', r.map((c) => c.code).join(','));
    }
  });
});
