import { ChevronDown } from 'lucide-react';

import { plural } from '@/lib/stats/format';
import { splitYearRows, type YearRow } from '@/lib/stats/year-rows';
import { cn } from '@/lib/utils';

import { SECTION_HEADING } from './styles';

// One dot per trip, two rows at most; a year busier than this keeps its
// count beside the dots, which are only a picture of it.
const MAX_DOTS = 16;

/**
 * Year by year: one ticket per year, newest first, the year on the stub.
 * Laptop shows every year as a row (trips with a dot each, a nights bar
 * scaled to the busiest year, new countries). A phone shows a compact
 * ticket for the five most recent years and folds the rest behind a
 * `<details>` labelled with their range, so the disclosure needs no
 * client JavaScript. From `md:` the folded years render as plain tickets
 * and the disclosure is hidden.
 */
export function YearTickets({ rows }: { rows: YearRow[] }) {
  const { shown, folded, foldedLabel } = splitYearRows(rows);

  return (
    <section aria-labelledby="stats-years">
      <h2 id="stats-years" className={SECTION_HEADING}>
        Year by year
      </h2>
      {/* Only undated history so far — countries ticked on the world map
       *  count towards the pass, but there's no year to put them in. */}
      {rows.length === 0 && <p className="text-muted-foreground text-sm">Nothing dated yet.</p>}
      {rows.length > 0 && (
        <ol className="flex flex-col gap-2.5">
          {shown.map((row) => (
            <YearTicket key={row.year} row={row} />
          ))}
          {folded.map((row) => (
            <YearTicket key={row.year} row={row} className="hidden md:flex" />
          ))}
        </ol>
      )}
      {foldedLabel && (
        <details className="group mt-2.5 md:hidden">
          <summary className="border-input text-foreground hover:bg-card/60 focus-visible:ring-ring flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-2xl border border-dashed text-[0.9375rem] font-semibold focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Show </span>
            {foldedLabel}
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              strokeWidth={2}
            />
          </summary>
          <ol className="mt-2.5 flex flex-col gap-2.5">
            {folded.map((row) => (
              <YearTicket key={row.year} row={row} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function YearTicket({ row, className }: { row: YearRow; className?: string }) {
  const tripWord = plural(row.trips, 'trip');
  const newWord = plural(row.newCountries, 'new country', 'new countries');

  return (
    <li
      className={cn(
        'border-border bg-card flex min-h-[5.25rem] overflow-hidden rounded-2xl border shadow-[var(--shadow-paper)] md:h-20 md:min-h-0',
        className,
      )}
    >
      {/* The year on the stub; the current year in coral, still running. */}
      <div
        className={cn(
          'ticket-stub-left flex w-[4.875rem] shrink-0 flex-col justify-center gap-1 px-3 md:w-[7.5rem] md:pl-6 lg:w-[8.75rem]',
          row.current
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground [--color-perforation:var(--color-input)]',
        )}
      >
        <span className="text-[1.3125rem] leading-none font-bold tracking-[-0.02em] md:text-[1.75rem]">
          {row.year}
        </span>
        {row.current && <span className="text-[0.8125rem] font-semibold md:text-sm">so far</span>}
      </div>

      {/* Phone: the nights bar leads, trips and countries share a line. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-4 py-3.5 md:hidden">
        <div className="flex items-center gap-2.5">
          <NightsBar pct={row.nightsPct} className="h-2.5" />
          <span className="text-lg font-bold whitespace-nowrap">
            {row.nights}
            <span className="text-muted-foreground ml-1 text-sm font-medium">
              {plural(row.nights, 'night')}
            </span>
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-bold">{row.trips}</span> {tripWord} ·{' '}
          <span className="text-foreground font-bold">
            {row.newCountries > 0 ? `+${row.newCountries}` : 'no'}
          </span>{' '}
          {newWord}
        </p>
      </div>

      {/* Laptop: three labelled columns in a row. */}
      <div className="hidden min-w-0 flex-1 grid-cols-[6.5rem_minmax(0,1fr)_10.5rem] items-center gap-x-6 pr-6 pl-6 md:grid lg:grid-cols-[15.625rem_minmax(0,1fr)_14.375rem] lg:gap-x-9 lg:pr-8 lg:pl-9">
        <div className="flex items-center gap-4">
          <p className="shrink-0 whitespace-nowrap lg:w-[6.5rem]">
            <span className="text-[1.625rem] font-bold">{row.trips}</span>{' '}
            <span className="text-muted-foreground text-[1.0625rem]">{tripWord}</span>
          </p>
          <span aria-hidden className="hidden max-h-[25px] flex-wrap gap-[5px] lg:flex">
            {Array.from({ length: Math.min(row.trips, MAX_DOTS) }, (_, i) => (
              <span key={i} className="bg-foreground size-2.5 rounded-full" />
            ))}
          </span>
        </div>
        <div className="flex items-center gap-[1.125rem]">
          <NightsBar pct={row.nightsPct} className="h-3" />
          <p className="shrink-0 whitespace-nowrap lg:w-28">
            <span className="text-[1.625rem] font-bold">{row.nights}</span>{' '}
            <span className="text-muted-foreground text-[1.0625rem]">
              {plural(row.nights, 'night')}
            </span>
          </p>
        </div>
        {row.newCountries > 0 ? (
          <p className="whitespace-nowrap">
            <span className="text-[1.625rem] font-bold">+{row.newCountries}</span>{' '}
            <span className="text-muted-foreground text-[1.0625rem]">{newWord}</span>
          </p>
        ) : (
          <p className="text-muted-foreground text-[1.0625rem]">No new countries</p>
        )}
      </div>
    </li>
  );
}

// Nights as a share of the busiest year, in the hotel tone on a muted track.
function NightsBar({ pct, className }: { pct: number; className: string }) {
  return (
    <span aria-hidden className={cn('bg-muted flex-1 overflow-hidden rounded-full', className)}>
      <span
        className="bg-seg-hotel block h-full rounded-full shadow-[inset_0_0_0_1px_rgb(42_18_99/0.25)]"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
