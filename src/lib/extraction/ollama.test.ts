import { describe, expect, it, vi } from 'vitest';

import { OllamaExtractor } from './ollama';
import { STRICT_RETRY_SUFFIX } from './prompts';
import type { StructuredPayload } from './types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://ollama.test:11434';
const MODEL = 'qwen2.5:7b';

const validBoardingPass: StructuredPayload = {
  kind: 'boarding-pass',
  flights: [
    {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: '2026-06-01',
      scheduledDeparture: '2026-06-01T11:30:00Z',
      scheduledArrival: null,
      origin: 'LHR',
      destination: 'SFO',
      passengerName: 'DOE/JANE',
      confirmationCode: 'ABC123',
    },
  ],
  confidence: 0.92,
};

const validHotel: StructuredPayload = {
  kind: 'hotel-confirmation',
  hotelName: 'Hotel California',
  checkIn: '2026-06-01',
  checkOut: '2026-06-05',
  address: '1 Sunset Blvd',
  confirmationCode: 'CONF-9',
  country: 'US',
  confidence: 0.81,
};

/**
 * Builds a fake fetch that returns a queued series of responses. Each
 * call shifts one response off the queue; the queue running dry causes
 * a test failure.
 */
function queuedFetch(responses: Array<() => Response | Promise<Response>>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  const queue = [...responses];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    let parsedBody: unknown = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // leave as raw
    }
    calls.push({ url, body: parsedBody });

    const next = queue.shift();
    if (!next) {
      throw new Error('queuedFetch ran out of responses');
    }
    return next();
  };

  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Wraps a structured-payload object as Ollama would (stringified into `response`). */
function ollamaResponse(payload: unknown): Response {
  return jsonResponse({ response: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OllamaExtractor', () => {
  it('happy path: returns the structured payload as-is', async () => {
    const { fetchImpl, calls } = queuedFetch([() => ollamaResponse(validBoardingPass)]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    const result = await extractor.structure('Boarding pass text…');

    expect(result).toEqual(validBoardingPass);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/generate`);
  });

  it('retries ONCE with a stricter suffix when the first response is malformed JSON', async () => {
    const { fetchImpl, calls } = queuedFetch([
      // First call: envelope is fine, but `response` is unparseable.
      () => jsonResponse({ response: 'not-json-at-all' }),
      // Retry succeeds.
      () => ollamaResponse(validHotel),
    ]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    const result = await extractor.structure('Hotel email…');

    expect(result).toEqual(validHotel);
    expect(calls).toHaveLength(2);

    const firstPrompt = (calls[0]?.body as { prompt: string }).prompt;
    const secondPrompt = (calls[1]?.body as { prompt: string }).prompt;
    expect(firstPrompt.includes(STRICT_RETRY_SUFFIX)).toBe(false);
    expect(secondPrompt.endsWith(STRICT_RETRY_SUFFIX)).toBe(true);
  });

  it('returns null when both attempts yield invalid JSON (no second retry)', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () => jsonResponse({ response: 'still-not-json' }),
      () => jsonResponse({ response: 'still-not-json-either' }),
    ]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    const result = await extractor.structure('text');

    expect(result).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('returns null when the parsed JSON does not match the schema, after one retry', async () => {
    const { fetchImpl, calls } = queuedFetch([
      // Valid JSON, wrong shape.
      () => ollamaResponse({ kind: 'boarding-pass', confidence: 0.5 }),
      // Still wrong on retry.
      () => ollamaResponse({ kind: 'boarding-pass', confidence: 0.5 }),
    ]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    const result = await extractor.structure('text');

    expect(result).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('returns null on HTTP 500 and does NOT retry (transport failures are terminal)', async () => {
    const { fetchImpl, calls } = queuedFetch([() => jsonResponse({ error: 'boom' }, 500)]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    const result = await extractor.structure('text');

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('returns null when fetch throws (network error)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });

    const extractor = new OllamaExtractor({
      baseUrl: BASE_URL,
      model: MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Must not throw.
    await expect(extractor.structure('text')).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends a single discriminated-union prompt containing all three schemas', async () => {
    // The classifier used to be a filename heuristic that chose one of
    // three prompts. Now the LLM picks the kind from the document text
    // itself, so every prompt must offer all three options. Regression
    // here means the model loses its ability to classify.
    const { fetchImpl, calls } = queuedFetch([() => ollamaResponse(validBoardingPass)]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    await extractor.structure('text');

    const prompt = (calls[0]?.body as { prompt: string }).prompt;
    expect(prompt).toContain('"kind": "boarding-pass"');
    expect(prompt).toContain('"kind": "hotel-confirmation"');
    expect(prompt).toContain('"kind": "generic"');
    expect(prompt).toContain('IATA');
    expect(prompt).toContain('checkIn');
  });

  it('sends model name, format=json, stream=false in the request body', async () => {
    const { fetchImpl, calls } = queuedFetch([() => ollamaResponse(validBoardingPass)]);

    const extractor = new OllamaExtractor({ baseUrl: BASE_URL, model: MODEL, fetchImpl });
    await extractor.structure('text');

    const body = calls[0]?.body as { model: string; format: string; stream: boolean };
    expect(body.model).toBe(MODEL);
    expect(body.format).toBe('json');
    expect(body.stream).toBe(false);
  });

  it('strips a trailing slash on baseUrl so the request URL has exactly one /api/generate', async () => {
    const { fetchImpl, calls } = queuedFetch([() => ollamaResponse(validBoardingPass)]);

    const extractor = new OllamaExtractor({
      baseUrl: `${BASE_URL}/`,
      model: MODEL,
      fetchImpl,
    });
    await extractor.structure('text');

    expect(calls[0]?.url).toBe(`${BASE_URL}/api/generate`);
  });
});
