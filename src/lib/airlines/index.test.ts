import { describe, expect, it } from 'vitest';

import {
  displayCarrier,
  equivalentCarrierForms,
  formatFlightNumber,
  getAirlineName,
  getIatasForName,
} from './index';

describe('getAirlineName', () => {
  it('resolves well-known IATA designators', () => {
    expect(getAirlineName('BA')).toBe('British Airways');
    expect(getAirlineName('VN')).toBe('Vietnam Airlines');
    expect(getAirlineName('LH')).toBe('Lufthansa');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getAirlineName('ba')).toBe('British Airways');
    expect(getAirlineName(' BA ')).toBe('British Airways');
    expect(getAirlineName('Ba')).toBe('British Airways');
  });

  it('returns null for non-IATA-shaped input', () => {
    expect(getAirlineName('British Airways')).toBeNull();
    expect(getAirlineName('B')).toBeNull();
    expect(getAirlineName('BAA')).toBeNull();
    // All-digit codes are not legal IATA designators — the generator
    // filters them, and the regex matches the generator's intent.
    expect(getAirlineName('11')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(getAirlineName('')).toBeNull();
    expect(getAirlineName('   ')).toBeNull();
    expect(getAirlineName(null)).toBeNull();
    expect(getAirlineName(undefined)).toBeNull();
  });

  it('returns null when the code is IATA-shaped but unassigned', () => {
    // Picking a code unlikely to be assigned — the test will need an
    // update if OpenFlights ever assigns ZZ to a real carrier, but
    // that's fine; the assertion is "miss returns null", not the
    // specific value of ZZ.
    expect(getAirlineName('ZZ')).toBeNull();
  });
});

describe('displayCarrier', () => {
  it('resolves IATA codes to airline names', () => {
    expect(displayCarrier('BA')).toBe('British Airways');
    expect(displayCarrier('vn')).toBe('Vietnam Airlines');
  });

  it('passes already-resolved names through unchanged', () => {
    expect(displayCarrier('British Airways')).toBe('British Airways');
    expect(displayCarrier('Some Custom Airline')).toBe('Some Custom Airline');
  });

  it('passes IATA-shaped misses through unchanged', () => {
    expect(displayCarrier('ZZ')).toBe('ZZ');
  });

  it('returns null for empty / nullish input', () => {
    expect(displayCarrier('')).toBeNull();
    expect(displayCarrier('   ')).toBeNull();
    expect(displayCarrier(null)).toBeNull();
    expect(displayCarrier(undefined)).toBeNull();
  });

  it('trims surrounding whitespace from non-IATA values', () => {
    expect(displayCarrier('  Air France  ')).toBe('Air France');
  });
});

describe('getIatasForName', () => {
  it('resolves a canonical name back to its IATA code', () => {
    expect(getIatasForName('British Airways')).toEqual(['BA']);
    expect(getIatasForName('Vietnam Airlines')).toEqual(['VN']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getIatasForName('british airways')).toEqual(['BA']);
    expect(getIatasForName('  British Airways  ')).toEqual(['BA']);
  });

  it('returns an empty array for unknown names and nullish input', () => {
    expect(getIatasForName('Definitely Not A Real Airline')).toEqual([]);
    expect(getIatasForName('')).toEqual([]);
    expect(getIatasForName(null)).toEqual([]);
    expect(getIatasForName(undefined)).toEqual([]);
  });
});

describe('formatFlightNumber', () => {
  it('prepends the carrier IATA to bare digits', () => {
    expect(formatFlightNumber('BA', '287')).toBe('BA 287');
    expect(formatFlightNumber('British Airways', '287')).toBe('BA 287');
  });

  it('normalises an inline prefix to the spaced form', () => {
    expect(formatFlightNumber(null, 'BA287')).toBe('BA 287');
    expect(formatFlightNumber(null, 'ba287')).toBe('BA 287');
    expect(formatFlightNumber(null, 'BA 287')).toBe('BA 287');
    expect(formatFlightNumber(null, 'BA-287')).toBe('BA 287');
  });

  it('honours an inline prefix even when carrier is set', () => {
    // User-edited row may carry the prefix on the number itself. We
    // trust what they typed rather than risk double-prefixing.
    expect(formatFlightNumber('Lufthansa', 'BA287')).toBe('BA 287');
  });

  it('keeps the bare number when no carrier IATA is derivable', () => {
    expect(formatFlightNumber(null, '287')).toBe('287');
    expect(formatFlightNumber('Some Custom Co', '287')).toBe('287');
  });

  it('keeps a trailing operational suffix on the number', () => {
    // e.g. "BA287F" (ferry leg). The split keeps the suffix attached
    // to the number, not the carrier.
    expect(formatFlightNumber(null, 'BA287F')).toBe('BA 287F');
    expect(formatFlightNumber('BA', '287F')).toBe('BA 287F');
  });

  it('returns null for empty / nullish flight numbers', () => {
    expect(formatFlightNumber('BA', null)).toBeNull();
    expect(formatFlightNumber('BA', undefined)).toBeNull();
    expect(formatFlightNumber('BA', '')).toBeNull();
    expect(formatFlightNumber('BA', '   ')).toBeNull();
  });

  it('does not misinterpret an all-digit prefix as a carrier code', () => {
    // The IATA designator regex requires ≥1 letter. An all-digit
    // leading pair would otherwise get split and re-joined, which is
    // never what we want.
    expect(formatFlightNumber(null, '11287')).toBe('11287');
  });
});

describe('equivalentCarrierForms', () => {
  it('expands an IATA code to itself + its name', () => {
    const forms = equivalentCarrierForms('BA');
    expect(new Set(forms)).toEqual(new Set(['BA', 'British Airways']));
  });

  it('expands a name to itself + its IATA code(s)', () => {
    const forms = equivalentCarrierForms('British Airways');
    expect(new Set(forms)).toEqual(new Set(['British Airways', 'BA']));
  });

  it('preserves input case for unknown values (no expansion)', () => {
    // An unrecognised free-text name passes through as the single
    // candidate. Lookup callers must still cover the original
    // user-entered casing.
    expect(equivalentCarrierForms('Some Custom Co')).toEqual(['Some Custom Co']);
  });

  it('returns an empty array for empty / nullish input', () => {
    expect(equivalentCarrierForms('')).toEqual([]);
    expect(equivalentCarrierForms('   ')).toEqual([]);
    expect(equivalentCarrierForms(null)).toEqual([]);
    expect(equivalentCarrierForms(undefined)).toEqual([]);
  });

  it('trims surrounding whitespace before resolution', () => {
    const forms = equivalentCarrierForms('  BA  ');
    expect(new Set(forms)).toEqual(new Set(['BA', 'British Airways']));
  });
});
