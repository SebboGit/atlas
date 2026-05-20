import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { PKPASS_MIME, PkpassExtractor } from './pkpass';

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/extraction');

function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buf)) as unknown as ReadableStream<Uint8Array>;
}

async function loadFixture(
  name: string,
): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number }> {
  const buf = await readFile(path.join(FIXTURE_DIR, name));
  return { stream: bufferToWebStream(buf), bytes: buf.byteLength };
}

describe('PkpassExtractor', () => {
  it('canHandle: true for pkpass MIME only', () => {
    const e = new PkpassExtractor();
    expect(e.canHandle(PKPASS_MIME)).toBe(true);
    expect(e.canHandle('application/pdf')).toBe(false);
    expect(e.canHandle('application/zip')).toBe(false);
    expect(e.canHandle('')).toBe(false);
  });

  it('extracts flight number, route, dates, and passenger from a boarding pkpass', async () => {
    const { stream, bytes } = await loadFixture('boarding.pkpass');
    const e = new PkpassExtractor();

    const result = await e.extract({ stream, mime: PKPASS_MIME, bytes });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.kind).toBe('boarding-pass');
    if (result.kind !== 'boarding-pass') return;

    // A single .pkpass file produces a single-leg payload. Multi-leg
    // trips arrive as separate .pkpass files (or a .pkpasses bundle,
    // which is not yet supported).
    expect(result.flights).toHaveLength(1);
    const leg = result.flights[0]!;
    expect(leg.carrier).toBe('BA');
    expect(leg.flightNumber).toBe('287');
    expect(leg.flightDate).toBe('2026-06-01');
    // The fixture's root `relevantDate` is "2026-06-01T11:30:00Z" — a
    // full ISO datetime. We surface it as scheduledDeparture so the
    // segment lands on the wall-clock minute, not just the day.
    expect(leg.scheduledDeparture).toBe('2026-06-01T11:30:00Z');
    // Boarding passes don't typically carry an arrival datetime.
    expect(leg.scheduledArrival).toBeNull();
    expect(leg.origin).toBe('LHR');
    expect(leg.destination).toBe('SFO');
    expect(leg.passengerName).toBe('DOE/JANE');
    expect(leg.confirmationCode).toBe('PNR-ABC123');
    expect(result.confidence).toBe(1);
  });

  it('returns null for a pkpass without a boardingPass block (coupon, event, etc.)', async () => {
    const { stream, bytes } = await loadFixture('coupon.pkpass');
    const e = new PkpassExtractor();

    const result = await e.extract({ stream, mime: PKPASS_MIME, bytes });

    expect(result).toBeNull();
  });

  it('returns null for garbage bytes without throwing', async () => {
    const buf = Buffer.from('not a zip at all', 'utf8');
    const e = new PkpassExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(buf),
      mime: PKPASS_MIME,
      bytes: buf.byteLength,
    });

    expect(result).toBeNull();
  });

  it('returns null for an empty stream without throwing', async () => {
    const e = new PkpassExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(Buffer.alloc(0)),
      mime: PKPASS_MIME,
      bytes: 0,
    });

    expect(result).toBeNull();
  });

  it('preserves the wall-clock day from relevantDate when the offset crosses the UTC date boundary', async () => {
    // Honolulu departure (UTC-10). A flight at 01:30 local on June 1
    // is "2026-06-01T01:30:00-10:00" — in UTC that's 2026-06-01T11:30Z,
    // which happens to still be June 1, so the original off-by-one bug
    // isn't actually exercised at +1130. The hard case is the symmetric
    // one: a late-evening Honolulu departure straddles the UTC boundary.
    // Use 23:30 HST → 2026-06-02T09:30Z. We expect flightDate = "2026-06-01"
    // (the wall-clock day on the boarding pass), NOT "2026-06-02" (UTC).
    const pass = {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.example.boarding',
      serialNumber: 'PNR-HST-1',
      teamIdentifier: 'TEAMID',
      organizationName: 'Hawaiian',
      description: 'Boarding Pass',
      relevantDate: '2026-06-01T23:30:00-10:00',
      boardingPass: {
        transitType: 'PKTransitTypeAir',
        headerFields: [{ key: 'flightNumber', label: 'Flight', value: 'HA12' }],
        primaryFields: [
          { key: 'origin', label: 'From', value: 'HNL' },
          { key: 'destination', label: 'To', value: 'LAX' },
        ],
      },
    };
    const buf = zipSync({ 'pass.json': strToU8(JSON.stringify(pass)) });
    const e = new PkpassExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(Buffer.from(buf)),
      mime: PKPASS_MIME,
      bytes: buf.byteLength,
    });

    expect(result).not.toBeNull();
    if (!result || result.kind !== 'boarding-pass') return;
    const leg = result.flights[0]!;
    // Wall-clock day preserved from the offset embedded in relevantDate.
    expect(leg.flightDate).toBe('2026-06-01');
    // scheduledDeparture keeps the full ISO including offset.
    expect(leg.scheduledDeparture).toBe('2026-06-01T23:30:00-10:00');
  });

  it('rejects a pass.json larger than the zip-bomb cap without inflating', async () => {
    // Build a real pkpass whose pass.json is > 2 MB. Use highly
    // compressible content so the on-disk fixture stays tiny but the
    // declared `uncompressedSize` in the central directory trips the
    // guard.
    const bigJson = '{"x":"' + 'A'.repeat(3 * 1024 * 1024) + '"}';
    const buf = zipSync({ 'pass.json': strToU8(bigJson) });
    const e = new PkpassExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(Buffer.from(buf)),
      mime: PKPASS_MIME,
      bytes: buf.byteLength,
    });

    expect(result).toBeNull();
  });
});
