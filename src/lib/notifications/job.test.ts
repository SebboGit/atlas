import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(name: string, data: unknown, opts?: unknown) => Promise<void>>(),
  getNotificationSettings: vi.fn(),
  notify: vi.fn(),
  deploymentTopic: vi.fn<() => string | null>(),
}));

vi.mock('@/lib/jobs', () => ({
  getJobs: () => ({ send: mocks.send }),
}));

vi.mock('./repo', () => ({
  getNotificationSettings: mocks.getNotificationSettings,
}));

vi.mock('./index', () => ({
  getNotifier: () => ({ notify: mocks.notify, healthy: vi.fn() }),
  deploymentTopic: mocks.deploymentTopic,
}));

import {
  enqueueNotification,
  NOTIFY_JOB,
  NotifyRetryableError,
  runNotifyJob,
  type NotifyJobData,
} from './job';

const job: NotifyJobData = {
  userId: 'u1',
  category: 'extraction',
  title: 'Document read',
  body: 'Tokyo & Kyoto · 1 segment added',
  tags: ['page_facing_up'],
  path: '/trips/t1/documents',
};

const enabledSettings = { enabled: true, topic: null, prefs: { extraction: true } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_URL', 'https://atlas.example.test');
  mocks.deploymentTopic.mockReturnValue('shared');
  mocks.getNotificationSettings.mockResolvedValue(enabledSettings);
  mocks.notify.mockResolvedValue({ ok: true });
  mocks.send.mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runNotifyJob', () => {
  it('sends to the deployment topic with an absolute click link', async () => {
    await runNotifyJob(job);
    expect(mocks.notify).toHaveBeenCalledWith({
      topic: 'shared',
      title: 'Document read',
      body: 'Tokyo & Kyoto · 1 segment added',
      tags: ['page_facing_up'],
      priority: undefined,
      click: 'https://atlas.example.test/trips/t1/documents',
    });
  });

  it("uses the user's own topic over the default", async () => {
    mocks.getNotificationSettings.mockResolvedValue({ ...enabledSettings, topic: 'mine' });
    await runNotifyJob(job);
    expect(mocks.notify.mock.calls[0]![0].topic).toBe('mine');
  });

  it('withholds a private trip name on the shared default topic', async () => {
    await runNotifyJob({
      ...job,
      body: 'Surprise · 1 segment added',
      sharedTopicBody: '1 segment added',
    });
    expect(mocks.notify.mock.calls[0]![0].body).toBe('1 segment added');
  });

  it("keeps the trip name on the user's own topic", async () => {
    mocks.getNotificationSettings.mockResolvedValue({ ...enabledSettings, topic: 'mine' });
    await runNotifyJob({
      ...job,
      body: 'Surprise · 1 segment added',
      sharedTopicBody: '1 segment added',
    });
    expect(mocks.notify.mock.calls[0]![0].body).toBe('Surprise · 1 segment added');
  });

  it('omits the click link when AUTH_URL is unset', async () => {
    vi.stubEnv('AUTH_URL', '');
    await runNotifyJob(job);
    expect(mocks.notify.mock.calls[0]![0].click).toBeUndefined();
  });

  it('skips a user who has notifications off', async () => {
    mocks.getNotificationSettings.mockResolvedValue({ ...enabledSettings, enabled: false });
    await runNotifyJob(job);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('skips a category the user switched off', async () => {
    mocks.getNotificationSettings.mockResolvedValue({
      ...enabledSettings,
      prefs: { extraction: false },
    });
    await runNotifyJob(job);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('sends a test even while notifications are off', async () => {
    mocks.getNotificationSettings.mockResolvedValue({ ...enabledSettings, enabled: false });
    await runNotifyJob({ ...job, category: 'test' });
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it('skips when there is no topic anywhere', async () => {
    mocks.deploymentTopic.mockReturnValue(null);
    await runNotifyJob(job);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('skips a user who no longer exists', async () => {
    mocks.getNotificationSettings.mockResolvedValue(null);
    await runNotifyJob(job);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not retry a setup error the server will keep refusing', async () => {
    mocks.notify.mockResolvedValue({ ok: false, reason: 'rejected', status: 403 });
    await expect(runNotifyJob(job)).resolves.toBeUndefined();
  });

  it('hands an unreachable server back to pg-boss for a retry', async () => {
    mocks.notify.mockResolvedValue({ ok: false, reason: 'unreachable' });
    await expect(runNotifyJob(job)).rejects.toBeInstanceOf(NotifyRetryableError);
  });

  it.each([429, 503])('retries a %i', async (status) => {
    mocks.notify.mockResolvedValue({ ok: false, reason: 'rejected', status });
    await expect(runNotifyJob(job)).rejects.toBeInstanceOf(NotifyRetryableError);
  });

  it('does nothing when no server is configured', async () => {
    mocks.notify.mockResolvedValue({ ok: false, reason: 'unconfigured' });
    await expect(runNotifyJob(job)).resolves.toBeUndefined();
  });
});

describe('enqueueNotification', () => {
  it('queues the notify job', async () => {
    await expect(enqueueNotification(job)).resolves.toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(NOTIFY_JOB, job, undefined);
  });

  it('swallows a queueing failure', async () => {
    mocks.send.mockRejectedValue(new Error('connection refused'));
    await expect(enqueueNotification(job)).resolves.toBe(false);
  });
});
