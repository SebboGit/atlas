import { describe, expect, it } from 'vitest';

import { googleMapsUrl } from './plus-code-badge';

describe('googleMapsUrl', () => {
  it('composes a venue-biased URL when venue is supplied', () => {
    expect(googleMapsUrl({ lat: 35.6762, lng: 139.6503, venue: 'Tokyo Tower' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Tokyo%20Tower+35.6762,139.6503',
    );
  });

  it('falls back to bare coordinates when venue is omitted', () => {
    expect(googleMapsUrl({ lat: 48.8588, lng: 2.2943 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=48.8588,2.2943',
    );
  });

  it('falls back to bare coordinates when venue is whitespace-only', () => {
    expect(googleMapsUrl({ lat: 48.8588, lng: 2.2943, venue: '   ' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=48.8588,2.2943',
    );
  });

  it('percent-encodes ampersands and other reserved chars in the venue', () => {
    const url = googleMapsUrl({ lat: 1, lng: 2, venue: 'A & B Café' });
    expect(url).toContain('A%20%26%20B%20Caf%C3%A9');
    expect(url).toContain('1,2');
  });

  it('falls back to bare coordinates when venue is null', () => {
    expect(googleMapsUrl({ lat: -33.8688, lng: 151.2093, venue: null })).toBe(
      'https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093',
    );
  });
});
