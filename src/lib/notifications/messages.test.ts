import { describe, expect, it } from 'vitest';

import { extractionFailedMessage, extractionSucceededMessage } from './messages';

const base = { tripId: 't1', tripTitle: 'Tokyo & Kyoto' };

describe('extractionSucceededMessage', () => {
  it('counts the legs that landed on the itinerary', () => {
    const draft = extractionSucceededMessage({
      ...base,
      outcome: {
        kind: 'linked',
        items: [
          { kind: 'linked-new', segmentId: 's1', needsReview: false },
          { kind: 'linked-existing', segmentId: 's2', dedup: true },
          { kind: 'create-failed' },
        ],
      },
    });
    expect(draft).toEqual({
      title: 'Document read',
      body: 'Tokyo & Kyoto · 2 segments added',
      tags: ['page_facing_up'],
      path: '/trips/t1/documents',
    });
  });

  it('uses the singular for one segment', () => {
    const draft = extractionSucceededMessage({
      ...base,
      outcome: {
        kind: 'linked',
        items: [{ kind: 'updated-prior', segmentId: 's1', needsReview: false }],
      },
    });
    expect(draft.body).toBe('Tokyo & Kyoto · 1 segment added');
  });

  it('says so when nothing could be added', () => {
    expect(
      extractionSucceededMessage({ ...base, outcome: { kind: 'no-segment', reason: 'generic' } })
        .body,
    ).toBe('Tokyo & Kyoto · nothing to add');
    expect(
      extractionSucceededMessage({
        ...base,
        outcome: { kind: 'already-linked', segmentIds: ['s1'] },
      }).body,
    ).toBe('Tokyo & Kyoto · already on the itinerary');
  });

  it('leaves the trip out when the recipient cannot see it', () => {
    expect(extractionSucceededMessage({ ...base, tripTitle: null, outcome: null }).body).toBe(
      'nothing to add',
    );
  });
});

describe('extractionFailedMessage', () => {
  it('names the trip and links to its documents', () => {
    expect(extractionFailedMessage(base)).toEqual({
      title: 'Document not read',
      body: 'Tokyo & Kyoto',
      tags: ['warning'],
      path: '/trips/t1/documents',
    });
  });
});
