import { describe, expect, it } from 'vitest';

import { normalizeQuery } from './normalize';

describe('normalizeQuery', () => {
  it('lowercases', () => {
    expect(normalizeQuery('Bali, Indonesia')).toBe('bali, indonesia');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeQuery('   Hotel California  ')).toBe('hotel california');
  });

  it('collapses internal whitespace runs into single spaces', () => {
    expect(normalizeQuery('123  Main\tSt')).toBe('123 main st');
    expect(normalizeQuery('a\n\nb')).toBe('a b');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   \t\n')).toBe('');
  });

  it('does NOT strip punctuation — distinct addresses stay distinct', () => {
    // Different keys on purpose: 123 Main St and 123 Main St #4B should
    // not collide. Punctuation-aware normalisation would over-merge.
    expect(normalizeQuery('123 Main St')).not.toBe(normalizeQuery('123 Main St #4B'));
  });

  it('does NOT strip accents — keeps human-typed spelling distinct', () => {
    // We don't unicode-normalize. Two users typing the same place
    // with/without accents produce two cache rows; acceptable for now.
    expect(normalizeQuery('Café Example')).toBe('café example');
  });
});
