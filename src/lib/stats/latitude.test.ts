import { describe, expect, it } from 'vitest';

import { latitudeBound, latitudePercent, latitudeTicks, layoutLatitude } from './latitude';

describe('latitudeBound', () => {
  it('defaults to ±60°', () => {
    expect(latitudeBound([-51, 58.5])).toBe(60);
    expect(latitudeBound([0])).toBe(60);
  });

  it('widens in 10° steps to fit the furthest point', () => {
    expect(latitudeBound([60.1])).toBe(70);
    expect(latitudeBound([-64.8, 12])).toBe(70);
    expect(latitudeBound([78.2])).toBe(80);
  });

  it('never goes past the poles', () => {
    expect(latitudeBound([89.9])).toBe(90);
    expect(latitudeBound([-90])).toBe(90);
  });
});

describe('latitudePercent', () => {
  it('puts the equator in the middle', () => {
    expect(latitudePercent(0, 60)).toBe(50);
    expect(latitudePercent(0, 90)).toBe(50);
  });

  it('runs south to north', () => {
    expect(latitudePercent(-60, 60)).toBe(0);
    expect(latitudePercent(60, 60)).toBe(100);
    expect(latitudePercent(30, 60)).toBe(75);
  });
});

describe('latitudeTicks', () => {
  it('labels 30° either side on the default scale', () => {
    expect(latitudeTicks(60, 800).map((t) => t.label)).toEqual(['30° S', '30° N']);
  });

  it('adds 60° once the scale is wider than it', () => {
    expect(latitudeTicks(80, 800).map((t) => t.label)).toEqual([
      '60° S',
      '30° S',
      '30° N',
      '60° N',
    ]);
  });

  it('drops ticks that would collide with the equator label', () => {
    // 30° on a ±90° scale sits ~1/6 of the half-width out: too close at 160px.
    expect(latitudeTicks(90, 160)).toEqual([]);
  });

  it('skips a tick that crowds the equator but keeps one further out', () => {
    expect(latitudeTicks(90, 300).map((t) => t.label)).toEqual(['60° S', '60° N']);
  });

  it('drops a tick whose label would run past the end of the track', () => {
    // 60° on a ±70° scale sits close to the ends; at 264px its label would clip.
    expect(latitudeTicks(70, 264).map((t) => t.label)).toEqual(['30° S', '30° N']);
  });
});

describe('layoutLatitude', () => {
  const south = { label: 'Torres del Paine', lat: -51.0 };
  const north = { label: 'Butt of Lewis', lat: 58.5 };

  it('returns null without any point', () => {
    expect(layoutLatitude(null, null, 800)).toBeNull();
  });

  it('draws both extremes on the default scale', () => {
    const layout = layoutLatitude(south, north, 800)!;
    expect(layout.bound).toBe(60);
    expect(layout.span).toBeCloseTo(109.5);
    expect(layout.labels.map((l) => [l.caption, l.value, l.anchor])).toEqual([
      ['Furthest south', '51.0° S', 'start'],
      ['Furthest north', '58.5° N', 'end'],
    ]);
    expect(layout.bar!.from).toBeCloseTo(7.5);
    expect(layout.bar!.to).toBeCloseTo(98.75);
    // The south label starts at its marker, the north label ends at its own.
    expect(layout.leadSpacer).toBeCloseTo(7.5);
    expect(layout.trailSpacer).toBeCloseTo(1.25);
    expect(layout.description).toBe(
      'Furthest south 51.0° S, Torres del Paine. Furthest north 58.5° N, Butt of Lewis.',
    );
  });

  it('carries an airport code beside its place and into the description', () => {
    const layout = layoutLatitude({ label: 'Punta Arenas', lat: -53.0, code: 'PUQ' }, north, 800)!;
    expect(layout.labels.map((l) => [l.place, l.code])).toEqual([
      ['Punta Arenas', 'PUQ'],
      ['Butt of Lewis', undefined],
    ]);
    expect(layout.description).toBe(
      'Furthest south 53.0° S, Punta Arenas (PUQ). Furthest north 58.5° N, Butt of Lewis.',
    );
  });

  it('keeps both extremes on one side when they share a hemisphere', () => {
    const layout = layoutLatitude(
      { label: 'Oslo', lat: 59.9 },
      { label: 'Tromsø', lat: 69.6 },
      800,
    )!;
    expect(layout.bound).toBe(70);
    expect(layout.labels.every((l) => l.pct > 50)).toBe(true);
    expect(layout.bar!.from).toBeLessThan(layout.bar!.to);
  });

  it('draws a single point once when both extremes are the same place', () => {
    const layout = layoutLatitude(north, north, 800)!;
    expect(layout.labels).toHaveLength(1);
    expect(layout.labels[0]!.caption).toBe('Furthest north and south');
    expect(layout.span).toBe(0);
    expect(layout.bar).toBeNull();
  });

  it('handles only one extreme being known', () => {
    const onlySouth = layoutLatitude(south, null, 800)!;
    expect(onlySouth.labels.map((l) => l.caption)).toEqual(['Furthest south']);
    expect(onlySouth.span).toBeNull();
    // South of the equator, so the label starts at its marker…
    expect(onlySouth.labels[0]!.anchor).toBe('start');

    // …and north of it, it ends at its marker.
    const onlyNorth = layoutLatitude(null, north, 800)!;
    expect(onlyNorth.labels[0]!.anchor).toBe('end');
    expect(onlyNorth.leadSpacer).toBe(0);
  });
});
