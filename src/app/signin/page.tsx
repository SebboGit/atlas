import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { signIn } from '@/lib/auth/config';

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

// Reject absolute URLs and protocol-relative URLs. Auth.js also validates
// same-origin, but we never want to pass an externally-crafted URL down.
// Default to `/` (the canonical signed-in landing) rather than `/trips`
// — `/trips` is a feature, not the home surface.
function safeCallback(raw: string | undefined): string {
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  const error = params.error;

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 py-12">
      {/* Wordmark — Atlas in big Fraunces with the SOFT/optical axis
       *  doing its quiet warming. A faint paired-rule sits below. */}
      <div className="atlas-rise mb-2 text-center" style={{ animationDelay: '40ms' }}>
        <h1 className="font-display text-foreground text-7xl leading-none font-medium tracking-tight">
          Atlas
        </h1>
        <p className="text-muted-foreground mt-6 flex items-center justify-center gap-3 font-mono text-[10px] tracking-[0.32em] uppercase">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Self-hosted · Vol. I</span>
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
        </p>
      </div>

      <Card
        variant="glass"
        className="atlas-rise relative mt-12 w-full overflow-hidden"
        style={{ animationDelay: '180ms' }}
      >
        {/* Brand mark, top-center */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/atlas_logo.svg"
          alt=""
          aria-hidden
          width={56}
          height={56}
          className="absolute top-5 left-1/2 h-14 w-14 -translate-x-1/2"
        />
        {/* Section index, top-right — matches Welcome page */}
        <span
          aria-hidden
          className="border-foreground/25 text-foreground/55 absolute top-5 right-5 inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[10px]"
        >
          00
        </span>

        <CardContent className="flex flex-col gap-6 px-7 pt-20 pb-8">
          <div className="text-center">
            <p className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
              Entry
            </p>
            <h2 className="font-display text-foreground mt-2 text-3xl leading-none font-medium tracking-tight">
              Sign in
            </h2>
          </div>

          <form
            action={async () => {
              'use server';
              await signIn('pocket-id', { redirectTo: callbackUrl });
            }}
          >
            <Button type="submit" size="lg" className="w-full">
              Continue with passkey
            </Button>
          </form>

          {error ? (
            <p className="text-muted-foreground border-foreground/15 border-t pt-4 text-center text-sm">
              Couldn&apos;t sign in. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
