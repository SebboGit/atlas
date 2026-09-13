import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_NOT_FOUND_REASON,
  DEPARTURE_NOT_FOUND_REASON,
  greatCircleKm,
  NOT_FOUND_REASON,
  PENDING_REASON,
  resolveTransitRoute,
  transitEndpointLabel,
  transitRouteLabel,
  type EndpointLookup,
} from './transit-route';

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const KYOTO = { lat: 34.9858, lng: 135.7588 };
const hit = (p: { lat: number; lng: number }): EndpointLookup => ({ state: 'hit', ...p });
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
