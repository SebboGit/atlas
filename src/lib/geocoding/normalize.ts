// Query normalisation for the geocode cache. The same logical place
// should produce the same cache key regardless of how a user typed it,
// so we lowercase, trim, and collapse internal whitespace before
// hashing. The cache PK is the *normalized* string; callers MUST
// route every query through here.
//
// Deliberately conservative — we don't strip punctuation, accents, or
// stop-words. A user who typed "Bali, Indonesia" and one who typed
// "Bali Indonesia" will produce two cache rows; that's fine for a
// personal app, and over-eager normalisation risks collapsing
// distinct addresses ("123 Main St" vs "123 Main St #4B").

export function normalizeQuery(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, ' ');
}
