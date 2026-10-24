import { z } from 'zod';

// Row ids are Postgres `uuid` columns, so an id taken from a URL has to be
// checked before it reaches a query: a malformed one makes the driver throw
// 22P02 (invalid_text_representation) instead of matching no row, and a
// typo'd link lands on the error boundary rather than the not-found page.
//
// Zod's uuid pins the version and variant nibbles and rejects the braced and
// unhyphenated forms Postgres would also accept. That is fine: every id Atlas
// mints comes from `uuidv7()` (uuidv7Pk in db/schema/_helpers), so no id that
// can match a row is turned away.
export const uuidParam = z.string().uuid();

/** Whether a path or query value is a well-formed row id. */
export function isUuid(value: string): boolean {
  return uuidParam.safeParse(value).success;
}
