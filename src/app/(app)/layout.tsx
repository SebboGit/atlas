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
        <Topbar />
        {children}
        <SearchPalette />
      </div>
    </SearchPaletteProvider>
  );
}
