// MIME message (.eml) text extractor.
//
// Most travel confirmations arrive as email. Saving the .eml off
// (Mail.app: Drag-to-Finder, Gmail: Show Original → save, etc.) is the
// cleanest archival path — no print-to-PDF gymnastics, no screenshot.
// This extractor turns those .eml files into the same plain-text input
// the rest of the pipeline (PDF text, OCR) feeds the LLM.
//
// Body selection:
//   1. Prefer the multipart/alternative `text/plain` part — issuers
//      that ship one have already done the work of stripping their
//      template to readable text.
//   2. Fall back to stripping `text/html` ourselves. Marketing emails
//      are typically 50–200 KB of HTML for ~1–5 KB of useful text;
//      sending the raw HTML to the LLM would blow through MAX_INPUT_CHARS
//      on `<style>` blocks before reaching the booking details.
//
// We prepend the Subject line so the LLM gets the strongest single
// hint (e.g. "Your hotel reservation is confirmed — Hilton London")
// without paying for whatever marketing preamble the body opens with.
//
// PRIVACY NOTE: email bodies routinely carry full passenger names, PNRs,
// passport numbers, and addresses. The structured-logger redaction list
// already covers `rawText` / `ocrText` / `parsed`. Do not bypass it —
// never `log.info({ subject })` or `log.info({ text })` in this file.
// One-line events with `{ mime, bytes, reason, charsExtracted }` only.

import PostalMime from 'postal-mime';

import { log } from '@/lib/log';

import {
  type ExtractedText,
  MIN_USEFUL_CHARS,
  type TextExtractor,
  type TextExtractorInput,
} from './types';

export const EML_MIME = 'message/rfc822';

export class EmlExtractor implements TextExtractor {
  canHandle(mime: string): boolean {
    return mime === EML_MIME;
  }

  async extract(input: TextExtractorInput): Promise<ExtractedText | null> {
    const { mime, bytes } = input;

    try {
      const buf = await drainToBuffer(input.stream);

      // PostalMime accepts a Uint8Array / ArrayBuffer / Buffer / string.
      const parsed = await new PostalMime().parse(buf);

      const subject = stringOrNull(parsed.subject);
      const plain = stringOrNull(parsed.text);
      const html = stringOrNull(parsed.html);

      // Prefer the explicit text/plain part. Postal-Mime returns
      // undefined for `.text` when the message is HTML-only — fall
      // through to our own stripper in that case.
      const body = plain ?? (html ? stripHtml(html) : null);

      if (!body || body.length === 0) {
        log.info({ mime, bytes, reason: 'eml-empty' }, 'ocr.eml.empty');
        return null;
      }

      const composed = subject ? `Subject: ${subject}\n\n${body}` : body;

      if (composed.length < MIN_USEFUL_CHARS) {
        log.info(
          { mime, bytes, reason: 'eml-too-short', charsExtracted: composed.length },
          'ocr.eml.empty',
        );
        return null;
      }

      log.info(
        {
          mime,
          bytes,
          method: 'email',
          source: plain ? 'text/plain' : 'text/html',
          charsExtracted: composed.length,
        },
        'ocr.eml.ok',
      );

      return {
        text: composed,
        method: 'email',
        // Email parsing is structurally lossless when text/plain is
        // present, and the HTML→text fallback is heuristic but
        // deterministic. We don't make this lower than the text-layer
        // PDF case (1.0) — both are "the source content, parsed
        // structurally, no guessing".
        confidence: 1,
      };
    } catch (err) {
      log.warn(
        {
          mime,
          bytes,
          reason: 'eml-parse-error',
          err: err instanceof Error ? err.name : 'unknown',
        },
        'ocr.eml.failed',
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function drainToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Tags that act as block-level boundaries — replacing them with a
// newline keeps related runs of text on the same line while keeping
// distinct sections separated. Order matters: longer names first so a
// `<br>` doesn't pre-match the `<b>` rule.
const BLOCK_TAGS_RE =
  /<\/?(?:br|p|div|tr|table|thead|tbody|tfoot|h[1-6]|li|ul|ol|article|section|header|footer|nav|address)[^>]*>/gi;

// Removed entirely (tag + contents). These never carry user-facing
// content and are pure noise / size to the LLM.
const SCRIPT_STYLE_RE = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;

// Comments — Outlook-conditional and otherwise.
const COMMENT_RE = /<!--[\s\S]*?-->/g;

// Everything else: drop tags but keep the inner text.
const ANY_TAG_RE = /<[^>]+>/g;

// Common named entities we encounter in marketing / travel emails.
// Unknown names fall through as-is rather than blow up — the goal here
// is "good enough for the bodies we ingest", not full HTML5 coverage.
// If a real corpus turns up a hole, add the name here.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Dashes / punctuation
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  // Quotes
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  // Symbols
  copy: '©',
  reg: '®',
  trade: '™',
  // Arrows (every travel email's favourite separator)
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  // Currency
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
};

const NAMED_ENTITY_RE = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const NUMERIC_ENTITY_RE = /&#(\d+);/g;
const HEX_ENTITY_RE = /&#x([0-9a-fA-F]+);/g;

/**
 * Minimal HTML → plain text. We intentionally do not pull in a full
 * library: marketing-email HTML is a tiny fraction of the HTML spec
 * (no SVG, no MathML, no iframes that matter), and the 30-line version
 * here covers it. If we ever need to ingest arbitrary web pages, swap
 * to `html-to-text` and run a comparison test against the eml fixtures.
 */
export function stripHtml(html: string): string {
  return (
    html
      // 1. Kill blocks we never want to read.
      .replace(SCRIPT_STYLE_RE, ' ')
      .replace(COMMENT_RE, ' ')
      // 2. Block-level tags → newline so paragraphs/rows split cleanly.
      .replace(BLOCK_TAGS_RE, '\n')
      // 3. Drop all remaining tags.
      .replace(ANY_TAG_RE, ' ')
      // 4. Decode entities. Named entities we know about get their
      //    replacement; unknown names pass through unchanged.
      .replace(NAMED_ENTITY_RE, (m, name: string) => NAMED_ENTITIES[name] ?? m)
      .replace(NUMERIC_ENTITY_RE, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(HEX_ENTITY_RE, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
      // 5. Collapse whitespace. Keep newlines but squeeze runs of them.
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
