import { describe, expect, it } from 'vitest';

import { transitDirectionsUrl } from './transit-directions';

function params(url: string | null): Record<string, string> {
  expect(url).not.toBeNull();
  return Object.fromEntries(new URL(url!).searchParams);
}

describe('transitDirectionsUrl', () => {
  it('links a train by its station names in transit mode', () => {
    const url = transitDirectionsUrl({
      mode: 'train',
      fromName: 'Tokyo Station',
      toName: 'Kyoto Station',
    });
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=Tokyo%20Station&destination=Kyoto%20Station&travelmode=transit',
    );
  });

  it('prefers the name over a saved Plus Code, then falls back to the code and address', () => {
    expect(
      params(
        transitDirectionsUrl({
          mode: 'ferry',
          fromName: 'Pudeto',
          fromPlusCode: '47Q3WVX9+GH',
          address: 'Refugio Paine Grande',
        }),
      ),
    ).toMatchObject({ origin: 'Pudeto', destination: 'Refugio Paine Grande' });

    const decoded = params(
      transitDirectionsUrl({ mode: 'bus', fromPlusCode: '8Q7XMQJ8+FV', toName: 'Kyoto Station' }),
    );
    expect(decoded.origin).toMatch(/^35\.68\d{4},139\.76\d{4}$/);
  });

  it('passes a local Plus Code with its anchor through as typed', () => {
    expect(
      params(
        transitDirectionsUrl({
          mode: 'train',
          fromName: 'Tokyo Station',
          plusCode: 'MQ8R+5C Chiyoda City, Tokyo',
        }),
      ).destination,
    ).toBe('MQ8R+5C Chiyoda City, Tokyo');
  });

  it('drives a car and omits the mode for other', () => {
    expect(
      params(transitDirectionsUrl({ mode: 'car', fromName: 'Florence', toName: 'Siena' })),
    ).toMatchObject({ travelmode: 'driving' });
    expect(
      params(transitDirectionsUrl({ mode: 'other', fromName: 'Florence', toName: 'Siena' })),
    ).not.toHaveProperty('travelmode');
  });

  it('uses only the From name as a car’s origin', () => {
    expect(
      transitDirectionsUrl({ mode: 'car', fromAddress: 'Piazza della Stazione', toName: 'Siena' }),
    ).toBeNull();
  });

  it('returns null when an end is missing or both ends are the same', () => {
    expect(transitDirectionsUrl({ mode: 'train', toName: 'Kyoto Station' })).toBeNull();
    expect(transitDirectionsUrl({ mode: 'train', fromName: 'Tokyo Station' })).toBeNull();
    expect(
      transitDirectionsUrl({ mode: 'bus', fromName: 'Kyoto Station', toName: 'kyoto station' }),
    ).toBeNull();
    expect(
      transitDirectionsUrl({ mode: 'train', fromName: 'Tokyo', plusCode: 'MP7J+CV' }),
    ).toBeNull();
  });
});
