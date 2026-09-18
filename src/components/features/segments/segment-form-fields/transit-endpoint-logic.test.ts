import { describe, expect, it } from 'vitest';

import { endpointSectionStartsOpen, TRANSIT_ENDPOINT_PATHS } from './transit-endpoint-logic';

describe('endpointSectionStartsOpen', () => {
  it('starts open only for a saved address with no Plus Code', () => {
    expect(endpointSectionStartsOpen({ address: 'Marunouchi', plusCode: '' })).toBe(true);
    expect(endpointSectionStartsOpen({ address: 'Marunouchi', plusCode: '8Q7XMQJ8+FV' })).toBe(
      false,
    );
    expect(endpointSectionStartsOpen({ address: undefined, plusCode: undefined })).toBe(false);
  });
});

describe('TRANSIT_ENDPOINT_PATHS', () => {
  it('gives each end its own three fields', () => {
    expect(TRANSIT_ENDPOINT_PATHS.from).toEqual({
      name: 'data.fromName',
      address: 'data.fromAddress',
      plusCode: 'data.fromPlusCode',
    });
    expect(TRANSIT_ENDPOINT_PATHS.to).toEqual({
      name: 'data.toName',
      address: 'data.address',
      plusCode: 'data.plusCode',
    });
  });
});
