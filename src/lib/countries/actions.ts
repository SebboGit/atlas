'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { err, ok, type Result } from '@/types/result';

import { ISO_COUNTRIES } from './data';
import * as repo from './repo';

// Reuse the same FormError shape as segments/trips actions so any
// future form wiring can use the existing RHF adapter without
// translation.
export type FormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

// ISO 3166-1 alpha-2 — 2 uppercase letters, restricted to the
// reference table the rest of Atlas already uses (seeded from
// ISO_COUNTRIES). Anything else is rejected before hitting the FK,
// so the user gets a useful error instead of a Postgres constraint
// violation.
const KNOWN_CODES = new Set(ISO_COUNTRIES.map((c) => c.code));

const countryCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Must be a 2-letter ISO country code.'))
  .refine((code) => KNOWN_CODES.has(code), 'Unknown country code.');

function flatten(error: z.ZodError): FormError {
  const message = error.issues[0]?.message ?? 'Invalid input.';
  return { formMessage: message };
}

export async function addManualCountryAction(
  rawCode: unknown,
): Promise<Result<{ code: string }, FormError>> {
  const user = await requireUser();
  const parsed = countryCodeInput.safeParse(rawCode);
  if (!parsed.success) return err(flatten(parsed.error));

  try {
    await repo.addManualVisitedCountry(user.id, parsed.data);
  } catch {
    return err({ formMessage: 'Could not add country. Please try again.' });
  }
  revalidatePath('/map');
  return ok({ code: parsed.data });
}

export async function removeManualCountryAction(
  rawCode: unknown,
): Promise<Result<{ code: string }, FormError>> {
  const user = await requireUser();
  const parsed = countryCodeInput.safeParse(rawCode);
  if (!parsed.success) return err(flatten(parsed.error));

  try {
    await repo.removeManualVisitedCountry(user.id, parsed.data);
  } catch {
    return err({ formMessage: 'Could not remove country. Please try again.' });
  }
  revalidatePath('/map');
  return ok({ code: parsed.data });
}
