import { describe, expect, it } from 'vitest';

import {
  greatCircleKm,
  implausibleEnds,
  isGuessedStation,
  MAX_FALLBACK_KM,
  type GuardedEnd,
} from './station-guard';

// The #144 probe geography: the Torres del Paine ferry dock, the refuge
// across the lake, and the Puerto Montt harbour ~1,065 km north that a
// country-free free-text lookup for "Pudeto" returns.
const PUDETO = { lat: -51.0614, lng: -72.9899 };
const PAINE_GRANDE = { lat: -51.09, lng: -73.08 };
const PUERTO_MONTT = { lat: -41.4693, lng: -72.9424 };

const guessed = (p: { lat: number; lng: number }): GuardedEnd => ({
  ...p,
  source: 'photon',
  station: true,
});
const tagged = (p: { lat: number; lng: number }): GuardedEnd => ({
  ...p,
  source: 'photon-station',
  station: true,
});
const NEITHER = { origin: false, destination: false };

describe('isGuessedStation', () => {
  it('flags a station key that only the free-text fallback placed', () => {
    expect(isGuessedStation('station:ferry:cl:Pudeto', 'photon')).toBe(true);
    expect(isGuessedStation('station:ferry:cl:Pudeto', 'nominatim')).toBe(true);
    // Case doesn't matter — callers may pass the normalised key.
    expect(isGuessedStation('station:ferry:cl:pudeto', 'photon')).toBe(true);
  });

  it('trusts a station key a tagged station rung placed', () => {
    expect(isGuessedStation('station:ferry:cl:Pudeto', 'photon-station')).toBe(false);
  });

  it('never flags a query that is not a station key', () => {
    // Free text is the ordinary path for an address, a hotel or a car leg.
    expect(isGuessedStation('1 Lake St, Queenstown', 'nominatim')).toBe(false);
    expect(isGuessedStation('Punta Arenas', 'photon')).toBe(false);
    expect(isGuessedStation('8Q7XMQJ8+FV', 'plus-code')).toBe(false);
  });
});

describe('implausibleEnds', () => {
  it('flags the guessed end of a pair past the mode threshold', () => {
    expect(implausibleEnds('ferry', guessed(PUERTO_MONTT), tagged(PAINE_GRANDE))).toEqual({
      origin: true,
      destination: false,
    });
    expect(implausibleEnds('ferry', tagged(PUDETO), guessed(PUERTO_MONTT))).toEqual({
      origin: false,
      destination: true,
    });
  });

  it('flags both ends when neither is better than a guess', () => {
    expect(implausibleEnds('ferry', guessed(PUERTO_MONTT), guessed(PUDETO))).toEqual({
      origin: true,
      destination: true,
    });
  });

  it('leaves a guess alone when it sits near the other end', () => {
    expect(implausibleEnds('ferry', guessed(PUDETO), tagged(PAINE_GRANDE))).toEqual(NEITHER);
  });

  it('applies the mode’s own threshold', () => {
    const km = greatCircleKm(PUERTO_MONTT, PAINE_GRANDE);
    expect(km).toBeGreaterThan(MAX_FALLBACK_KM.ferry);
    expect(km).toBeLessThan(MAX_FALLBACK_KM.train);
    expect(implausibleEnds('train', guessed(PUERTO_MONTT), tagged(PAINE_GRANDE))).toEqual(NEITHER);
  });

  it('trusts trusted ends at any distance', () => {
    expect(implausibleEnds('ferry', tagged(PUERTO_MONTT), tagged(PAINE_GRANDE))).toEqual(NEITHER);
    // A free-text row that wasn't a station lookup: an address end.
    const addressEnd: GuardedEnd = { ...PUERTO_MONTT, source: 'nominatim' };
    expect(implausibleEnds('ferry', addressEnd, tagged(PAINE_GRANDE))).toEqual(NEITHER);
    // An offline Plus Code decode carries no source at all.
    expect(implausibleEnds('ferry', { ...PUERTO_MONTT }, tagged(PAINE_GRANDE))).toEqual(NEITHER);
  });

  it('needs both ends to measure against', () => {
    expect(implausibleEnds('ferry', guessed(PUERTO_MONTT), null)).toEqual(NEITHER);
    expect(implausibleEnds('ferry', null, guessed(PUERTO_MONTT))).toEqual(NEITHER);
  });
});
