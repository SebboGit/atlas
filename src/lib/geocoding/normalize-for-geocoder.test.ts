import { describe, expect, it } from 'vitest';

import { normalizeForGeocoder, rejoinSplitDiacritics } from './normalize-for-geocoder';

describe('normalizeForGeocoder', () => {
  describe('comma-less inputs (treated as landmark queries)', () => {
    it('preserves landmark names verbatim', () => {
      expect(normalizeForGeocoder('Eiffel Tower')).toBe('Eiffel Tower');
      expect(normalizeForGeocoder('Senso-ji')).toBe('Senso-ji');
      expect(normalizeForGeocoder('Tokyo Tower')).toBe('Tokyo Tower');
    });

    it('collapses whitespace but applies no structural stripping', () => {
      expect(normalizeForGeocoder('  Eiffel   Tower  ')).toBe('Eiffel Tower');
    });

    it('does not strip postcodes from a comma-less query (would be ambiguous)', () => {
      // No commas → treat as opaque. Real-world bare landmarks don't
      // include postcodes, and a bare "62701" is just a number we
      // shouldn't strip.
      expect(normalizeForGeocoder('80331 München Germany')).toBe('80331 München Germany');
    });
  });

  describe('issue test corpus — universal patterns that null today', () => {
    it('DE: strips floor segment and postcode', () => {
      expect(normalizeForGeocoder('Hauptstraße 1, 2. OG, 80331 München, Germany')).toBe(
        'Hauptstraße 1, München, Germany',
      );
    });

    it('US: strips Suite designator within segment and ZIP at end', () => {
      expect(normalizeForGeocoder('123 Main St Suite 200, Springfield, IL 62701, USA')).toBe(
        '123 Main St, Springfield, IL, USA',
      );
    });

    it('UK: strips Flat segment and end-of-segment postcode', () => {
      expect(normalizeForGeocoder('Flat 3, 14 High Street, London SW1A 2AA, United Kingdom')).toBe(
        '14 High Street, London, United Kingdom',
      );
    });

    it('JP: strips Bldg + floor segment and postcode', () => {
      expect(
        normalizeForGeocoder('Peace Bldg. B1F, 3 Chome-34-11 Shinjuku, Tokyo 160-0022, Japan'),
      ).toBe('3 Chome-34-11 Shinjuku, Tokyo, Japan');
    });
  });

  describe('issue test corpus — existing hits that must continue to resolve', () => {
    it('preserves JP block-numbered address', () => {
      expect(normalizeForGeocoder('1-2-3 Ginza, Tokyo')).toBe('1-2-3 Ginza, Tokyo');
    });

    it('preserves standalone JP landmark name', () => {
      expect(normalizeForGeocoder('Senso-ji')).toBe('Senso-ji');
    });

    it('preserves DE address (strips only the postcode)', () => {
      expect(normalizeForGeocoder('Platzl 9, 80331 München, Germany')).toBe(
        'Platzl 9, München, Germany',
      );
    });

    it('preserves Eiffel Tower', () => {
      expect(normalizeForGeocoder('Eiffel Tower')).toBe('Eiffel Tower');
    });
  });

  describe('postcode stripping by position', () => {
    it('strips US ZIP+4 at end of state segment', () => {
      expect(normalizeForGeocoder('123 Main St, Springfield, IL 62701-1234, USA')).toBe(
        '123 Main St, Springfield, IL, USA',
      );
    });

    it('strips Canadian postcode at end of city segment', () => {
      expect(normalizeForGeocoder('100 Bay St, Toronto ON M5J 2N8, Canada')).toBe(
        '100 Bay St, Toronto ON, Canada',
      );
    });

    it('strips Dutch postcode at start of city segment', () => {
      expect(normalizeForGeocoder('Damrak 1, 1012 LG Amsterdam, Netherlands')).toBe(
        'Damrak 1, Amsterdam, Netherlands',
      );
    });

    it('strips JP postcode without hyphen', () => {
      expect(normalizeForGeocoder('1-1-1 Shibuya, Tokyo 1500002, Japan')).toBe(
        '1-1-1 Shibuya, Tokyo, Japan',
      );
    });

    it('strips AU 4-digit postcode at end of state segment', () => {
      expect(normalizeForGeocoder('1 George St, Sydney NSW 2000, Australia')).toBe(
        '1 George St, Sydney NSW, Australia',
      );
    });

    it('does NOT mistake a 4-digit street number for a postcode', () => {
      // The 4-digit pattern only applies to the END of a segment (AU)
      // or the START of a segment with a city following it (DE). A
      // 4-digit street number followed by a street type word ("Elm
      // Street") matches neither.
      expect(normalizeForGeocoder('1234 Elm Street, Springfield, IL, USA')).toBe(
        '1234 Elm Street, Springfield, IL, USA',
      );
    });

    it('does NOT mistake a 5-digit street number for a postcode (only at end)', () => {
      // Unusual but possible — 5-digit street numbers exist in some
      // long avenues. End-only matching keeps them safe.
      expect(normalizeForGeocoder('12345 Pacific Coast Highway, Malibu, CA, USA')).toBe(
        '12345 Pacific Coast Highway, Malibu, CA, USA',
      );
    });
  });

  describe('interior-designator stripping', () => {
    it('strips Apt designator within segment', () => {
      expect(normalizeForGeocoder('123 Main St Apt 4B, Brooklyn, NY 11201, USA')).toBe(
        '123 Main St, Brooklyn, NY, USA',
      );
    });

    it('strips Unit designator within segment', () => {
      expect(normalizeForGeocoder('45 Oak Ave Unit 7, Boston, MA 02108, USA')).toBe(
        '45 Oak Ave, Boston, MA, USA',
      );
    });

    it('strips Ground Floor segment', () => {
      expect(
        normalizeForGeocoder('14 High Street, Ground Floor, London SW1A 2AA, United Kingdom'),
      ).toBe('14 High Street, London, United Kingdom');
    });

    it('strips Nth Floor segment', () => {
      expect(normalizeForGeocoder('123 Main St, 23rd Floor, New York, NY, USA')).toBe(
        '123 Main St, New York, NY, USA',
      );
    });

    it('strips Room designator within segment', () => {
      expect(normalizeForGeocoder('45 Oak Ave Room 305, Boston, MA 02108, USA')).toBe(
        '45 Oak Ave, Boston, MA, USA',
      );
    });

    it('strips German EG segment', () => {
      expect(normalizeForGeocoder('Hauptstraße 1, EG, 80331 München, Germany')).toBe(
        'Hauptstraße 1, München, Germany',
      );
    });

    it('strips German "1. OG" segment', () => {
      expect(normalizeForGeocoder('Hauptstraße 1, 1. OG, 80331 München, Germany')).toBe(
        'Hauptstraße 1, München, Germany',
      );
    });

    it('strips Tower N designator segment', () => {
      expect(normalizeForGeocoder('Tower 2, 100 Marina Blvd, Singapore')).toBe(
        '100 Marina Blvd, Singapore',
      );
    });

    it('preserves "Eiffel Tower" — generic Tower pattern is numeric-only', () => {
      expect(normalizeForGeocoder('Eiffel Tower, Champ de Mars, Paris, France')).toBe(
        'Eiffel Tower, Champ de Mars, Paris, France',
      );
    });

    it('strips Block A designator segment', () => {
      expect(normalizeForGeocoder('Block A, 14 High Street, London, United Kingdom')).toBe(
        '14 High Street, London, United Kingdom',
      );
    });

    it('preserves "Block 123" (Singapore-style block id with street number)', () => {
      // Block-with-letter only — numeric block identifiers ARE street
      // numbers in Singapore and survive.
      expect(normalizeForGeocoder('Block 123 Bedok North Road, Singapore')).toBe(
        'Block 123 Bedok North Road, Singapore',
      );
    });
  });

  describe('venue names that collide with designator shapes (segment-drop guard)', () => {
    // Issue: a building / floor / unit marker on its own is NOT enough
    // to drop the whole segment — venue names that happen to contain a
    // designator-shaped token must survive. Only the dual signature
    // (building marker AND floor / unit, no street number) drops the
    // segment.

    it('preserves "Tower N Hotel" venue name in a city-qualified address', () => {
      // Tower N matches the building pattern but no floor/unit
      // designator is present, so the segment is left intact.
      expect(normalizeForGeocoder('Tower 5 Hotel, Tokyo')).toBe('Tower 5 Hotel, Tokyo');
    });

    it('preserves "Restaurant" remnant when only a floor designator is present', () => {
      // Floor designator alone — strips "2F" inline, keeps "Restaurant"
      // so the geocoder at least gets the venue word + city.
      expect(normalizeForGeocoder('2F Restaurant, Tokyo')).toBe('Restaurant, Tokyo');
    });

    it('preserves "Building Society" landmark name (short-identifier guard)', () => {
      // "Society" is 7 chars — exceeds the ≤3-char identifier limit on
      // the Building pattern, so "Building Society" doesn't match the
      // marker and the segment stays intact.
      expect(normalizeForGeocoder('Building Society, London')).toBe('Building Society, London');
    });

    it('preserves "Empire State Building" landmark name (no trailing identifier)', () => {
      // "Building" with nothing after it doesn't match the
      // "Building <id>" pattern; segment survives.
      expect(normalizeForGeocoder('Empire State Building, New York, NY, USA')).toBe(
        'Empire State Building, New York, NY, USA',
      );
    });
  });

  describe('Unicode normalisation (NFC)', () => {
    it('composes decomposed combining marks (NFD → NFC)', () => {
      const decomposed = 'España';
      const composed = 'España';
      expect(decomposed).not.toBe(composed);
      expect(normalizeForGeocoder(decomposed)).toBe(composed);
    });

    it('preserves accented Latin characters in NFC form', () => {
      expect(normalizeForGeocoder('Café Bistrot, Paris, France')).toBe(
        'Café Bistrot, Paris, France',
      );
    });

    it('preserves eszett', () => {
      expect(normalizeForGeocoder('Hauptstraße 1, München, Germany')).toBe(
        'Hauptstraße 1, München, Germany',
      );
    });

    it('preserves macrons (chōme stays chōme — closed-list strip is out of scope for v1)', () => {
      expect(normalizeForGeocoder('3-chōme Shinjuku, Tokyo, Japan')).toBe(
        '3-chōme Shinjuku, Tokyo, Japan',
      );
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty / whitespace-only input', () => {
      expect(normalizeForGeocoder('')).toBe('');
      expect(normalizeForGeocoder('   \t\n')).toBe('');
    });

    it('drops empty comma segments left by stripping', () => {
      expect(normalizeForGeocoder('123 Main St, , Springfield, IL, USA')).toBe(
        '123 Main St, Springfield, IL, USA',
      );
    });

    it('trims leading / trailing commas', () => {
      expect(normalizeForGeocoder(',Springfield,')).toBe('Springfield');
    });

    it('is idempotent', () => {
      const inputs = [
        'Hauptstraße 1, 2. OG, 80331 München, Germany',
        '123 Main St Suite 200, Springfield, IL 62701, USA',
        'Eiffel Tower',
        '1-2-3 Ginza, Tokyo',
      ];
      for (const input of inputs) {
        const once = normalizeForGeocoder(input);
        const twice = normalizeForGeocoder(once);
        expect(twice).toBe(once);
      }
    });
  });
});

