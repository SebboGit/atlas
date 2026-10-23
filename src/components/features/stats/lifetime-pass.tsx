import type { CSSProperties } from 'react';

import type { BarcodeLayout } from '@/lib/stats/barcode';
import { figureWidthEm } from '@/lib/stats/format';
import { cn } from '@/lib/utils';

/** Everything the pass prints, already formatted by the page. */
export interface LifetimePassData {
  countries: string;
  countriesWord: string;
  nights: string;
  nightsWord: string;
  flights: string;
  flightsWord: string;
  /** "Chile, Oct 2026" — the newest country and when it was first visited. */
  newestCountry: string | null;
  /** "10 months on the road", or null under a month. */
  timeOnTheRoad: string | null;
  /** Grouped figure in the display unit: "268 940". */
  distance: string;
  /** "km flown" / "miles flown". */
  distanceWord: string;
  /** "6.7", or null when there's no distance to speak of. */
  earthLaps: string | null;
  firstName: string | null;
  /** "30 trips since 2019", or null without dated trips. */
  tripsSince: string | null;
  barcode: BarcodeLayout | null;
}

/**
 * The lifetime headline as an inverse ticket — the same "now / next"
 * surface as the trip banner, in both themes. Countries, nights and
 * flights across the body, distance flown on its own row below a hairline,
 * and a perforated stub carrying the viewer's name: a strip along the
 * bottom on phone and tablet, a side column with the trip barcode from
 * `lg:` (where the three figures still have room beside it).
 */
