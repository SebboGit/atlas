// Mirrors the /stats page scaffold (same <main> width, the title row, the
// lifetime pass and a few year tickets) so the swap to real content
// doesn't shift layout.
export default function StatsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-7 pb-24 sm:px-8 sm:pt-14">
      <header className="mb-5 flex items-baseline justify-between gap-4 sm:mb-8 sm:justify-start sm:gap-[1.125rem]">
        <h1 className="text-foreground text-[2.5rem] leading-none font-bold tracking-[-0.035em] sm:text-[3.5rem]">
          Stats
        </h1>
        <span className="bg-muted h-4 w-32 animate-pulse rounded-full motion-reduce:animate-none" />
      </header>

      <div aria-hidden className="flex flex-col gap-11 md:gap-[4.5rem]">
        {/* The lifetime pass: inverse body plus its stub strip / column. */}
        <div className="bg-inverse/90 h-[19rem] animate-pulse rounded-[1.375rem] motion-reduce:animate-none sm:h-[22rem] lg:h-[23.5rem] lg:rounded-[1.75rem]" />

        <div className="flex flex-col gap-2.5">
          <div className="bg-muted mb-1 h-8 w-48 animate-pulse rounded-lg motion-reduce:animate-none md:mb-2.5 md:h-10" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="border-border bg-card h-[5.25rem] animate-pulse rounded-2xl border motion-reduce:animate-none md:h-20"
            />
          ))}
        </div>
      </div>

      <span role="status" className="sr-only">
        Loading stats…
      </span>
    </main>
  );
}
