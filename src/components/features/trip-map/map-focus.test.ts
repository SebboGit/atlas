import { describe, expect, it } from 'vitest';

import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

import { resolveFocusTarget } from './map-focus';

function pin(overrides: Partial<TripMapPin> & { segmentId: string }): TripMapPin {
  return {
    kind: 'hotel',
    label: 'Somewhere',
    country: 'JP',
    lat: 35,
    lng: 139,
    date: null,
    ...overrides,
  };
}

const flightArc: TripMapArc = {
  segmentId: 'flight',
  kind: 'flight',
  originLat: 51.47,
  originLng: -0.45,
  destLat: 35.55,
  destLng: 139.78,
  originCountry: 'GB',
  destCountry: 'JP',
};
const trainArc: TripMapArc = {
  segmentId: 'train',
  kind: 'transit',
  mode: 'train',
  originLat: 35.68,
  originLng: 139.77,
  destLat: 34.99,
  destLng: 135.76,
  originCountry: 'JP',
  destCountry: 'JP',
};
const tokyo = pin({ segmentId: 'train', kind: 'transit', endpoint: 'origin', label: 'Tokyo' });
const kyoto = pin({ segmentId: 'train', kind: 'transit', endpoint: 'destination', label: 'Kyoto' });

describe('resolveFocusTarget', () => {
  it('fits a flight route at country scale without a tooltip', () => {
    const lhr = pin({ segmentId: 'flight', kind: 'flight', label: 'LHR' });
    expect(resolveFocusTarget('flight', [lhr], [flightArc])).toEqual({
      type: 'fit',
      points: [
        { lat: 51.47, lng: -0.45 },
        { lat: 35.55, lng: 139.78 },
      ],
      maxZoom: 8,
      tooltipPin: null,
    });
  });

  it('fits a transit line closer and names its arrival station', () => {
    expect(resolveFocusTarget('train', [tokyo, kyoto], [trainArc])).toMatchObject({
      type: 'fit',
      maxZoom: 12,
      tooltipPin: kyoto,
    });
  });

  it('fits both stations of a leg drawn without a line', () => {
    const target = resolveFocusTarget('train', [tokyo, kyoto], []);
    expect(target).toEqual({
      type: 'fit',
      points: [
        { lat: tokyo.lat, lng: tokyo.lng },
        { lat: kyoto.lat, lng: kyoto.lng },
      ],
      maxZoom: 12,
      tooltipPin: kyoto,
    });
  });

  it('flies to a single pin with a tooltip, except for a lone flight pin', () => {
    const hotel = pin({ segmentId: 'hotel' });
    expect(resolveFocusTarget('hotel', [hotel], [])).toEqual({
      type: 'fly',
      pin: hotel,
      showTooltip: true,
    });
    const hnd = pin({ segmentId: 'lone-flight', kind: 'flight' });
    expect(resolveFocusTarget('lone-flight', [hnd], [])).toEqual({
      type: 'fly',
      pin: hnd,
      showTooltip: false,
    });
    expect(resolveFocusTarget('train', [tokyo], [])).toMatchObject({ type: 'fly', pin: tokyo });
  });

  it('does nothing for a segment the map cannot place', () => {
    expect(resolveFocusTarget('note', [tokyo, kyoto], [trainArc])).toEqual({ type: 'none' });
  });
});
