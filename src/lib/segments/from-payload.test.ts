import { describe, expect, it } from 'vitest';

import type {
  BoardingPassPayload,
  FlightLeg,
  GenericPayload,
  HotelConfirmationPayload,
  StructuredPayload,
} from '@/lib/extraction';

import { payloadToSegmentInputs } from './from-payload';
import type { SegmentCreateInput } from './validators';

// Most tests in this file predate the multi-flight `flights[]` shape
// and assert on a single SegmentCreateInput. `mapOne` keeps those
// assertions intact while exercising the plural mapper end-to-end:
// for a single-leg boarding pass and for hotels, the array always
// has zero or one elements, so unwrapping to a nullable single value
// matches the old contract. Multi-leg cases use
// `payloadToSegmentInputs` directly in their own describe block.
function mapOne(payload: StructuredPayload): SegmentCreateInput | null {
  const out = payloadToSegmentInputs(payload);
  return out[0] ?? null;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// Most tests vary one or two leg-level fields on a single flight.
// `legOverrides` reaches into the first (and usually only) flight;
// `payloadOverrides` covers wrapper-level fields like confidence and
// the full `flights` array for multi-leg cases.
function boardingPass(
  legOverrides: Partial<FlightLeg> = {},
  payloadOverrides: Partial<Omit<BoardingPassPayload, 'flights'>> = {},
): BoardingPassPayload {
  const leg: FlightLeg = {
    carrier: 'BA',
    flightNumber: '287',
    flightDate: '2026-06-01',
    scheduledDeparture: null,
    scheduledArrival: null,
    origin: 'LHR',
    destination: 'SFO',
    passengerName: 'DOE/JANE',
    confirmationCode: 'ABC123',
    ...legOverrides,
  };
  return {
    kind: 'boarding-pass',
    flights: [leg],
    confidence: 0.9,
    ...payloadOverrides,
  };
}

function hotel(overrides: Partial<HotelConfirmationPayload> = {}): HotelConfirmationPayload {
  return {
    kind: 'hotel-confirmation',
    hotelName: 'Hotel California',
    checkIn: '2026-06-02',
    checkOut: '2026-06-05',
    address: '1 Sunset Blvd, Los Angeles, CA',
    confirmationCode: 'CONF-9',
    country: 'US',
    confidence: 0.81,
    ...overrides,
  };
}

function generic(overrides: Partial<GenericPayload> = {}): GenericPayload {
  return {
    kind: 'generic',
    summary: 'Generic travel document.',
    confidence: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('payloadToSegmentInputs (single-leg, via mapOne helper)', () => {
  describe('boarding-pass', () => {
    it('maps a full payload to a flight segment input', () => {
      const out = mapOne(boardingPass());

      expect(out).toEqual({
        type: 'flight',
        startsAt: new Date(2026, 5, 1), // June is month index 5
        endsAt: null,
        locationName: 'SFO',
        // Country codes resolve from the airport IATA snapshot:
        // LHR → GB (origin), SFO → US (destination).
        countryCode: 'US',
        originCountryCode: 'GB',
        data: {
          // "BA" was resolved to its airline name via the static lookup
          // — the segment stores the friendly form.
          carrier: 'British Airways',
          flightNumber: '287',
          originAirport: 'LHR',
          destinationAirport: 'SFO',
          pnr: 'ABC123',
        },
      });
    });

    it('keeps an unresolved carrier code verbatim when the lookup misses', () => {
      // The lookup table is intentionally not exhaustive (ADR-0009).
      // On a miss we fall back to the IATA code as-is so the document's
      // information isn't lost; the display layer runs the same lookup
      // anyway and renders the code itself when unresolved.
      const out = mapOne(boardingPass({ carrier: 'ZZ' }));
      expect(out).not.toBeNull();
      if (out === null || out.type !== 'flight') throw new Error('expected flight');
      expect((out.data as { carrier?: string }).carrier).toBe('ZZ');
    });

    it('prefers scheduledDeparture over flightDate for startsAt when both are set', () => {
      const out = mapOne(
        boardingPass({
          flightDate: '2026-06-01',
          scheduledDeparture: '2026-06-01T11:30:00Z',
        }),
      );
      expect(out).not.toBeNull();
      // Wall-clock instant from the ISO string — `new Date(iso)` is
      // the same parsing the validator's dateInput does for ISO-with-TZ.
      expect((out as Exclude<typeof out, null>).startsAt).toEqual(new Date('2026-06-01T11:30:00Z'));
    });

    it('lifts scheduledArrival to endsAt when present', () => {
      const out = mapOne(
        boardingPass({
          scheduledDeparture: '2026-06-01T11:30:00Z',
          scheduledArrival: '2026-06-01T19:50:00Z',
        }),
      );
      expect(out).not.toBeNull();
      expect((out as Exclude<typeof out, null>).endsAt).toEqual(new Date('2026-06-01T19:50:00Z'));
    });

    it('falls back to date-only midnight when only flightDate is available', () => {
      const out = mapOne(boardingPass({ flightDate: '2026-06-01', scheduledDeparture: null }));
      expect(out).not.toBeNull();
      expect((out as Exclude<typeof out, null>).startsAt).toEqual(new Date(2026, 5, 1));
      expect((out as Exclude<typeof out, null>).endsAt).toBeNull();
    });

    it('NEVER lifts passengerName onto the segment', () => {
      // ADR-0008 privacy rule: passenger name lives on the document
      // only. The structural enforcement is `flightData.strict()` in
      // validators.ts; this test pins the behavioural contract too so
      // a future refactor that switches to a non-strict shape doesn't
      // silently let it through.
      const out = mapOne(boardingPass({ passengerName: 'SECRET/SHOULDNOT/APPEAR' }));

      expect(out).not.toBeNull();
      // `data` is the JSONB blob that lands on the row. Walk every key
      // we ever populate; none should be the passenger name.
      const data = (out as Exclude<typeof out, null>).data as Record<string, unknown>;
      for (const v of Object.values(data)) {
        expect(v).not.toBe('SECRET/SHOULDNOT/APPEAR');
      }
      // And no `passengerName` key was created either.
      expect('passengerName' in data).toBe(false);
    });

    it('produces a stub segment when key fields are null', () => {
      const out = mapOne(
        boardingPass({
          carrier: null,
          flightNumber: null,
          scheduledDeparture: null,
          scheduledArrival: null,
          origin: null,
          destination: null,
          confirmationCode: null,
        }),
      );

      // Even a near-empty boarding pass yields a segment — the user can
      // clean it up. The dedup logic in the action layer is responsible
      // for not collapsing different stubs into each other.
      expect(out).toEqual({
        type: 'flight',
        startsAt: new Date(2026, 5, 1),
        endsAt: null,
        locationName: null,
        countryCode: null,
        originCountryCode: null,
        data: {},
      });
    });

    it('returns null startsAt when flightDate is missing', () => {
      const out = mapOne(boardingPass({ flightDate: null }));
      expect(out).not.toBeNull();
      expect((out as Exclude<typeof out, null>).startsAt).toBeNull();
    });

    it('returns null when carrier+flight-number, flightDate and scheduledDeparture are all missing', () => {
      // No anchoring identifier — without at least one of (carrier +
      // flightNumber), flightDate, or scheduledDeparture the segment
      // would be a useless stub. Matches the conservative match policy
      // from ADR-0008.
      expect(
        mapOne(
          boardingPass({
            carrier: null,
            flightNumber: null,
            flightDate: null,
            scheduledDeparture: null,
            scheduledArrival: null,
          }),
        ),
      ).toBeNull();
    });

    it('keeps the stub when only flightDate is present (route / carrier unknown)', () => {
      // A date with no flight identifier is a weak but real anchor —
      // the user can edit the segment to fill in. Don't refuse.
      const out = mapOne(boardingPass({ carrier: null, flightNumber: null }));
      expect(out).not.toBeNull();
      expect((out as Exclude<typeof out, null>).startsAt).toEqual(new Date(2026, 5, 1));
    });

    it('keeps the stub when only carrier+flightNumber are present (date unknown)', () => {
      const out = mapOne(boardingPass({ flightDate: null }));
      expect(out).not.toBeNull();
      expect((out as Exclude<typeof out, null>).startsAt).toBeNull();
    });
  });

  describe('hotel-confirmation', () => {
    it('maps a full payload to a hotel segment input', () => {
      const out = mapOne(hotel());

      expect(out).toEqual({
        type: 'hotel',
        startsAt: new Date(2026, 5, 2),
        endsAt: new Date(2026, 5, 5),
        // locationName is intentionally null on extraction — the
        // address lives in `data.address`, the property name in
        // `data.propertyName`. Auto-populating locationName from
        // either duplicated content on the hotel card subtitle.
        locationName: null,
        countryCode: 'US',
        data: {
          propertyName: 'Hotel California',
          address: '1 Sunset Blvd, Los Angeles, CA',
          confirmationNumber: 'CONF-9',
        },
      });
    });

    it('returns null when hotelName is missing (validator requires it)', () => {
      // FlightData has no required field — even a near-empty boarding
      // pass round-trips. HotelData requires propertyName, so without
      // it the validator would reject the input. Refuse in the mapper
      // rather than producing a write that .strict() will throw on.
      expect(mapOne(hotel({ hotelName: null }))).toBeNull();
    });

    it('leaves locationName null even when the address is missing', () => {
      // A short pin label is genuinely user-territory — no extracted
      // field maps cleanly onto "short locality" without guessing.
      const out = mapOne(hotel({ address: null }));
      expect(out).not.toBeNull();
      if (out === null || out.type !== 'hotel') throw new Error('expected hotel');
      expect(out.locationName).toBeNull();
    });
  });

  describe('generic', () => {
    it('returns null — the pipeline does not create segments for unclassified documents', () => {
      expect(mapOne(generic())).toBeNull();
    });
  });
});

describe('payloadToSegmentInputs (multi-flight)', () => {
  function legFixture(overrides: Partial<FlightLeg> = {}): FlightLeg {
    return {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: '2026-06-01',
      scheduledDeparture: null,
      scheduledArrival: null,
      origin: 'LHR',
      destination: 'SFO',
      passengerName: 'DOE/JANE',
      confirmationCode: 'ABC123',
      ...overrides,
    };
  }

  it('return-trip: emits one segment per leg in chronological order', () => {
    const outbound = legFixture({
      flightNumber: '287',
      flightDate: '2026-06-01',
      origin: 'LHR',
      destination: 'SFO',
    });
    const inbound = legFixture({
      flightNumber: '286',
      flightDate: '2026-06-15',
      origin: 'SFO',
      destination: 'LHR',
    });

    const out = payloadToSegmentInputs({
      kind: 'boarding-pass',
      flights: [outbound, inbound],
      confidence: 0.9,
    });

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(
      expect.objectContaining({
        type: 'flight',
        startsAt: new Date(2026, 5, 1),
        locationName: 'SFO',
        data: expect.objectContaining({ flightNumber: '287', originAirport: 'LHR' }),
      }),
    );
    expect(out[1]).toEqual(
      expect.objectContaining({
        type: 'flight',
        startsAt: new Date(2026, 5, 15),
        locationName: 'LHR',
        data: expect.objectContaining({ flightNumber: '286', originAirport: 'SFO' }),
      }),
    );
  });

  it('multi-city: emits N segments, one per leg', () => {
    const leg1 = legFixture({ flightNumber: '1', origin: 'MUC', destination: 'DXB' });
    const leg2 = legFixture({
      flightNumber: '2',
      origin: 'DXB',
      destination: 'SGN',
      flightDate: '2026-06-02',
    });
    const leg3 = legFixture({
      flightNumber: '3',
      origin: 'SGN',
      destination: 'HAN',
      flightDate: '2026-06-08',
    });

    const out = payloadToSegmentInputs({
      kind: 'boarding-pass',
      flights: [leg1, leg2, leg3],
      confidence: 0.9,
    });

    expect(out).toHaveLength(3);
    expect(out.map((s) => (s.data as { flightNumber?: string }).flightNumber)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('drops a leg with no anchor while keeping the others', () => {
    // Same dropping rule as single-flight: a leg with no carrier+number,
    // no flightDate, and no scheduledDeparture is a useless stub. Other
    // legs in the same payload survive — only the anchorless one is
    // skipped.
    const goodLeg = legFixture({ flightNumber: '287' });
    const anchorless = legFixture({
      carrier: null,
      flightNumber: null,
      flightDate: null,
      scheduledDeparture: null,
    });

    const out = payloadToSegmentInputs({
      kind: 'boarding-pass',
      flights: [goodLeg, anchorless],
      confidence: 0.9,
    });

    expect(out).toHaveLength(1);
    expect(out[0]?.data).toEqual(expect.objectContaining({ flightNumber: '287' }));
  });
});
