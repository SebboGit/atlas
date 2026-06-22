import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRUNE_SCHEDULE,
  DEFAULT_STATUS_SCHEDULE,
  resolveScheduleConfig,
} from './schedule-config';

describe('resolveScheduleConfig — status sweep is always UTC', () => {
  // The regression this locks in: a Europe/Berlin CRON_TZ used to flow
  // into the status-sweep schedule, so "00:05 Berlin" fired at 22:05 the
  // prior UTC day and active→completed transitions landed a day late.
  it('pins the status sweep to UTC even when CRON_TZ is a non-UTC zone', () => {
    const cfg = resolveScheduleConfig({ CRON_TZ: 'Europe/Berlin' });
    expect(cfg.status.tz).toBe('UTC');
  });

  it('honors CRON_TZ for prune (which has no calendar-day semantics)', () => {
    const cfg = resolveScheduleConfig({ CRON_TZ: 'Europe/Berlin' });
    expect(cfg.prune.tz).toBe('Europe/Berlin');
  });

  it('defaults both timezones to UTC when CRON_TZ is unset', () => {
    const cfg = resolveScheduleConfig({});
    expect(cfg.prune.tz).toBe('UTC');
    expect(cfg.status.tz).toBe('UTC');
  });

  it('keeps the status sweep on UTC even if CRON_TZ is blank/whitespace', () => {
    const cfg = resolveScheduleConfig({ CRON_TZ: '   ' });
    expect(cfg.status.tz).toBe('UTC');
    expect(cfg.prune.tz).toBe('UTC');
  });
});

describe('resolveScheduleConfig — cron resolution', () => {
  it('uses default crons when overrides are unset', () => {
    const cfg = resolveScheduleConfig({});
    expect(cfg.prune.cron).toBe(DEFAULT_PRUNE_SCHEDULE);
    expect(cfg.status.cron).toBe(DEFAULT_STATUS_SCHEDULE);
  });

  it('respects explicit schedule overrides', () => {
    const cfg = resolveScheduleConfig({
      CRON_PRUNE_SCHEDULE: '0 4 * * *',
      CRON_STATUS_SCHEDULE: '15 1 * * *',
    });
    expect(cfg.prune.cron).toBe('0 4 * * *');
    expect(cfg.status.cron).toBe('15 1 * * *');
  });

  it('falls back to defaults on blank overrides', () => {
    const cfg = resolveScheduleConfig({
      CRON_PRUNE_SCHEDULE: '  ',
      CRON_STATUS_SCHEDULE: '',
    });
    expect(cfg.prune.cron).toBe(DEFAULT_PRUNE_SCHEDULE);
    expect(cfg.status.cron).toBe(DEFAULT_STATUS_SCHEDULE);
  });
});