describe('rejoinSplitDiacritics — PDF glyph-split mangling', () => {
  it('rejoins the real extracted Vietnamese address verbatim', () => {
    // Captured from a real booking PDF: pdfjs emits each diacritic
    // letter as its own positioned glyph run, splitting every word.
    const mangled =
      '6A/20 Nguy ễ n C ả nh Chân, C ầ u Ông Lãnh, Qu ậ n 1, H ồ Chí Minh, Vi ệ t Nam';
    expect(rejoinSplitDiacritics(mangled)).toBe(
      '6A/20 Nguyễn Cảnh Chân, Cầu Ông Lãnh, Quận 1, Hồ Chí Minh, Việt Nam',
    );
  });

  it('leaves a genuine single-letter accented word between full words alone', () => {
    // "à" is a real French word — the left-fragment bound (≤4 letters)
    // keeps it out of the rejoin.
    expect(rejoinSplitDiacritics('Chemin à Gauche')).toBe('Chemin à Gauche');
  });

  it('leaves clean Vietnamese text untouched and is idempotent', () => {
    const clean = 'Nguyễn Cảnh Chân, Quận 1, Hồ Chí Minh';
    expect(rejoinSplitDiacritics(clean)).toBe(clean);
    const once = rejoinSplitDiacritics('Vi ệ t Nam');
    expect(rejoinSplitDiacritics(once)).toBe(once);
  });

  it('runs inside normalizeForGeocoder before the address rules', () => {
    expect(normalizeForGeocoder('Nguy ễ n C ả nh Chân, Qu ậ n 1')).toBe('Nguyễn Cảnh Chân, Quận 1');
  });
});

