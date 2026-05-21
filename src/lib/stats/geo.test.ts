import { describe, expect, it } from 'vitest';

import { haversineKm } from './geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0);
  });

  it('computes a known long-haul distance within 1%', () => {
    // London Heathrow → Singapore Changi: ~10 880 km great-circle.
    const lhr = { lat: 51.4706, lng: -0.461941 };
    const sin = { lat: 1.35019, lng: 103.994003 };
    const d = haversineKm(lhr, sin);
    expect(d).toBeGreaterThan(10770);
    expect(d).toBeLessThan(10990);
  });

  it('computes a short-haul distance within 1%', () => {
    // London Heathrow → Paris Charles de Gaulle: ~348 km.
    const lhr = { lat: 51.4706, lng: -0.461941 };
    const cdg = { lat: 49.012798, lng: 2.55 };
    const d = haversineKm(lhr, cdg);
    expect(d).toBeGreaterThan(344);
    expect(d).toBeLessThan(352);
  });

  it('is symmetric', () => {
    const a = { lat: 35.6762, lng: 139.6503 };
    const b = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });

  it('measures a quarter of Earth circumference across 90° of longitude on the equator', () => {
    // From (0,0) to (0,90) is a quarter great circle: ~10 007 km.
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 });
    expect(d).toBeGreaterThan(9950);
    expect(d).toBeLessThan(10070);
  });
});
