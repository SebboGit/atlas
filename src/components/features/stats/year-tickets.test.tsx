import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { YearTickets } from './year-tickets';

describe('YearTickets', () => {
  it('says so instead of an empty list when nothing is dated', () => {
    // A viewer who has only ticked countries on the world map: the pass
    // has a count, but there is no year to file anything under.
    const html = renderToStaticMarkup(createElement(YearTickets, { rows: [] }));
    expect(html).toContain('Year by year');
    expect(html).toContain('Nothing dated yet.');
    expect(html).not.toContain('<ol');
  });

  it('lists a ticket per year otherwise', () => {
    const html = renderToStaticMarkup(
      createElement(YearTickets, {
        rows: [
          { year: 2025, trips: 2, nights: 9, newCountries: 1, nightsPct: 100, current: false },
        ],
      }),
    );
    expect(html).toContain('<ol');
    expect(html).not.toContain('Nothing dated yet.');
  });
});
