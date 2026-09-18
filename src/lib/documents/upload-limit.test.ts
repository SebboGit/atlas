import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_STORAGE = process.env.STORAGE_MAX_BYTES;
const ORIGINAL_BAKED = process.env.ATLAS_UPLOAD_ENVELOPE_BYTES;

const MB = 1024 * 1024;

/** The module under test, freshly loaded so its "warn once" latch is clean. */
async function load() {
  return import('./upload-limit');
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('getUploadMaxBytes', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset first, then spy: `load()` must resolve the same module instances
    // the spy was installed on, and the latches are module state.
    vi.resetModules();
    delete process.env.STORAGE_MAX_BYTES;
    delete process.env.ATLAS_UPLOAD_ENVELOPE_BYTES;
    const { log } = await import('@/lib/log');
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restore('STORAGE_MAX_BYTES', ORIGINAL_STORAGE);
    restore('ATLAS_UPLOAD_ENVELOPE_BYTES', ORIGINAL_BAKED);
    vi.restoreAllMocks();
  });

  it('defaults to 20 MB when nothing is set', async () => {
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(20 * MB);
  });

  it('returns the runtime limit when it fits inside the baked envelope', async () => {
    process.env.STORAGE_MAX_BYTES = String(8 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(8 * MB);
  });

  it('clamps a runtime limit that exceeds the baked envelope', async () => {
    process.env.STORAGE_MAX_BYTES = String(50 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(20 * MB);
  });

  it('clamps to a baked envelope below the default when the runtime limit is unset', async () => {
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(5 * MB);
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(5 * MB);
  });

  it('warns about the clamp exactly once', async () => {
    process.env.STORAGE_MAX_BYTES = String(50 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytes } = await load();

    getUploadMaxBytes();
    getUploadMaxBytes();
    getUploadMaxBytes();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn when the runtime limit is within the envelope', async () => {
    process.env.STORAGE_MAX_BYTES = String(20 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytes } = await load();

    expect(getUploadMaxBytes()).toBe(20 * MB);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores an unusable baked value and keeps the runtime limit', async () => {
    process.env.STORAGE_MAX_BYTES = String(30 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = 'not-a-number';
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(30 * MB);
  });

  it('ignores a fractional baked value and keeps the runtime limit', async () => {
    process.env.STORAGE_MAX_BYTES = String(30 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = '20.5';
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(30 * MB);
  });

  it('accepts a baked value in exponent notation', async () => {
    process.env.STORAGE_MAX_BYTES = String(30 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = '2e7';
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(20_000_000);
  });

  it('treats an empty baked value (unset build arg) as absent', async () => {
    process.env.STORAGE_MAX_BYTES = String(30 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = '';
    const { getUploadMaxBytes } = await load();
    expect(getUploadMaxBytes()).toBe(30 * MB);
  });

  it('throws on an unusable runtime limit rather than advertising a default', async () => {
    process.env.STORAGE_MAX_BYTES = 'plenty';
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytes } = await load();
    expect(() => getUploadMaxBytes()).toThrow(/STORAGE_MAX_BYTES must be a positive integer/);
  });

  it('treats a blank runtime limit as unset, and says so once', async () => {
    process.env.STORAGE_MAX_BYTES = '  ';
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(50 * MB);
    const { getUploadMaxBytes } = await load();

    expect(getUploadMaxBytes()).toBe(20 * MB);
    getUploadMaxBytes();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('getUploadMaxBytesOrFallback', () => {
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.STORAGE_MAX_BYTES;
    delete process.env.ATLAS_UPLOAD_ENVELOPE_BYTES;
    const { log } = await import('@/lib/log');
    error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restore('STORAGE_MAX_BYTES', ORIGINAL_STORAGE);
    restore('ATLAS_UPLOAD_ENVELOPE_BYTES', ORIGINAL_BAKED);
    vi.restoreAllMocks();
  });

  it('passes the resolved ceiling through when the config is sound', async () => {
    process.env.STORAGE_MAX_BYTES = String(8 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytesOrFallback } = await load();

    expect(getUploadMaxBytesOrFallback()).toBe(8 * MB);
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back to the baked envelope and logs when the runtime limit is unusable', async () => {
    process.env.STORAGE_MAX_BYTES = 'plenty';
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(50 * MB);
    const { getUploadMaxBytesOrFallback } = await load();

    expect(getUploadMaxBytesOrFallback()).toBe(50 * MB);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default when the baked envelope is unusable too', async () => {
    process.env.STORAGE_MAX_BYTES = 'plenty';
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = 'also-nonsense';
    const { getUploadMaxBytesOrFallback } = await load();

    expect(getUploadMaxBytesOrFallback()).toBe(20 * MB);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('still clamps — the fallback is only for the throwing path', async () => {
    process.env.STORAGE_MAX_BYTES = String(50 * MB);
    process.env.ATLAS_UPLOAD_ENVELOPE_BYTES = String(20 * MB);
    const { getUploadMaxBytesOrFallback } = await load();

    expect(getUploadMaxBytesOrFallback()).toBe(20 * MB);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
