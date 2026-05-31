import { SearchPalette, SearchPaletteProvider } from '@/components/search/search-palette';
import { Topbar } from '@/components/topbar';
import { requireUser } from '@/lib/auth/session';

// The /(app)/* segment requires a signed-in user. Middleware redirects
// unauthenticated requests to sign-in before they reach this layout — this
// requireUser() is the inner-ring guarantee for server data access.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <SearchPaletteProvider>
      <div className="min-h-screen">
        {/* First focusable element: lets keyboard users jump past the topbar
            straight to page content. Visually hidden until focused. */}
        <a
          href="#main-content"
          className="focus-visible:border-foreground/15 focus-visible:bg-card focus-visible:text-foreground focus-visible:ring-primary/40 sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:z-50 focus-visible:rounded-lg focus-visible:border focus-visible:px-4 focus-visible:py-2 focus-visible:font-mono focus-visible:text-[11px] focus-visible:tracking-[0.2em] focus-visible:uppercase focus-visible:ring-2 focus-visible:outline-none"
        >
          Skip to content
        </a>
        <Topbar />
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <SearchPalette />
      </div>
    </SearchPaletteProvider>
  );
}
