'use client';

import {
  ChartColumn,
  Luggage,
  Map as MapIcon,
  Menu,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { SearchTrigger } from '@/components/search/search-trigger';
import { ThemeToggle } from '@/components/theme-toggle';
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
  // Shown on the phone hamburger sheet (the laptop inline nav stays
  // text-only — icons would fight the search/sign-out chrome there).
  icon: LucideIcon;
}

// Primary nav surface. Order mirrors the homepage section numerals so
// users build a single mental map of "where things live" across the
// home tiles, the topbar, and (on phone) the hamburger sheet.
const ROUTES: readonly NavRoute[] = [
  { href: '/trips', label: 'Trips', icon: Luggage },
  { href: '/wishlist', label: 'Wishlist', icon: Sparkles },
  { href: '/map', label: 'Map', icon: MapIcon },
  { href: '/stats', label: 'Stats', icon: ChartColumn },
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
    <header className="border-border bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-40 border-b backdrop-blur-xl">
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
            <div className="mb-3 flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/atlas_logo.svg"
                alt=""
                aria-hidden
                width={28}
                height={28}
                className="h-7 w-7"
              />
              <SheetTitle>Atlas</SheetTitle>
            </div>
            <SheetDescription className="mb-5">Self-hosted travel log.</SheetDescription>
            {/* Full-bleed hairline — reads as a section break between the
             *  masthead and the route list. */}
            <div aria-hidden className="bg-border -mx-6 mb-4 h-px" />
            <nav aria-label="Mobile main" className="flex flex-col gap-1">
              {ROUTES.map((route) => {
                const active = isActiveRoute(pathname, route.href);
                const Icon = route.icon;
                return (
                  <SheetClose asChild key={route.href}>
                    <Link
                      href={route.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base transition-colors',
                        // Hover gated to pointer devices (CLAUDE.md rule 4)
                        // so it doesn't stick after a tap on this touch surface.
                        active
                          ? 'bg-foreground text-background font-semibold'
                          : 'text-foreground/80 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground',
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          'size-[18px] shrink-0',
                          active ? 'text-primary' : 'text-foreground/50',
                        )}
                        strokeWidth={1.75}
                      />
                      <span>{route.label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>
            <div className="border-border mt-auto flex flex-col gap-1 border-t pt-4">
              <SheetClose asChild>
                <Link
                  href="/settings"
                  aria-current={isActiveRoute(pathname, '/settings') ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base transition-colors',
                    isActiveRoute(pathname, '/settings')
                      ? 'bg-foreground text-background font-semibold'
                      : 'text-foreground/80 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground',
                  )}
                >
                  <Settings
                    aria-hidden
                    className={cn(
                      'size-[18px] shrink-0',
                      isActiveRoute(pathname, '/settings')
                        ? 'text-coral-ink'
                        : 'text-foreground/45',
                    )}
                    strokeWidth={1.75}
                  />
                  <span>Settings</span>
                </Link>
              </SheetClose>
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
                  Sign out
                </Button>
              </form>
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/atlas_logo.svg"
            alt=""
            aria-hidden
            width={34}
            height={34}
            className="h-[34px] w-[34px] transition-opacity group-hover:opacity-80"
          />
          <span className="font-display text-foreground text-2xl leading-none transition-opacity group-hover:opacity-80">
            atlas
          </span>
        </Link>

        {/* Laptop inline nav — a pill group; the active section is the ink
         *  pill. Hidden below sm:, where the hamburger carries the routes. */}
        <nav aria-label="Main" className="ml-2 hidden flex-1 items-center sm:flex lg:ml-4">
          <div className="bg-card border-border flex items-center gap-0.5 rounded-full border p-1">
            {ROUTES.map((route) => {
              const active = isActiveRoute(pathname, route.href);
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-[15px] font-semibold transition-colors lg:px-4',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
                  )}
                >
                  {route.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <SearchTrigger />
          <ThemeToggle />
          {/* Laptop settings — an icon beside sign-out; secondary to the
           *  section nav, so it stays out of ROUTES. Phone users reach it
           *  from the hamburger sheet. */}
          {/* `size-11`: shown from `sm:` up, which includes touch tablets,
           *  so it keeps the 44px target; `[&_svg]` beats the button's own
           *  16px icon rule. */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="hidden size-11 sm:inline-flex [&_svg]:size-[18px]"
          >
            <Link
              href="/settings"
              aria-label="Settings"
              aria-current={isActiveRoute(pathname, '/settings') ? 'page' : undefined}
            >
              <Settings strokeWidth={1.75} />
            </Link>
          </Button>
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
