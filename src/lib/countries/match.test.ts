import { describe, expect, it } from 'vitest';

import { ISO_COUNTRIES } from './data';
import { COUNTRY_ALIASES, searchCountries } from './match';

/** Codes of the matches, in rank order. */
function codes(query: string, pool = ISO_COUNTRIES): string[] {
  return searchCountries(query, pool).map((c) => c.code);
}

/** The single best match for a query. */
function top(query: string): string | undefined {
  return codes(query)[0];
}

describe('searchCountries', () => {
  describe('comma inversion', () => {
    it('finds "Korea, South" by the spoken order', () => {
      expect(top('South Korea')).toBe('KR');
    });

    it('finds "Korea, North" by the spoken order', () => {
      expect(top('North Korea')).toBe('KP');
    });

    it('still finds both Koreas by the stored form', () => {
      expect(codes('Korea, South')[0]).toBe('KR');
      expect(codes('korea')).toEqual(expect.arrayContaining(['KP', 'KR']));
    });

    it('finds the DR Congo by its spoken order', () => {
      expect(top('Democratic Republic of the Congo')).toBe('CD');
    });

    it('does not invert a list comma', () => {
      // "Bonaire, Sint Eustatius and Saba" must not become the junk
      // variant "sint eustatius and saba bonaire".
      expect(codes('saba bonaire')).toEqual([]);
      expect(top('Bonaire')).toBe('BQ');
    });

    it('ranks the plain Congo above the DR Congo on an exact name', () => {
      expect(top('congo')).toBe('CG');
      expect(codes('congo')).toContain('CD');
    });
  });

  describe('aliases', () => {
    it.each([
      ['usa', 'US'],
      ['U.S.A.', 'US'],
      ['united states of america', 'US'],
      ['america', 'US'],
      ['uk', 'GB'],
      ['great britain', 'GB'],
      ['england', 'GB'],
      ['uae', 'AE'],
      ['holland', 'NL'],
      ['burma', 'MM'],
      ['ivory coast', 'CI'],
      ['czech republic', 'CZ'],
      ['turkey', 'TR'],
      ['cape verde', 'CV'],
      ['drc', 'CD'],
      ['democratic republic of congo', 'CD'],
      ['swaziland', 'SZ'],
      ['east timor', 'TL'],
      ['cocos islands', 'CC'],
      ['us virgin islands', 'VI'],
      ['british virgin islands', 'VG'],
      ['caribbean netherlands', 'BQ'],
    ])('%s → %s', (query, code) => {
      expect(top(query)).toBe(code);
    });

    it('keys every alias to a country that exists in the snapshot', () => {
      const known = new Set(ISO_COUNTRIES.map((c) => c.code));
      for (const code of Object.keys(COUNTRY_ALIASES)) {
        expect(known.has(code), `${code} is not in ISO_COUNTRIES`).toBe(true);
      }
    });
  });

  describe('normalisation', () => {
    it('folds diacritics both ways', () => {
      expect(top('turkiye')).toBe('TR');
      expect(top('Türkiye')).toBe('TR');
      expect(top('curacao')).toBe('CW');
      expect(top('sao tome')).toBe('ST');
      expect(top('aland')).toBe('AX');
      expect(top('reunion')).toBe('RE');
    });

    it('treats "st" as "saint"', () => {
      expect(top('st lucia')).toBe('LC');
      expect(top('st kitts')).toBe('KN');
    });

    it('drops a leading article', () => {
      expect(top('the netherlands')).toBe('NL');
    });

    it('ignores hyphens and parentheses', () => {
      expect(top('timor leste')).toBe('TL');
      expect(top('guinea bissau')).toBe('GW');
    });
  });

  describe('ranking', () => {
    it('puts an exact ISO code first', () => {
      expect(top('JP')).toBe('JP');
      expect(top('us')).toBe('US');
      expect(top('gb')).toBe('GB');
    });

    it('lets the code "ST" reach São Tomé despite the st→saint rule', () => {
      // Regression: folding the query to "saint" before the code compare
      // made ST unreachable and dropped São Tomé from the results
      // entirely, handing the list to the seven Saint * countries.
      expect(top('ST')).toBe('ST');
      expect(top('st')).toBe('ST');
      // …and the Saint * countries still follow on the same query.
      expect(codes('st')).toContain('LC');
      expect(codes('st')).toContain('KN');
    });

    it('ranks an exact name above a prefix above a substring', () => {
      // "Niger" is an exact name; "Nigeria" only a prefix match.
      expect(codes('niger').slice(0, 2)).toEqual(['NE', 'NG']);
    });

    it('keeps pool order within a rank tier', () => {
      const island = codes('island');
      expect(island.length).toBeGreaterThan(3);
      // ISO_COUNTRIES is name-sorted, and the sort is stable, so a
      // pure-substring tier comes back in the pool's own order.
      const names = searchCountries('island', ISO_COUNTRIES).map((c) => c.name);
      const poolOrder = ISO_COUNTRIES.filter((c) => island.includes(c.code)).map((c) => c.name);
      expect(names.filter((n) => poolOrder.includes(n))).toHaveLength(poolOrder.length);
    });
  });

  describe('edge cases', () => {
    it('returns the pool unchanged for a blank query', () => {
      expect(searchCountries('', ISO_COUNTRIES)).toBe(ISO_COUNTRIES);
      expect(searchCountries('   ', ISO_COUNTRIES)).toBe(ISO_COUNTRIES);
      expect(searchCountries('...', ISO_COUNTRIES)).toBe(ISO_COUNTRIES);
    });

    it('returns nothing for a query that matches nothing', () => {
      expect(codes('zzzzz')).toEqual([]);
    });

    it('works over an arbitrary pool and preserves the payload', () => {
      const pool = [
        { code: 'KR', name: 'Korea, South', count: 4 },
        { code: 'JP', name: 'Japan', count: 9 },
      ];
      expect(searchCountries('south korea', pool)).toEqual([
        { code: 'KR', name: 'Korea, South', count: 4 },
      ]);
    });
  });
});