describe('rejoinSplitDiacritics — false-positive guards (review findings)', () => {
  it('leaves Romance venue names with standalone accented words alone', () => {
    for (const name of ['Prêt à Manger', 'Pied à Terre', 'Côte à Côte', 'Thé à la menthe']) {
      expect(rejoinSplitDiacritics(name)).toBe(name);
    }
  });

  it('never touches Cyrillic or Greek single-letter words', () => {
    expect(rejoinSplitDiacritics('Кафе и бар')).toBe('Кафе и бар');
    expect(rejoinSplitDiacritics('Бар у моста')).toBe('Бар у моста');
    expect(rejoinSplitDiacritics('Καφέ ο Νίκος')).toBe('Καφέ ο Νίκος');
  });

  it('still repairs Vietnamese words that use the shared accents', () => {
    // "à" is in the standalone-word set, but a ≤2-letter left fragment
    // marks it as a mangle orphan, not a French preposition.
    expect(rejoinSplitDiacritics('Đ à Nẵng')).toBe('Đà Nẵng');
    expect(rejoinSplitDiacritics('Tr à Vinh')).toBe('Trà Vinh');
  });
});

describe('rejoinSplitDiacritics — standalone Vietnamese words (CodeRabbit)', () => {
  it('preserves ở as a real word after a full word', () => {
    expect(rejoinSplitDiacritics('Nhà ở Huế')).toBe('Nhà ở Huế');
  });

  it('still repairs ở as a mangle orphan after a short fragment', () => {
    expect(rejoinSplitDiacritics('Ph ở Hà Nội')).toBe('Phở Hà Nội');
  });
});
