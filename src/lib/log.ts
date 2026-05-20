import pino, { type LoggerOptions } from 'pino';

// Structured JSON logs everywhere. In dev, pretty-print if LOG_PRETTY=1.
// The redaction list MUST stay aligned with CLAUDE.md → Security &
// Privacy: never log document contents, PNRs, passport numbers, or auth
// tokens. If you add a sensitive field elsewhere in the codebase, add a
// matching path here in the same PR.

const REDACT_PATHS = [
  // ---- Request / response headers ----
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',

  // ---- Auth payloads / OIDC ----
  '*.password',
  '*.passwordHash',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.session_state',
  '*.client_secret',
  '*.code',
  '*.code_verifier',
  '*.state',

  // ---- Travel-specific PII ----
  '*.pnr',
  '*.passportNumber',
  '*.passport_number',
  '*.passportMrz',
  '*.passport_mrz',
  '*.boardingPass',
  '*.dateOfBirth',
  '*.date_of_birth',
  '*.dob',
  // Per-flight identifiers reveal travel patterns (route + when).
  // Blocked here so extraction logs, segment forms, and trip
  // summaries don't accidentally narrate "user X is on BA287 LHR→SFO
  // on 2026-06-01" into a log aggregator. Both top-level and nested
  // forms — pino's `*.foo` matches nested objects only, and our
  // extraction log calls put these at the merging-object root level.
  'flightNumber',
  'flight_number',
  'carrier',
  'carrierIata',
  'carrier_iata',
  'carrierIcao',
  'carrier_icao',
  '*.flightNumber',
  '*.flight_number',
  '*.carrier',
  '*.carrierIata',
  '*.carrier_iata',
  '*.carrierIcao',
  '*.carrier_icao',

  // ---- Document contents (extraction pipeline outputs) ----
  // These are the fields the extraction pipeline will produce. Block
  // them now so the first extraction PR doesn't silently spray
  // boarding-pass contents into the logs.
  '*.parsed',
  '*.parsedText',
  '*.parsed_text',
  '*.ocrText',
  '*.ocr_text',
  '*.rawText',
  '*.raw_text',
  '*.documentBody',
  '*.document_body',

  // ---- Payment hints (in case the cost-tracking feature lands and
  // somebody logs a price-payload that turns out to carry card data) ----
  '*.cardNumber',
  '*.card_number',
  '*.cvv',
  '*.cvc',
];

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'atlas' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  // ISO timestamps are easier to grep than epoch ms.
  timestamp: pino.stdTimeFunctions.isoTime,
};

const usePretty = process.env.LOG_PRETTY === 'true' || process.env.LOG_PRETTY === '1';

export const log = usePretty
  ? pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' },
      },
    })
  : pino(options);

export type Logger = typeof log;
