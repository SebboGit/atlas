import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueNotification: vi.fn(),
  tripForNotification: vi.fn(),
  configured: vi.fn<() => boolean>(),
}));

vi.mock('./job', () => ({ enqueueNotification: mocks.enqueueNotification }));
vi.mock('./repo', () => ({ tripForNotification: mocks.tripForNotification }));
vi.mock('./index', () => ({ notificationsConfigured: mocks.configured }));

import { notifyExtractionFinished } from './extraction';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueNotification.mockResolvedValue('queued');
  mocks.tripForNotification.mockResolvedValue({ title: 'Tokyo & Kyoto', isPrivate: false });
  mocks.configured.mockReturnValue(true);
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
    mocks.tripForNotification.mockRejectedValue(new Error('db down'));
    await expect(
      notifyExtractionFinished({ userId: 'u1', tripId: 't1', result: { ok: false } }),
    ).resolves.toBeUndefined();
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });

  it('stays quiet when a re-extract superseded this run', async () => {
    await notifyExtractionFinished({
      userId: 'u1',
      tripId: 't1',
      result: {
        ok: true,
        outcome: { kind: 'linked', items: [{ kind: 'superseded', segmentId: 's1' }] },
      },
    });
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });

  it('does nothing without a configured server', async () => {
    mocks.configured.mockReturnValue(false);
    await notifyExtractionFinished({ userId: 'u1', tripId: 't1', result: { ok: false } });
    expect(mocks.tripForNotification).not.toHaveBeenCalled();
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });
});
