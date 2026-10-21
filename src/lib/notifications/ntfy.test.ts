import { describe, expect, it, vi } from 'vitest';

import { MAX_TAGS, MAX_TITLE_CHARS, NtfyNotifier } from './ntfy';

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

const message = {
  topic: 'trips',
  title: 'Train in 2h',
  body: 'Guangzhoudong → West Kowloon',
};

describe('NtfyNotifier.notify', () => {
  it('publishes JSON to the server root with a bearer token', async () => {
    const fetchImpl = fakeFetch(new Response('{}', { status: 200 }));
    const notifier = new NtfyNotifier({
      baseUrl: 'https://ntfy.example.test/',
      token: 'tk_secret',
      fetchImpl,
    });

    const result = await notifier.notify({
      ...message,
      tags: ['train'],
      priority: 4,
      click: 'https://atlas.example.test/trips/t1',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://ntfy.example.test/');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tk_secret');
    expect(JSON.parse(init?.body as string)).toEqual({
      topic: 'trips',
      title: 'Train in 2h',
      message: 'Guangzhoudong → West Kowloon',
      tags: ['train'],
      priority: 4,
      click: 'https://atlas.example.test/trips/t1',
    });
  });

  it('sends no Authorization header without a token', async () => {
    const fetchImpl = fakeFetch(new Response('{}', { status: 200 }));
    await new NtfyNotifier({ baseUrl: 'https://ntfy.example.test', fetchImpl }).notify(message);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('clips long titles and caps tags', async () => {
    const fetchImpl = fakeFetch(new Response('{}', { status: 200 }));
    await new NtfyNotifier({ baseUrl: 'https://ntfy.example.test', fetchImpl }).notify({
      ...message,
      title: 'x'.repeat(200),
      tags: ['a', 'b', 'c', 'd', 'e'],
    });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string);
    expect([...body.title]).toHaveLength(MAX_TITLE_CHARS);
    expect(body.title.endsWith('…')).toBe(true);
    expect(body.tags).toHaveLength(MAX_TAGS);
  });

  it('reports an error status as rejected', async () => {
    const fetchImpl = fakeFetch(new Response('forbidden', { status: 403 }));
    const result = await new NtfyNotifier({
      baseUrl: 'https://ntfy.example.test',
      fetchImpl,
    }).notify(message);
    expect(result).toEqual({ ok: false, reason: 'rejected', status: 403 });
  });

  it('reports a network failure as unreachable instead of throwing', async () => {
    const fetchImpl = fakeFetch(new TypeError('fetch failed'));
    const result = await new NtfyNotifier({
      baseUrl: 'https://ntfy.example.test',
      fetchImpl,
    }).notify(message);
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('NtfyNotifier.healthy', () => {
  it('is true on a 200 from /v1/health', async () => {
    const fetchImpl = fakeFetch(new Response('{"healthy":true}', { status: 200 }));
    const notifier = new NtfyNotifier({ baseUrl: 'https://ntfy.example.test', fetchImpl });
    expect(await notifier.healthy()).toBe(true);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://ntfy.example.test/v1/health');
  });

  it('is false when the server cannot be reached', async () => {
    const fetchImpl = fakeFetch(new TypeError('getaddrinfo ENOTFOUND'));
    const notifier = new NtfyNotifier({ baseUrl: 'https://ntfy.example.test', fetchImpl });
    expect(await notifier.healthy()).toBe(false);
  });
});
