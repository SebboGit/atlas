import { describe, expect, it } from 'vitest';

import { legendRows } from './legend-rows';

describe('legendRows', () => {
  it('lists present kinds in legend order', () => {
    const rows = legendRows(new Set(['food', 'transit', 'flight']), new Set());
    expect(rows.map((r) => r.kind)).toEqual(['flight', 'transit', 'food']);
    expect(rows.map((r) => r.label)).toEqual(['Flight', 'Transit', 'Food']);
  });

  it('adds a line swatch only for route kinds drawn on this trip', () => {
    const rows = legendRows(
      new Set(['flight', 'transit', 'hotel']),
      new Set(['flight', 'transit']),
    );
    expect(rows.map((r) => [r.kind, r.route])).toEqual([
      ['flight', 'dashed'],
      ['hotel', null],
      ['transit', 'solid'],
    ]);
  });

  it('shows no transit swatch when transit pins have no line', () => {
    const rows = legendRows(new Set(['transit']), new Set(['flight']));
    expect(rows).toEqual([{ kind: 'transit', label: 'Transit', route: null }]);
  });
});
