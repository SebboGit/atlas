// ntfy-backed Notifier (ADR-0020).
//
// Publishes with ntfy's JSON form (POST to the server root, topic in the
// body) rather than the header form, because titles carry UTF-8 — station
// names, "→" — that HTTP headers can't hold without RFC 2047 encoding.
//
// Operating contract, shared with the other outbound clients:
// - Never throws. Network, HTTP and timeout failures come back as a
//   `NotifyResult` for the job to log and retry.
// - Never logs the message, the topic or the token — status codes only.
// - No attachments. Links travel in `click`, which also works on servers
//   that have attachments switched off.

import type { NotificationMessage, Notifier, NotifyResult } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// Comfortably inside ntfy's message limit (4 KiB by default) and short
// enough to read on a lock screen. Titles are clipped harder: a long
// one wraps or truncates on most launchers anyway.
export const MAX_TITLE_CHARS = 80;
export const MAX_BODY_CHARS = 300;
export const MAX_TAGS = 3;

export interface NtfyNotifierOptions {
  /** Server base URL, e.g. https://ntfy.example.com. No trailing path. */
  baseUrl: string;
  /** Access token for a publisher with write access to the topic. Optional on open servers. */
  token?: string;
  requestTimeoutMs?: number;
  /** Test seam — production uses global fetch. */
  fetchImpl?: typeof fetch;
}

export class NtfyNotifier implements Notifier {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(opts: NtfyNotifierOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#token = opts.token?.trim() || undefined;
    this.#timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async notify(message: NotificationMessage): Promise<NotifyResult> {
    const payload: Record<string, unknown> = {
      topic: message.topic,
      title: clip(message.title, MAX_TITLE_CHARS),
      message: clip(message.body, MAX_BODY_CHARS),
    };
    if (message.priority !== undefined) payload.priority = message.priority;
    if (message.tags && message.tags.length > 0) payload.tags = message.tags.slice(0, MAX_TAGS);
    if (message.click) payload.click = message.click;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;

    try {
      const res = await this.#fetch(`${this.#baseUrl}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) return { ok: false, reason: 'rejected', status: res.status };
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.#fetch(`${this.#baseUrl}/v1/health`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  // Spread by code point so a clip never splits a surrogate pair.
  const chars = [...trimmed];
  return chars.length <= max ? trimmed : `${chars.slice(0, max - 1).join('')}…`;
}
