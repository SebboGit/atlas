import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_NOT_FOUND_REASON,
  ARRIVAL_UNCERTAIN_REASON,
  DEPARTURE_NOT_FOUND_REASON,
  DEPARTURE_UNCERTAIN_REASON,
  greatCircleKm,
  MAX_FALLBACK_KM,
  MAX_ROUTE_KM,
  NOT_FOUND_REASON,
  PENDING_REASON,
  resolveTransitRoute,
  ROUTE_UNCERTAIN_REASON,
  transitEndpointLabel,
  transitRouteLabel,
  type EndpointLookup,
} from './transit-route';

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const KYOTO = { lat: 34.9858, lng: 135.7588 };
const hit = (p: { lat: number; lng: number }): EndpointLookup => ({ state: 'hit', ...p });
/** A station name only the country-free free-text ladder could place. */
const fallbackHit = (p: { lat: number; lng: number }): EndpointLookup => ({
  state: 'hit',
  ...p,
  source: 'photon',
  station: true,
});
/** A tag-filtered, name-guarded station hit — trusted at any distance. */
const stationHit = (p: { lat: number; lng: number }): EndpointLookup => ({
  state: 'hit',
  ...p,
  source: 'photon-station',
  station: true,
});
const none: EndpointLookup = { state: 'none' };
const nul: EndpointLookup = { state: 'null' };
const miss: EndpointLookup = { state: 'miss' };

describe('greatCircleKm', () => {
  it('measures real distances', () => {
    expect(greatCircleKm(TOKYO, KYOTO)).toBeCloseTo(371, -1);
    expect(
      greatCircleKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }),
    ).toBeCloseTo(344, -1);
    expect(greatCircleKm(TOKYO, TOKYO)).toBe(0);
  });
});

describe('resolveTransitRoute', () => {
  it('draws a line between two resolved stations', () => {
    expect(resolveTransitRoute('train', hit(TOKYO), hit(KYOTO))).toEqual({
      drawRoute: true,
      reason: null,
    });
  });

  it('reports pending when either end has no cache row yet — even beside a null', () => {
    expect(resolveTransitRoute('train', miss, hit(KYOTO)).reason).toBe(PENDING_REASON);
    expect(resolveTransitRoute('train', hit(TOKYO), miss).reason).toBe(PENDING_REASON);
    expect(resolveTransitRoute('train', nul, miss)).toEqual({
      drawRoute: false,
      reason: PENDING_REASON,
    });
  });

  it('names the end that could not be found', () => {
    expect(resolveTransitRoute('bus', nul, hit(KYOTO))).toEqual({
      drawRoute: false,
      reason: DEPARTURE_NOT_FOUND_REASON,
    });
    expect(resolveTransitRoute('bus', hit(KYOTO), nul)).toEqual({
      drawRoute: false,
      reason: ARRIVAL_NOT_FOUND_REASON,
    });
  });

  it('falls back to the generic reason when nothing resolved', () => {
    expect(resolveTransitRoute('ferry', nul, nul).reason).toBe(NOT_FOUND_REASON);
    expect(resolveTransitRoute('ferry', nul, none).reason).toBe(NOT_FOUND_REASON);
    expect(resolveTransitRoute('ferry', none, nul).reason).toBe(NOT_FOUND_REASON);
  });

  it('adds no entry for a leg with only one end named', () => {
    expect(resolveTransitRoute('train', hit(TOKYO), none)).toEqual({
      drawRoute: false,
      reason: null,
    });
    expect(resolveTransitRoute('train', none, hit(KYOTO))).toEqual({
      drawRoute: false,
      reason: null,
    });
  });

  it('withholds the line past the mode’s distance cap, without an entry', () => {
    // Lisbon to western Siberia: within a train's reach, beyond a bus's
    // or a ferry's.
    const lisbon = { lat: 38.7223, lng: -9.1393 };
    const siberia = { lat: 64.1466, lng: 70 };
    const km = greatCircleKm(lisbon, siberia);
    expect(km).toBeGreaterThan(5000);
    expect(km).toBeLessThan(7000);
    expect(resolveTransitRoute('train', hit(lisbon), hit(siberia))).toEqual({
      drawRoute: true,
      reason: null,
    });
    expect(resolveTransitRoute('bus', hit(lisbon), hit(siberia))).toEqual({
      drawRoute: false,
      reason: null,
    });
    expect(resolveTransitRoute('ferry', hit(lisbon), hit(siberia)).drawRoute).toBe(false);
  });

  it('draws no line between two ends at the same spot', () => {
    const nextDoor = { lat: TOKYO.lat + 0.0001, lng: TOKYO.lng };
    expect(resolveTransitRoute('train', hit(TOKYO), hit(nextDoor))).toEqual({
      drawRoute: false,
      reason: null,
    });
  });
});

