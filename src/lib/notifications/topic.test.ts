import { describe, expect, it } from 'vitest';

import { isValidTopic, resolveTopic } from './topic';

describe('isValidTopic', () => {
  it.each(['trips', 'my-trips_2', 'a'.repeat(64)])('accepts %s', (topic) => {
    expect(isValidTopic(topic)).toBe(true);
  });

  it.each(['', 'has space', 'slash/topic', 'ümlaut', 'a'.repeat(65)])('rejects %j', (topic) => {
    expect(isValidTopic(topic)).toBe(false);
  });
});

describe('resolveTopic', () => {
  it("prefers the user's own topic", () => {
    expect(resolveTopic('mine', 'shared')).toBe('mine');
  });

  it('falls back to the deployment default', () => {
    expect(resolveTopic(null, 'shared')).toBe('shared');
    expect(resolveTopic('  ', 'shared')).toBe('shared');
  });

  it('is null when neither is set', () => {
    expect(resolveTopic(null, null)).toBeNull();
    expect(resolveTopic(undefined, '')).toBeNull();
  });
});
