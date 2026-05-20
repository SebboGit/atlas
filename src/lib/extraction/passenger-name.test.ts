// Tests for the passenger-name cleanup in the boarding-pass schema.
//
// `passengerName` runs through a .transform at the schema boundary
// (see types.ts) that strips airline-industry noise: passenger-type
// codes like "(ADT)" and honorifics like "MRS". The persisted form is
// the cleaned form; consumers (doc card, future segment surfaces)
// never see the raw annotated string.
//
// We test through `structuredPayloadSchema.parse` rather than the
// helper directly so the test pins the user-facing contract: what
// lands on the row, not what an internal regex does.

import { describe, expect, it } from 'vitest';

import { _cleanPassengerNameForTest, structuredPayloadSchema } from './types';

function parseBoarding(passengerName: unknown): string | null {
  const parsed = structuredPayloadSchema.parse({
    kind: 'boarding-pass',
    flights: [
      {
        carrier: 'BA',
        flightNumber: '287',
        flightDate: '2026-06-01',
        scheduledDeparture: null,
        scheduledArrival: null,
        origin: 'LHR',
        destination: 'SFO',
        passengerName,
        confirmationCode: 'ABC123',
      },
    ],
    confidence: 0.9,
  });
  if (parsed.kind !== 'boarding-pass') throw new Error('expected boarding-pass');
  return parsed.flights[0]?.passengerName ?? null;
}

describe('passengerName cleanup at the schema boundary', () => {
  it('passes a clean name through unchanged', () => {
    expect(parseBoarding('DOE/JANE')).toBe('DOE/JANE');
    expect(parseBoarding('Jane Doe')).toBe('Jane Doe');
  });

  it('strips trailing passenger-type code in parens', () => {
    expect(parseBoarding('DOE/JANE (ADT)')).toBe('DOE/JANE');
    expect(parseBoarding('DOE/JANE(CHD)')).toBe('DOE/JANE');
    expect(parseBoarding('DOE/JANE (INF)')).toBe('DOE/JANE');
    expect(parseBoarding('JANE DOE  ( YTH )')).toBe('JANE DOE');
  });

  it('strips trailing honorifics', () => {
    expect(parseBoarding('DOE/JANE MRS')).toBe('DOE/JANE');
    expect(parseBoarding('JANE DOE MR')).toBe('JANE DOE');
    expect(parseBoarding('DR JANE DOE DR')).toBe('DR JANE DOE');
    // The honorific is stripped only when trailing — the leading
    // "DR" stays because removing it would mangle a real name like
    // "Dr Smith" written without a period.
  });

  it('strips a trailing honorific glued by a slash', () => {
    expect(parseBoarding('DOE/JANE/MRS')).toBe('DOE/JANE');
    expect(parseBoarding('DOE/JANE/MR.')).toBe('DOE/JANE');
  });

  it('handles the real-world ticket form "NAME MRS (ADT)"', () => {
    expect(parseBoarding('DOE/JANE MRS (ADT)')).toBe('DOE/JANE');
    expect(parseBoarding('SMITH/JOHN MR (ADT)')).toBe('SMITH/JOHN');
  });

  it('strips common European-language honorifics', () => {
    // German
    expect(parseBoarding('MUELLER/HANS HERR')).toBe('MUELLER/HANS');
    expect(parseBoarding('MUELLER/HANNA FRAU')).toBe('MUELLER/HANNA');
    expect(parseBoarding('MUELLER/CLARA FRL')).toBe('MUELLER/CLARA');
    // Spanish
    expect(parseBoarding('GARCIA/MARIA SRA')).toBe('GARCIA/MARIA');
    expect(parseBoarding('GARCIA/ANA SRTA')).toBe('GARCIA/ANA');
    // French
    expect(parseBoarding('DUPONT/MARIE MME')).toBe('DUPONT/MARIE');
    expect(parseBoarding('DUPONT/ANNE MLLE')).toBe('DUPONT/ANNE');
    // Italian
    expect(parseBoarding('ROSSI/LUIGI SIG')).toBe('ROSSI/LUIGI');
    expect(parseBoarding('ROSSI/GIULIA SIGRA')).toBe('ROSSI/GIULIA');
    // Thai (when names emit in Latin)
    expect(parseBoarding('SOMSAK/A KHUN')).toBe('SOMSAK/A');
  });

  it('does NOT strip single-letter honorifics that collide with initials', () => {
    // "M." in French is Monsieur but also a common initial. Refuse
    // to strip — better to leak the honorific in the rare French
    // case than to mangle "JOHN M. DOE" → "JOHN".
    expect(parseBoarding('JOHN M. DOE')).toBe('JOHN M. DOE');
    expect(parseBoarding('DOE/J.M.')).toBe('DOE/J.M.');
  });

  it('collapses to null when the name is empty after stripping', () => {
    // E.g. an LLM that mistakenly emits just "(ADT)".
    expect(parseBoarding('(ADT)')).toBeNull();
    // And the blankToNull preprocess catches raw whitespace.
    expect(parseBoarding('   ')).toBeNull();
  });

  it('leaves "ADT" alone when it is not in the noise pattern (substring of a name)', () => {
    // A defensive case — the regex is anchored at the end and
    // requires parens, so a name that happens to contain "ADT" as
    // letters mid-string survives.
    expect(parseBoarding('RADTKE/JANE')).toBe('RADTKE/JANE');
  });

  it('is exported as _cleanPassengerNameForTest for direct unit access', () => {
    // Direct invocation for edge cases that don't fit the schema
    // round-trip (the schema enforces min(1) before the transform,
    // so a literal "" never reaches the helper).
    expect(_cleanPassengerNameForTest('DOE/JANE MRS (ADT)')).toBe('DOE/JANE');
    expect(_cleanPassengerNameForTest('')).toBe('');
  });
});