describe('resolveTransitRoute — fallback distance guard', () => {
  // The probe case from #144: the Torres del Paine ferry dock, the
  // refuge across the lake, and the Puerto Montt harbour ~1,065 km
  // north that a country-free free-text lookup for "Pudeto" returns.
  const PUDETO = { lat: -51.0614, lng: -72.9899 };
  const PAINE_GRANDE = { lat: -51.09, lng: -73.08 };
  const PUERTO_MONTT = { lat: -41.4693, lng: -72.9424 };

  it('leaves room under every mode cap, so the guard always fires first', () => {
    for (const mode of ['train', 'bus', 'ferry'] as const) {
      expect(MAX_FALLBACK_KM[mode]).toBeLessThan(MAX_ROUTE_KM[mode]);
    }
  });

  it('is set below the probe case and above an ordinary long leg', () => {
    expect(greatCircleKm(PUERTO_MONTT, PAINE_GRANDE)).toBeGreaterThan(MAX_FALLBACK_KM.ferry);
    expect(greatCircleKm(PUDETO, PAINE_GRANDE)).toBeLessThan(MAX_FALLBACK_KM.ferry);
  });

  it('still draws the long line when both ends are trusted station hits', () => {
    expect(
      resolveTransitRoute('ferry', stationHit(PUERTO_MONTT), stationHit(PAINE_GRANDE)),
    ).toEqual({ drawRoute: true, reason: null });
  });

  it('withholds the line and flags the departure when the origin was guessed', () => {
    expect(
      resolveTransitRoute('ferry', fallbackHit(PUERTO_MONTT), stationHit(PAINE_GRANDE)),
    ).toEqual({ drawRoute: false, reason: DEPARTURE_UNCERTAIN_REASON });
  });

  it('withholds the line and flags the arrival when the destination was guessed', () => {
    expect(resolveTransitRoute('ferry', stationHit(PUDETO), fallbackHit(PUERTO_MONTT))).toEqual({
      drawRoute: false,
      reason: ARRIVAL_UNCERTAIN_REASON,
    });
  });

  it('flags the pair when neither end is better than a guess', () => {
    expect(resolveTransitRoute('ferry', fallbackHit(PUERTO_MONTT), fallbackHit(PUDETO))).toEqual({
      drawRoute: false,
      reason: ROUTE_UNCERTAIN_REASON,
    });
  });

  it('leaves a guessed end alone when it sits near the other one', () => {
    expect(resolveTransitRoute('ferry', fallbackHit(PUDETO), stationHit(PAINE_GRANDE))).toEqual({
      drawRoute: true,
      reason: null,
    });
  });

  it('trusts a row whose provider is unknown — old rows keep their lines', () => {
    const legacy: EndpointLookup = { state: 'hit', ...PUERTO_MONTT, station: true, source: null };
    expect(resolveTransitRoute('ferry', legacy, stationHit(PAINE_GRANDE))).toEqual({
      drawRoute: true,
      reason: null,
    });
  });

  it('trusts a free-text row that was not a station lookup — an address or Plus Code end', () => {
    const addressEnd: EndpointLookup = { state: 'hit', ...PUERTO_MONTT, source: 'nominatim' };
    expect(resolveTransitRoute('ferry', addressEnd, stationHit(PAINE_GRANDE))).toEqual({
      drawRoute: true,
      reason: null,
    });
  });

  it('applies the mode’s own threshold', () => {
    const km = greatCircleKm(PUERTO_MONTT, PAINE_GRANDE);
    expect(km).toBeGreaterThan(MAX_FALLBACK_KM.ferry);
    expect(km).toBeLessThan(MAX_FALLBACK_KM.train);
    // The same pair: past a ferry's fallback threshold, inside a
    // train's — a Beijing–Kunming-class ride still draws its line.
    expect(
      resolveTransitRoute('train', fallbackHit(PUERTO_MONTT), stationHit(PAINE_GRANDE)),
    ).toEqual({ drawRoute: true, reason: null });
  });

  it('runs before the mode cap, so an over-cap guess gets an entry', () => {
    // Lisbon to western Siberia: beyond a bus's 5,000 km cap, which on
    // its own withholds the line silently. A guessed end turns that
    // into an explained entry.
    const lisbon = { lat: 38.7223, lng: -9.1393 };
    const siberia = { lat: 64.1466, lng: 70 };
    expect(greatCircleKm(lisbon, siberia)).toBeGreaterThan(MAX_ROUTE_KM.bus);
    expect(resolveTransitRoute('bus', hit(lisbon), hit(siberia))).toEqual({
      drawRoute: false,
      reason: null,
    });
    expect(resolveTransitRoute('bus', fallbackHit(lisbon), hit(siberia))).toEqual({
      drawRoute: false,
      reason: DEPARTURE_UNCERTAIN_REASON,
    });
  });
});

describe('transitRouteLabel', () => {
  it('prefers "From → To", then a single name, then locationName', () => {
    expect(transitRouteLabel({ fromName: 'Tokyo', toName: 'Kyoto' }, 'Honshu')).toBe(
      'Tokyo → Kyoto',
    );
    expect(transitRouteLabel({ toName: 'Kyoto' }, 'Honshu')).toBe('Kyoto');
    expect(transitRouteLabel({ fromName: ' Tokyo ' }, null)).toBe('Tokyo');
    expect(transitRouteLabel({}, 'Honshu')).toBe('Honshu');
    expect(transitRouteLabel(null, null)).toBe('Transit');
  });
});

describe('transitEndpointLabel', () => {
  it('uses the end’s own name, then its address, then which end it is', () => {
    expect(transitEndpointLabel({ name: 'Tokyo Station', address: 'Marunouchi' }, 'origin')).toBe(
      'Tokyo Station',
    );
    expect(transitEndpointLabel({ name: null, address: 'Marunouchi' }, 'origin')).toBe(
      'Marunouchi',
    );
    expect(transitEndpointLabel({ name: null, address: null }, 'origin')).toBe('Departure');
    expect(transitEndpointLabel({ name: null, address: null }, 'destination')).toBe('Arrival');
  });
});
