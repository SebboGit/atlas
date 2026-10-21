import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueNotification: vi.fn(),
  tripTitleForUser: vi.fn(),
}));

vi.mock('./job', () => ({ enqueueNotification: mocks.enqueueNotification }));
vi.mock('./repo', () => ({ tripTitleForUser: mocks.tripTitleForUser }));

import { notifyExtractionFinished } from './extraction';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueNotification.mockResolvedValue(true);
  mocks.tripTitleForUser.mockResolvedValue('Tokyo & Kyoto');
});

describe('notifyExtractionFinished', () => {
  it('queues a success message for the uploader', async () => {
    await notifyExtractionFinished({
      userId: 'u1',
      tripId: 't1',
      result: { ok: true, outcome: { kind: 'already-linked', segmentIds: ['s1'] } },
    });
    expect(mocks.enqueueNotification).toHaveBeenCalledWith({
      userId: 'u1',
      category: 'extraction',
      title: 'Document read',
      body: 'Tokyo & Kyoto · already on the itinerary',
      tags: ['page_facing_up'],
      path: '/trips/t1/documents',
    });
  });

  it('queues a failure message', async () => {
    await notifyExtractionFinished({ userId: 'u1', tripId: 't1', result: { ok: false } });
    expect(mocks.enqueueNotification.mock.calls[0]![0]).toMatchObject({
      title: 'Document not read',
      category: 'extraction',
    });
  });

  it('never fails the extraction job', async () => {
    mocks.tripTitleForUser.mockRejectedValue(new Error('db down'));
    await expect(
      notifyExtractionFinished({ userId: 'u1', tripId: 't1', result: { ok: false } }),
    ).resolves.toBeUndefined();
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });
});
