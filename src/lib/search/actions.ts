'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';

import { searchAll } from './repo';
import type { SearchResults } from './types';

const EMPTY: SearchResults = { trips: [], segments: [], documents: [], wishlist: [] };

const querySchema = z.string().trim().min(1).max(200).catch('');

// Household-shared: requireUser() gates the call so unauthenticated
// requests bounce, but results are NOT filtered by userId. See
// household-visibility-doc.
export async function searchAtlas(q: string): Promise<SearchResults> {
  await requireUser();
  const parsed = querySchema.safeParse(q);
  if (!parsed.success || parsed.data.length === 0) return EMPTY;
  return searchAll(parsed.data);
}