export function LifetimePass({ data }: { data: LifetimePassData }) {
  const stats = [
    {
      value: data.countries,
      word: data.countriesWord,
      note: data.newestCountry && `Newest: ${data.newestCountry}`,
    },
    { value: data.nights, word: data.nightsWord, note: data.timeOnTheRoad },
    { value: data.flights, word: data.flightsWord, note: 'Counted by leg' },
  ];

  return (
    <section
      aria-labelledby="stats-lifetime"
      className="bg-inverse text-inverse-foreground flex flex-col overflow-hidden rounded-[1.375rem] lg:flex-row lg:rounded-[1.75rem]"
    >
      <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:px-11 lg:py-11 xl:px-[3.25rem]">
        {/* Phone and tablet: three figures at their natural widths, spread
         *  edge to edge. Laptop: three equal columns, each with its note.
         *  Figures share one size, capped per breakpoint and stepped down
         *  when four-digit tallies would crowd the row (see figureSizing);
         *  a noun may still wrap if the estimate runs a few px short. */}
        <div
          className="@container [--stat-max:2.5rem] sm:[--stat-max:3.25rem] lg:[--stat-max:3.75rem] xl:[--stat-max:4.75rem]"
          style={figureSizing(stats)}
        >
          <div className="flex justify-between gap-4 lg:grid lg:grid-cols-3 lg:gap-10">
            {stats.map((s) => (
              <div key={s.word} className="min-w-0 lg:@container">
                <p className="text-[length:var(--stat-size)] leading-[0.9] font-bold tracking-[-0.04em] whitespace-nowrap [--stat-size:clamp(1.25rem,calc((100cqi_-_var(--row-fixed))_/_var(--row-em)),var(--stat-max))] lg:[--stat-size:min(var(--stat-max),calc(100cqi_/_var(--cell-em)))]">
                  {s.value}
                </p>
                <p className="mt-2 text-[0.9375rem] font-semibold tracking-[-0.01em] sm:text-lg lg:mt-3 lg:text-xl xl:text-[1.375rem]">
                  {s.word}
                </p>
                {s.note && (
                  <p className="text-inverse-muted mt-1.5 hidden text-[0.9375rem] lg:block">
                    {s.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        {data.newestCountry && (
          <p className="text-inverse-muted mt-2.5 text-[0.8125rem] sm:text-[0.9375rem] lg:hidden">
            Newest country: {data.newestCountry}
          </p>
        )}

        <div className="border-inverse-line mt-5 border-t pt-[1.125rem] sm:mt-7 sm:pt-6 lg:mt-9 lg:pt-8">
          <DistanceFigure distance={data.distance} word={data.distanceWord} />
          {data.earthLaps && (
            <p className="text-inverse-accent mt-2 text-sm font-semibold sm:text-base lg:mt-3 lg:text-[1.0625rem]">
              {data.earthLaps} × around the Earth
            </p>
          )}
        </div>
      </div>

      {/* The perforation: across the pass above the bottom strip, down it
       *  beside the side column. Notches punched at both ends. */}
      <div
        aria-hidden
        className="border-inverse-line relative border-t-2 border-dashed lg:border-t-0 lg:border-l-2"
      >
        <span className="bg-background absolute -top-2.5 -left-2.5 size-[18px] rounded-full" />
        <span className="bg-background absolute -top-2.5 -right-2.5 size-[18px] rounded-full lg:top-auto lg:right-auto lg:-bottom-2.5 lg:-left-2.5" />
      </div>

      <div className="flex flex-col justify-between gap-8 px-6 pt-[1.125rem] pb-5 sm:px-8 lg:w-80 lg:shrink-0 lg:px-10 lg:pt-11 lg:pb-10">
        <div className="flex items-baseline justify-between gap-4 lg:flex-col lg:items-start lg:justify-start lg:gap-0">
          <div className="min-w-0">
            {/* The pass's heading, though it prints on the stub: it names
             *  the section and makes it reachable by heading navigation. */}
            <h2
              id="stats-lifetime"
              className="text-inverse-accent text-sm font-semibold lg:mb-2.5 lg:text-[1.0625rem]"
            >
              Lifetime pass
            </h2>
            {data.firstName && (
              <p className="mt-1.5 truncate text-[1.375rem] leading-none font-bold tracking-[-0.02em] lg:mt-0 lg:text-4xl lg:tracking-[-0.03em]">
                {data.firstName}
              </p>
            )}
          </div>
          {data.tripsSince && (
            <p className="text-inverse-muted shrink-0 text-sm whitespace-nowrap lg:mt-2.5 lg:text-base">
              {data.tripsSince}
            </p>
          )}
        </div>
        {data.barcode && <Barcode layout={data.barcode} />}
      </div>
    </section>
  );
}

// The phone row: figures 20–40px, nouns 15px (semibold, ~0.55em a
// character, rounded up), at least 16px between columns, 272px wide at
// 360px.
const PHONE_FIGURE_PX = 40;
const PHONE_NOUN_PX_PER_CHAR = 8.2;
const PHONE_FIGURE_MIN_PX = 20; // the 1.25rem floor in the CSS clamp
const PHONE_GAPS_PX = 2 * 16;
const PHONE_ROW_PX = 272;

/**
 * Size inputs for the three headline figures. On the phone row each
 * column is as wide as its figure or its noun, whichever is wider: noun-led
 * columns are fixed width (`--row-fixed`, px, with the gaps), figure-led
 * ones scale with the font (`--row-em`), and the figure size is the room
 * left over divided by that. Which columns lead is settled for the 360px
 * row, so "118 · 1 299 · 1 204" fits there while "19 · 299 · 74" keeps
 * the full size. Laptop columns are equal, so there `--cell-em` (the
 * widest figure) is all that matters.
 */
function figureSizing(stats: Array<{ value: string; word: string }>): CSSProperties {
  const widths = stats.map((s) => figureWidthEm(s.value));
  const nouns = stats.map((s) => s.word.length * PHONE_NOUN_PX_PER_CHAR);
  const rowAt = (px: number) =>
    PHONE_GAPS_PX + widths.reduce((sum, em, i) => sum + Math.max(em * px, nouns[i]!), 0);
  // The largest figure size, in half-pixel steps, whose row fits. The CSS
  // clamps to the same 20px floor should even that not fit.
  let size = PHONE_FIGURE_PX;
  while (size > PHONE_FIGURE_MIN_PX && rowAt(size) > PHONE_ROW_PX) size -= 0.5;
  // At that size, split the columns into figure-led and noun-led.
  let rowEm = 0;
  let rowFixed = PHONE_GAPS_PX;
  widths.forEach((em, i) => {
    if (em * size >= nouns[i]!) rowEm += em;
    else rowFixed += nouns[i]!;
  });
  // Every column noun-led: the figures are short, so size them against the
  // row alone, which on any phone lands on the cap. (Dividing by nothing
  // would drop them to the floor the moment the row ran narrower.)
  if (rowEm === 0) {
    rowEm = widths.reduce((a, b) => a + b, 0);
    rowFixed = PHONE_GAPS_PX;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    '--row-em': r(rowEm),
    '--row-fixed': `${Math.round(rowFixed)}px`,
    '--cell-em': r(Math.max(...widths)),
  } as CSSProperties;
}

// Unit-word width estimate, em at the word's own size: semibold Bricolage
// averages a little over half an em per character.
const WORD_EM_PER_CHAR = 0.56;

/**
 * Distance flown on one line, always. The figure's size is the smaller of
 * the breakpoint's display size and what the row can hold: the row is a
 * size container, and the figure divides the room left after the unit
 * word by its own estimated width in em (`figureWidthEm`). So "268 940"
 * prints at full size while "12 480 300" steps down at 360px instead of
 * wrapping or pushing the page sideways.
 */
function DistanceFigure({ distance, word }: { distance: string; word: string }) {
  const vars = {
    '--fig-em': figureWidthEm(distance),
    '--word-em': Math.round(word.length * WORD_EM_PER_CHAR * 100) / 100,
  } as CSSProperties;
  return (
    <div className="@container [--fig-gap:0.5rem] [--fig-max:2.25rem] [--word-size:0.9375rem] sm:[--fig-max:3.25rem] sm:[--word-size:1.125rem] lg:[--fig-gap:0.875rem] lg:[--fig-max:3.75rem] lg:[--word-size:1.25rem] xl:[--fig-max:4.75rem] xl:[--word-size:1.375rem]">
      <p className="flex items-baseline gap-[var(--fig-gap)] whitespace-nowrap" style={vars}>
        <span
          className="leading-[0.9] font-bold tracking-[-0.04em]"
          style={{
            fontSize:
              'min(var(--fig-max), calc((100cqi - var(--word-em) * var(--word-size) - var(--fig-gap)) / var(--fig-em)))',
          }}
        >
          {distance}
        </span>
        <span className="text-[length:var(--word-size)] font-semibold tracking-[-0.01em]">
          {word}
        </span>
      </p>
    </div>
  );
}

/**
 * One bar per trip, grouped by year with the year under each group; the
 * current year in the accent. Laid out by `layoutBarcode` to fit the
 * stub on one line, thinning rather than wrapping. Side column only.
 */
function Barcode({ layout }: { layout: BarcodeLayout }) {
  return (
    <div
      role="img"
      aria-label={layout.description}
      className="hidden items-end justify-center-safe overflow-hidden lg:flex"
      style={{ gap: layout.groupGap }}
    >
      {layout.groups.map((g) => (
        <div key={g.year} className="flex min-w-[22px] shrink-0 flex-col items-center gap-2">
          <div className="flex h-[3.75rem]" style={{ gap: layout.barGap }}>
            {Array.from({ length: g.bars }, (_, i) => (
              <span
                key={i}
                className={g.current ? 'bg-inverse-accent' : 'bg-inverse-foreground'}
                style={{ width: layout.barWidth }}
              />
            ))}
          </div>
          <span
            className={cn(
              'font-mono text-xs leading-none',
              g.current ? 'text-inverse-accent' : 'text-inverse-muted',
            )}
          >
            {g.label}
          </span>
        </div>
      ))}
    </div>
  );
}
