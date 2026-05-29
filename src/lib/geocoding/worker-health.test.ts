// Tests for getGeocodeWorkerStatus — the decision logic behind the
// trip-map "geocoding may be down" banner (issue #24).
//
// The pg-boss query itself (getQueueHealth) is exercised against a real
// schema in the jobs DB-integration tests; here we mock it so we can
// drive each verdict deterministically and pin the branch behaviour:
// env gate first, then queue age, then graceful degradation on error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQueueHealth: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  getJobs: () => ({ getQueueHealth: mocks.getQueueHealth }),
}));
vi.mock('@/lib/log', () => ({ log: { warn: mocks.warn } }));

import { GEOCODE_FETCH_JOB } from './lifecycle';
import { getGeocodeWorkerStatus } from './worker-health';

const ENV_KEY = 'NOMINATIM_CONTACT_EMAIL';
let savedEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = process.env[ENV_KEY];
  // Configured by default; the unconfigured cases override this.
  process.env[ENV_KEY] = 'ops@example.com';
  mocks.getQueueHealth.mockResolvedValue({ pendingCount: 0, oldestPendingAgeMs: null });
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('getGeocodeWorkerStatus', () => {
  it("returns 'unconfigured' when NOMINATIM_CONTACT_EMAIL is unset — without touching the queue", async () => {
    delete process.env[ENV_KEY];

    await expect(getGeocodeWorkerStatus()).resolves.toBe('unconfigured');
    // The env gate short-circuits — no pg-boss query when geocoding
    // definitionally can't run.
    expect(mocks.getQueueHealth).not.toHaveBeenCalled();
  });

  it("returns 'unconfigured' for a blank/whitespace contact email", async () => {
    process.env[ENV_KEY] = '   ';

    await expect(getGeocodeWorkerStatus()).resolves.toBe('unconfigured');
    expect(mocks.getQueueHealth).not.toHaveBeenCalled();
  });

  it("returns 'worker-down' when the oldest pending job is older than the stale threshold", async () => {
    mocks.getQueueHealth.mockResolvedValue({ pendingCount: 1, oldestPendingAgeMs: 61_000 });

    await expect(getGeocodeWorkerStatus()).resolves.toBe('worker-down');
    expect(mocks.getQueueHealth).toHaveBeenCalledWith(GEOCODE_FETCH_JOB);
  });

  it("returns 'ok' for a fresh pending job (sub-second race, under the threshold)", async () => {
    mocks.getQueueHealth.mockResolvedValue({ pendingCount: 1, oldestPendingAgeMs: 800 });

    await expect(getGeocodeWorkerStatus()).resolves.toBe('ok');
  });

  it("returns 'ok' when nothing is pending (worker is keeping up)", async () => {
    mocks.getQueueHealth.mockResolvedValue({ pendingCount: 0, oldestPendingAgeMs: null });

    await expect(getGeocodeWorkerStatus()).resolves.toBe('ok');
  });

  it("degrades to 'ok' and logs when the health query throws", async () => {
    mocks.getQueueHealth.mockRejectedValue(new Error('connection refused'));

    await expect(getGeocodeWorkerStatus()).resolves.toBe('ok');
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });
});
