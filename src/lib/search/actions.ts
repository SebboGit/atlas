'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';

import { searchAll } from './repo';
import type { SearchResults } from './types';

const EMPTY: SearchResults = { trips: [], segments: [], documents: [], wishlist: [] };

const querySchema = z.string().trim().min(1).max(200).catch('');

// Scoped to the viewer (ADR-0015): trips and their segments are returned
// when they're household-shared or the viewer created them — never
// another member's private trip. Documents stay uploader-scoped, so a
// viewer only finds their own. Wishlist is fully household-shared.
export async function searchAtlas(q: string): Promise<SearchResults> {
  const user = await requireUser();
  const parsed = querySchema.safeParse(q);
  if (!parsed.success || parsed.data.length === 0) return EMPTY;
  return searchAll(parsed.data, user.id);
}
