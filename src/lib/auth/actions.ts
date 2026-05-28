'use server';

import { headers } from 'next/headers';

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

// Sign-out action — usable from both server and client components as a
// `<form action={signOutAction}>` target. Server-only logic (header
// inspection, Auth.js signOut) runs in the action; the form rendering
// the button can live anywhere.
export async function signOutAction(): Promise<void> {
  const returnTo = await refererReturnPath();
  const target = returnTo ? `/signin?callbackUrl=${encodeURIComponent(returnTo)}` : '/signin';
  await signOut({ redirectTo: target });
}
