import { headers } from 'next/headers';
import Link from 'next/link';

import { SearchTrigger } from '@/components/search/search-trigger';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/config';

// Extract a same-origin pathname (+ search) from the request's Referer.
// Returns null if the referer is missing, cross-origin, or malformed —
// the caller falls back to the /signin default destination in that case.
async function refererReturnPath(): Promise<string | null> {
  const h = await headers();
  const referer = h.get('referer');
  const host = h.get('host');
  if (!referer || !host) return null;
  try {
    const u = new URL(referer);
    if (u.host !== host) return null;
    if (!u.pathname.startsWith('/') || u.pathname.startsWith('//')) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

export function Topbar() {
  return (
    <header className="border-foreground/10 bg-background/55 supports-[backdrop-filter]:bg-background/35 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/atlas_logo.svg"
            alt=""
            aria-hidden
            width={36}
            height={36}
            className="relative -top-[2px] h-9 w-9 transition-opacity group-hover:opacity-80"
          />
          <span className="font-display text-foreground text-[1.35rem] leading-none font-medium tracking-tight transition-opacity group-hover:opacity-80">
            Atlas
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-5">
          <span className="text-muted-foreground hidden font-mono text-[10px] tracking-[0.2em] uppercase lg:inline">
            est. homelab · vol. i
          </span>
          <SearchTrigger />
          <form
            action={async () => {
              'use server';
              const returnTo = await refererReturnPath();
              const target = returnTo
                ? `/signin?callbackUrl=${encodeURIComponent(returnTo)}`
                : '/signin';
              await signOut({ redirectTo: target });
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
