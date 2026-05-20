// Ollama-backed implementation of LLMExtractor.
//
// All structuring runs against a local Ollama instance — see
// docs/adr/0006-ollama-only-llm-extraction.md. No cloud LLM calls.
//
// Failure modes that all return `null` (never throw):
//   - Non-2xx HTTP from Ollama
//   - Network / fetch error
//   - Response body that isn't valid JSON, after ONE retry with a
//     stricter prompt suffix
//   - JSON that doesn't match StructuredPayload (Zod-validated)
//
// The Ollama URL is treated as trusted (same-host docker setup). We do
// NOT add a loopback guard.

import { log } from '@/lib/log';

import { buildPrompt, STRICT_RETRY_SUFFIX } from './prompts';
import { type LLMExtractor, type StructuredPayload, structuredPayloadSchema } from './types';

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface OllamaExtractorOptions {
  /** Base URL of the Ollama HTTP API, e.g. `http://localhost:11434`. */
  baseUrl: string;
  /** Model tag, e.g. `qwen2.5:7b`. */
  model: string;
  /**
   * Optional injected `fetch` implementation. Test-only seam. In
   * production we use the global fetch — undici under the hood.
   */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Ollama `/api/generate` request/response shape (the minimal subset we use)
// ---------------------------------------------------------------------------

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  /** When set to `"json"`, Ollama forces the model output to valid JSON. */
  format: 'json';
  /** We want a single, blocking response — no incremental streaming. */
  stream: false;
}

interface OllamaGenerateResponse {
  response?: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class OllamaExtractor implements LLMExtractor {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaExtractorOptions) {
    // Strip a trailing slash so we can join paths without doubling up.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async structure(text: string): Promise<StructuredPayload | null> {
    const basePrompt = buildPrompt(text);

    // First attempt: plain prompt.
    const first = await this.callOnce(basePrompt);
    if (first.kind === 'ok') {
      log.info(
        { model: this.model, attempt: 1, payloadKind: first.payload.kind },
        'extraction.ollama.ok',
      );
      return first.payload;
    }

    // Transport / HTTP failure: no point retrying — return null.
    if (first.kind === 'transport') {
      log.warn({ model: this.model, reason: first.reason }, 'extraction.ollama.transport_failed');
      return null;
    }

    // JSON / schema failure: ONE retry with a stricter suffix.
    const strictPrompt = basePrompt + STRICT_RETRY_SUFFIX;
    const second = await this.callOnce(strictPrompt);
    if (second.kind === 'ok') {
      log.info(
        { model: this.model, attempt: 2, payloadKind: second.payload.kind },
        'extraction.ollama.ok_after_retry',
      );
      return second.payload;
    }

    log.warn(
      { model: this.model, reason: `retry-${second.reason}` },
      'extraction.ollama.invalid_json',
    );
    return null;
  }

  // -------------------------------------------------------------------------
  // Single round-trip to Ollama. Returns a tagged result so the caller can
  // tell transport failures (don't retry) from JSON failures (do retry).
  // -------------------------------------------------------------------------
  private async callOnce(prompt: string): Promise<CallResult> {
    const url = `${this.baseUrl}/api/generate`;
    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      format: 'json',
      stream: false,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return { kind: 'transport', reason: 'network-error' };
    }

    if (!res.ok) {
      return { kind: 'transport', reason: `http-${res.status}` };
    }

    let envelope: OllamaGenerateResponse;
    try {
      envelope = (await res.json()) as OllamaGenerateResponse;
    } catch {
      return { kind: 'invalid-envelope', reason: 'envelope-not-json' };
    }

    if (typeof envelope.response !== 'string') {
      return { kind: 'invalid-envelope', reason: 'missing-response-field' };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(envelope.response);
    } catch {
      return { kind: 'invalid-payload', reason: 'response-not-json' };
    }

    const parsed = structuredPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: 'invalid-payload', reason: 'schema-mismatch' };
    }

    return { kind: 'ok', payload: parsed.data };
  }
}

// Tagged internal result. Lets `structure()` distinguish "this is
// retryable" (the model produced something that didn't match) from
// "this is not retryable" (Ollama is unreachable or returned 500).
type CallResult =
  | { kind: 'ok'; payload: StructuredPayload }
  | { kind: 'transport'; reason: string }
  | { kind: 'invalid-envelope'; reason: string }
  | { kind: 'invalid-payload'; reason: string };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an OllamaExtractor from environment variables. The constructor
 * itself is pure — only this factory reads `process.env`, so tests can
 * construct the extractor with explicit options.
 *
 * Required env:
 *   - OLLAMA_URL   — base URL (e.g. http://localhost:11434)
 *   - OLLAMA_MODEL — model tag (e.g. qwen2.5:7b)
 */
export function createOllamaExtractor(): OllamaExtractor {
  const baseUrl = process.env.OLLAMA_URL;
  const model = process.env.OLLAMA_MODEL;

  if (!baseUrl) throw new Error('OLLAMA_URL is not set');
  if (!model) throw new Error('OLLAMA_MODEL is not set');

  return new OllamaExtractor({ baseUrl, model });
}
