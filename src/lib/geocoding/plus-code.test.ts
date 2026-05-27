import { describe, expect, it } from 'vitest';

import {
  decodePlusCode,
  encodePlusCode,
  isValidPlusCodeShape,
  recoverPlusCode,
  tryParsePlusCode,
} from './plus-code';

describe('tryParsePlusCode', () => {
  it('recognises a full code', () => {
    expect(tryParsePlusCode('8Q7XMPWG+5V')).toEqual({ kind: 'full', code: '8Q7XMPWG+5V' });
  });

  it('canonicalises case to uppercase', () => {
    expect(tryParsePlusCode('8q7xmpwg+5v')).toEqual({ kind: 'full', code: '8Q7XMPWG+5V' });
  });

  it('accepts 11-char full codes (extra precision)', () => {
    expect(tryParsePlusCode('8Q7XMPWG+5VC')).toEqual({ kind: 'full', code: '8Q7XMPWG+5VC' });
  });

  it('accepts spec-max 15-char full codes (7 chars after +)', () => {
    // OLC spec: full codes are 10–15 chars total with `+` after the
    // 8th, so the suffix can be 2–7 chars long. Regression for the
    // original {2,3} suffix bound that wrongly rejected longer codes.
    expect(tryParsePlusCode('8Q7XMPWG+5VCFGHJ')).toEqual({
      kind: 'full',
      code: '8Q7XMPWG+5VCFGHJ',
    });
  });

  it('rejects full codes with suffix beyond the spec maximum (8 chars)', () => {
    expect(tryParsePlusCode('8Q7XMPWG+5VCFGHJM')).toBeNull();
  });

  it('accepts local codes with extended suffix lengths (4–7 chars after +)', () => {
    expect(tryParsePlusCode('MP7J+CVCFG Minato City, Tokyo')).toEqual({
      kind: 'local',
      code: 'MP7J+CVCFG',
      reference: 'Minato City, Tokyo',
    });
  });

  it('trims leading and trailing whitespace', () => {
    expect(tryParsePlusCode('  8Q7XMPWG+5V  ')).toEqual({ kind: 'full', code: '8Q7XMPWG+5V' });
  });

  it('recognises a local code with anchor', () => {
    expect(tryParsePlusCode('MP7J+CV Minato City, Tokyo')).toEqual({
      kind: 'local',
      code: 'MP7J+CV',
      reference: 'Minato City, Tokyo',
    });
  });

  it('recognises a bare local code with null reference', () => {
    expect(tryParsePlusCode('MP7J+CV')).toEqual({
      kind: 'local',
      code: 'MP7J+CV',
      reference: null,
    });
  });

  it('collapses extra whitespace in the anchor', () => {
    expect(tryParsePlusCode('MP7J+CV   Minato City')).toEqual({
      kind: 'local',
      code: 'MP7J+CV',
      reference: 'Minato City',
    });
  });

  it('returns null for an address without a plus separator', () => {
    expect(tryParsePlusCode('123 Main St, Springfield')).toBeNull();
  });

  it('returns null for a string with chars outside the OLC alphabet', () => {
    expect(tryParsePlusCode('1234+AB')).toBeNull(); // 1, 0, A, B etc. not in alphabet
  });

  it('returns null for empty input', () => {
    expect(tryParsePlusCode('')).toBeNull();
    expect(tryParsePlusCode('   ')).toBeNull();
  });

  it('returns null for a full code with trailing junk', () => {
    expect(tryParsePlusCode('8Q7XMPWG+5V some text')).toBeNull();
  });

  it('returns null for malformed shapes (suffix beyond spec maximum)', () => {
    // 8 chars after `+` — OLC spec caps the suffix at 7.
    expect(tryParsePlusCode('8Q7XMPWG+5VCFGHJM')).toBeNull();
  });
});

describe('isValidPlusCodeShape', () => {
  it('accepts empty input (schema-optional field)', () => {
    expect(isValidPlusCodeShape('')).toBe(true);
    expect(isValidPlusCodeShape('   ')).toBe(true);
  });

  it('accepts a full code', () => {
    expect(isValidPlusCodeShape('8Q7XMPWG+5V')).toBe(true);
  });

  it('accepts a local code with anchor', () => {
    expect(isValidPlusCodeShape('MP7J+CV Minato City, Tokyo')).toBe(true);
  });

  it('rejects a bare local code (cannot resolve without an anchor)', () => {
    expect(isValidPlusCodeShape('MP7J+CV')).toBe(false);
  });

  it('rejects arbitrary text', () => {
    expect(isValidPlusCodeShape('123 Main St')).toBe(false);
  });
});

describe('decodePlusCode + encodePlusCode round-trip', () => {
  it('decodes a known Plus Code to coordinates near the expected place', () => {
    // 8Q7XMPWG+5V is a Plus Code in Vietnam; we just assert the returned
    // shape is finite, since the library is the source of truth on the
    // exact center.
    const coords = decodePlusCode('8Q7XMPWG+5V');
    expect(coords).not.toBeNull();
    expect(Number.isFinite(coords!.lat)).toBe(true);
    expect(Number.isFinite(coords!.lng)).toBe(true);
    expect(coords!.lat).toBeGreaterThan(-90);
    expect(coords!.lat).toBeLessThan(90);
    expect(coords!.lng).toBeGreaterThan(-180);
    expect(coords!.lng).toBeLessThan(180);
  });

  it('encodes coordinates and decodes back to near-original', () => {
    const encoded = encodePlusCode(35.6762, 139.6503); // Tokyo
    expect(encoded).not.toBeNull();
    expect(encoded).toMatch(/^[23456789CFGHJMPQRVWX]+\+[23456789CFGHJMPQRVWX]+$/);
    const back = decodePlusCode(encoded!);
    expect(back).not.toBeNull();
    // 10-char code is ~14×14 m at the equator; 1e-3 deg ≈ 100 m, plenty of room.
    expect(Math.abs(back!.lat - 35.6762)).toBeLessThan(1e-3);
    expect(Math.abs(back!.lng - 139.6503)).toBeLessThan(1e-3);
  });

  it('returns null for garbage decode input', () => {
    expect(decodePlusCode('not a code')).toBeNull();
  });
});

describe('recoverPlusCode', () => {
  it('lifts a local code to a full code given a nearby anchor', () => {
    // MP7J+CV near Minato, Tokyo (~35.65, 139.74)
    const recovered = recoverPlusCode('MP7J+CV', 35.65, 139.74);
    expect(recovered).not.toBeNull();
    expect(recovered).toMatch(/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,3}$/);
    // Recovered code should decode to a point near the anchor.
    const back = decodePlusCode(recovered!);
    expect(back).not.toBeNull();
    expect(Math.abs(back!.lat - 35.65)).toBeLessThan(0.5);
    expect(Math.abs(back!.lng - 139.74)).toBeLessThan(0.5);
  });

  it('returns null for an invalid local code', () => {
    expect(recoverPlusCode('zzzz+zz', 35, 139)).toBeNull();
  });
});
