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
      {/* Wordmark — the coral mark beside the lowercase name, as in the
       *  topbar. */}
      <div
        className="atlas-rise mb-2 flex items-center justify-center gap-3"
        style={{ animationDelay: '40ms' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/atlas_logo.svg"
          alt=""
          aria-hidden
          width={56}
          height={56}
          className="h-14 w-14"
        />
        <h1 className="font-display text-foreground text-6xl leading-none tracking-tight">atlas</h1>
      </div>

      <Card
        variant="glass"
        className="atlas-rise relative mt-10 w-full overflow-hidden rounded-[1.75rem]"
        style={{ animationDelay: '180ms' }}
      >
        <CardContent className="flex flex-col gap-6 px-7 pt-8 pb-8">
          <div className="text-center">
            <h2 className="font-display text-foreground text-3xl leading-none tracking-tight">
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
            <p className="text-muted-foreground border-border border-t pt-4 text-center text-sm">
              Couldn&apos;t sign in. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
