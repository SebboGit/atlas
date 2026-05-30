// Mirrors the /stats page scaffold (same <main> width, header rule, and
// lifetime tile grid) so the swap to real content doesn't shift layout.
export default function StatsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-24 sm:px-8 sm:pt-20">
      <header className="atlas-rise mb-8">
        <p className="text-muted-foreground mb-4 hidden items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase sm:flex">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Logbook</span>
        </p>
        <div className="bg-muted/70 h-12 w-64 max-w-full animate-pulse rounded-lg motion-reduce:animate-none sm:h-14 sm:w-80" />
      </header>

      <div className="atlas-rule mb-10" aria-hidden />

      {/* Lifetime headline — 2×2 on phone, single row on laptop, matching the page. */}
      <div
        aria-hidden
        className="atlas-rise grid grid-cols-2 gap-5 lg:grid-cols-4"
        style={{ animationDelay: '120ms' }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-foreground/10 bg-card/40 h-32 animate-pulse rounded-2xl border motion-reduce:animate-none"
          />
        ))}
      </div>

      <span role="status" className="sr-only">
        Loading stats…
      </span>
    </main>
  );
}
