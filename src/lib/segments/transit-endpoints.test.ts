import { describe, expect, it } from 'vitest';

import { hasTransitEndpoints, resolveTransitEndpoints } from './transit-endpoints';

describe('hasTransitEndpoints', () => {
  it('is true for train, bus and ferry', () => {
    expect(hasTransitEndpoints('train')).toBe(true);
    expect(hasTransitEndpoints('bus')).toBe(true);
    expect(hasTransitEndpoints('ferry')).toBe(true);
  });

  it('is false for car, other and anything that is not a mode', () => {
    expect(hasTransitEndpoints('car')).toBe(false);
    expect(hasTransitEndpoints('other')).toBe(false);
    expect(hasTransitEndpoints('Train')).toBe(false);
    expect(hasTransitEndpoints(undefined)).toBe(false);
    expect(hasTransitEndpoints(null)).toBe(false);
  });
});

describe('resolveTransitEndpoints', () => {
  it('reads names from fromName / toName with no locations', () => {
    expect(resolveTransitEndpoints({ mode: 'train', fromName: 'Tokyo', toName: 'Kyoto' })).toEqual({
      origin: { name: 'Tokyo', address: null, plusCode: null },
      destination: { name: 'Kyoto', address: null, plusCode: null },
    });
  });

  it('keeps address / plusCode on the destination and from* on the origin', () => {
    const resolved = resolveTransitEndpoints({
      mode: 'ferry',
      fromName: 'Pudeto',
      toName: 'Paine Grande',
      address: 'Lago Pehoé',
      plusCode: '47Q3WWJ8+2V',
      fromAddress: 'Ruta Y-150',
      fromPlusCode: '47Q3WVX9+GH',
    });
    expect(resolved.destination).toEqual({
      name: 'Paine Grande',
      address: 'Lago Pehoé',
      plusCode: '47Q3WWJ8+2V',
    });
    expect(resolved.origin).toEqual({
      name: 'Pudeto',
      address: 'Ruta Y-150',
      plusCode: '47Q3WVX9+GH',
    });
  });

  it('keeps address and plusCode on the destination even when only the origin is named', () => {
    const resolved = resolveTransitEndpoints({
      mode: 'bus',
      fromName: 'Victoria Coach Station',
      address: '164 Buckingham Palace Rd',
      plusCode: '9C3XGV4C+VR',
    });
    expect(resolved.origin).toEqual({
      name: 'Victoria Coach Station',
      address: null,
      plusCode: null,
    });
    expect(resolved.destination).toEqual({
      name: null,
      address: '164 Buckingham Palace Rd',
      plusCode: '9C3XGV4C+VR',
    });
  });

  it('treats blank and whitespace strings as absent', () => {
    const resolved = resolveTransitEndpoints({
      mode: 'train',
      fromName: '  ',
      toName: 'Kyoto',
      address: '',
      fromAddress: ' ',
    });
    expect(resolved.origin).toEqual({ name: null, address: null, plusCode: null });
    expect(resolved.destination).toEqual({ name: 'Kyoto', address: null, plusCode: null });
  });
});
