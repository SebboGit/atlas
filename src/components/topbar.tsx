'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { SearchTrigger } from '@/components/search/search-trigger';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

interface NavRoute {
  href: string;
  label: string;
}

// Primary nav surface. Order mirrors the homepage section numerals so
// users build a single mental map of "where things live" across the
// home tiles, the topbar, and (on phone) the hamburger sheet.
const ROUTES: readonly NavRoute[] = [
  { href: '/trips', label: 'Trips' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/map', label: 'Map' },
  { href: '/stats', label: 'Stats' },
];

function isActiveRoute(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Topbar() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <header className="border-foreground/10 bg-background/55 supports-[backdrop-filter]:bg-background/35 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5 sm:gap-5 sm:px-8">
        {/* Hamburger — phone only. Sits left of the logo so the
         *  thumb-zone affordance for nav lives on the side opposite the
         *  search icon. */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              className="size-11 shrink-0 sm:hidden"
            >
              <Menu className="size-5" strokeWidth={1.75} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetTitle className="mb-1">Atlas</SheetTitle>
            <SheetDescription className="mb-6">Self-hosted travel log.</SheetDescription>
            <nav aria-label="Mobile main" className="flex flex-col gap-1">
              {ROUTES.map((route) => {
                const active = isActiveRoute(pathname, route.href);
                return (
                  <SheetClose asChild key={route.href}>
                    <Link
                      href={route.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center rounded-lg px-3 text-base transition-colors',
                        active
                          ? 'bg-foreground/8 text-foreground'
                          : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground',
                      )}
                    >
                      {route.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>
            <div className="border-foreground/10 mt-auto border-t pt-4">
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
                  Sign out
                </Button>
              </form>
            </div>
          </SheetContent>
        </Sheet>

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

        {/* Laptop inline nav — hidden below sm:, where the hamburger
         *  carries the same routes. */}
        <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 sm:flex">
          {ROUTES.map((route) => {
            const active = isActiveRoute(pathname, route.href);
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:ml-0 sm:gap-5">
          <span className="text-muted-foreground hidden font-mono text-[10px] tracking-[0.2em] uppercase lg:inline">
            est. homelab · vol. i
          </span>
          <SearchTrigger />
          {/* Laptop sign-out — inline in the topbar. Phone users reach
           *  sign-out via the hamburger sheet above. */}
          <form action={signOutAction} className="hidden sm:block">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
