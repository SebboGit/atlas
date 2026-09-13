import { describe, expect, it } from 'vitest';

import {
  endpointEdited,
  endpointPinLine,
  endpointSectionStartsOpen,
  valueAt,
} from './transit-endpoint-logic';

describe('endpointPinLine', () => {
  const located = { lat: 35.6812, lng: 139.7671, city: 'Chiyoda' };
  const base = { name: 'Tokyo Station', address: '', plusCode: '', located, edited: false };

  it('shows a saved or typed Plus Code as pinned, with the address as detail', () => {
    expect(
      endpointPinLine({ ...base, plusCode: '8Q7XMQJ8+FV', address: '1-9-1 Marunouchi' }),
    ).toEqual({ state: 'pinned', code: '8Q7XMQJ8+FV', detail: '1-9-1 Marunouchi' });
    expect(
      endpointPinLine({ ...base, plusCode: 'MQ8R+5C Chiyoda City, Tokyo', located: null }),
    ).toEqual({ state: 'pinned', code: 'MQ8R+5C Chiyoda City, Tokyo', detail: null });
  });

  it('never calls a code the form would reject pinned', () => {
    // A local code needs its anchor to be valid.
    expect(endpointPinLine({ ...base, plusCode: 'MQ8R+5C', located: null })).toBeNull();
    expect(endpointPinLine({ ...base, plusCode: '8Q7X', located: null })).toBeNull();
  });

  it('shows where the saved segment located an end, until that end is edited', () => {
    expect(endpointPinLine(base)).toEqual({
      state: 'located',
      code: expect.stringMatching(/^8Q7X[A-Z0-9]{4}\+[A-Z0-9]{2}$/),
      detail: 'Chiyoda',
    });
    expect(endpointPinLine({ ...base, edited: true })).toBeNull();
  });

  it('shows no location under an end with nothing to locate by', () => {
    expect(endpointPinLine({ ...base, name: '' })).toBeNull();
    expect(
      endpointPinLine({
        name: undefined,
        address: undefined,
        plusCode: undefined,
        located,
        edited: false,
      }),
    ).toBeNull();
  });
});

describe('endpointEdited', () => {
  const saved = { name: 'Tokyo Station', address: undefined, plusCode: undefined };

  it('treats blank and missing values as unchanged', () => {
    expect(endpointEdited({ name: 'Tokyo Station ', address: '', plusCode: '' }, saved)).toBe(
      false,
    );
  });

  it('flags a changed name, address or Plus Code', () => {
    expect(endpointEdited({ name: 'Shinagawa', address: '', plusCode: '' }, saved)).toBe(true);
    expect(endpointEdited({ name: 'Tokyo Station', address: 'x', plusCode: '' }, saved)).toBe(true);
    expect(
      endpointEdited({ name: 'Tokyo Station', address: '', plusCode: '8Q7XMQJ8+FV' }, saved),
    ).toBe(true);
  });
});

describe('endpointSectionStartsOpen', () => {
  it('starts open only for a saved address with no Plus Code', () => {
    expect(endpointSectionStartsOpen({ address: 'Marunouchi', plusCode: '' })).toBe(true);
    expect(endpointSectionStartsOpen({ address: 'Marunouchi', plusCode: '8Q7XMQJ8+FV' })).toBe(
      false,
    );
    expect(endpointSectionStartsOpen({ address: undefined, plusCode: undefined })).toBe(false);
  });
});

describe('valueAt', () => {
  it('reads a dotted path and tolerates missing branches', () => {
    expect(valueAt({ data: { fromName: 'Tokyo' } }, 'data.fromName')).toBe('Tokyo');
    expect(valueAt({ data: {} }, 'data.fromName')).toBeUndefined();
    expect(valueAt(undefined, 'data.fromName')).toBeUndefined();
  });
});
