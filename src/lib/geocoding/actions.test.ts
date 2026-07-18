import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeocodeCandidate } from './types';

// --- Mocks ---------------------------------------------------------------
// The action auth-gates via requireUser and resolves the geocoder via
// the barrel's getGeocoder. We mock both so the test exercises only the
// action's own logic (validation + query composition + result shaping)
// without a DB, a network call, or a session.

const requireUser = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  requireUser: () => requireUser(),
}));

// `search` is the single seam we assert against — it captures the
// composed query. `getGeocoder` returns an object exposing it (plus a
// noop `geocode` to satisfy the Geocoder & GeocodeSearcher shape the
// action's call site expects at runtime; the action only ever calls
// `search`).
const search = vi.fn<(query: string, opts?: { limit?: number }) => Promise<GeocodeCandidate[]>>();
const getGeocoder = vi.fn(() => ({ search, geocode: vi.fn() }));
vi.mock('./index', () => ({
  getGeocoder: () => getGeocoder(),
}));

// Imported after the mocks are registered.
const { searchPlaceCandidatesAction } = await import('./actions');

function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    lat: 35.6585,
    lng: 139.7454,
    displayName: 'Park Hyatt Tokyo, Shinjuku, Tokyo, Japan',
    name: 'Park Hyatt Tokyo',
    addressLabel: 'Park Hyatt Tokyo, Shinjuku, Tokyo, Japan',
    osmType: 'hotel',
    category: 'tourism',
    countryCode: 'JP',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'user-1' });
  getGeocoder.mockReturnValue({ search, geocode: vi.fn() });
  search.mockResolvedValue([candidate()]);
});

describe('searchPlaceCandidatesAction — query composition', () => {
  it('searches the NAME, not the typed address', async () => {
    await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Park Hyatt Tokyo',
      // An address-shaped field is NOT part of the input contract; even
      // a misguided caller can't push it into the query because the
      // schema strips unknown keys via the explicit object shape.
      locationName: 'Shinjuku',
      countryCode: 'JP',
    } as unknown);

    expect(search).toHaveBeenCalledTimes(1);
    const [query] = search.mock.calls[0]!;
    expect(query).toBe('Park Hyatt Tokyo, Shinjuku, Japan');
    // The literal typed-address pattern never reaches the geocoder.
    expect(query).not.toMatch(/\d+-\d+/);
  });

  it('composes name + locationName + resolved country NAME', async () => {
    await searchPlaceCandidatesAction({
      type: 'food',
      name: 'Narisawa',
      locationName: 'Minato',
      countryCode: 'JP',
    });
    expect(search.mock.calls[0]![0]).toBe('Narisawa, Minato, Japan');
  });

  it('omits locationName when absent', async () => {
    await searchPlaceCandidatesAction({
      type: 'activity',
      name: 'TeamLab Planets',
      countryCode: 'JP',
    });
    expect(search.mock.calls[0]![0]).toBe('TeamLab Planets, Japan');
  });

  it('omits country when absent or empty', async () => {
    await searchPlaceCandidatesAction({ type: 'transit', name: 'Hakone-Yumoto Station' });
    expect(search.mock.calls[0]![0]).toBe('Hakone-Yumoto Station');

    await searchPlaceCandidatesAction({
      type: 'transit',
      name: 'Hakone-Yumoto Station',
      countryCode: '',
    });
    expect(search.mock.calls[1]![0]).toBe('Hakone-Yumoto Station');
  });

  it('resolves the ISO code case-insensitively to the English country name', async () => {
    await searchPlaceCandidatesAction({ type: 'hotel', name: 'Hotel X', countryCode: 'my' });
    expect(search.mock.calls[0]![0]).toBe('Hotel X, Malaysia');
  });

  it('requests at most 3 candidates', async () => {
    await searchPlaceCandidatesAction({ type: 'hotel', name: 'Hotel X' });
    expect(search.mock.calls[0]![1]).toEqual({ limit: 3 });
  });
});

describe('searchPlaceCandidatesAction — result shaping & guards', () => {
  it('returns the candidate list on success', async () => {
    const c = candidate({ name: 'Place A' });
    search.mockResolvedValue([c]);
    const result = await searchPlaceCandidatesAction({ type: 'hotel', name: 'Place A' });
    expect(result).toEqual({ ok: true, candidates: [c], via: 'name' });
  });

  it('returns an empty list (still ok) when nothing matches', async () => {
    search.mockResolvedValue([]);
    const result = await searchPlaceCandidatesAction({ type: 'hotel', name: 'jdkslajd' });
    expect(result).toEqual({ ok: true, candidates: [], via: 'name' });
  });

  it('rejects an unknown type without calling the geocoder', async () => {
    const result = await searchPlaceCandidatesAction({ type: 'note', name: 'x' } as unknown);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const result = await searchPlaceCandidatesAction({ type: 'hotel', name: '   ' });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(search).not.toHaveBeenCalled();
  });

  it('reports unconfigured when the geocoder factory throws (missing contact email)', async () => {
    getGeocoder.mockImplementation(() => {
      throw new Error('NOMINATIM_CONTACT_EMAIL is not set');
    });
    const result = await searchPlaceCandidatesAction({ type: 'hotel', name: 'Hotel X' });
    expect(result).toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('requires an authenticated user', async () => {
    requireUser.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(searchPlaceCandidatesAction({ type: 'hotel', name: 'Hotel X' })).rejects.toThrow(
      'UNAUTHORIZED',
    );
    expect(search).not.toHaveBeenCalled();
  });
});

describe('address fallback rung (ADR-0018 coverage gap)', () => {
  const MANGLED_ADDRESS =
    '6A/20 Nguy ễ n C ả nh Chân, C ầ u Ông Lãnh, Qu ậ n 1, H ồ Chí Minh, Vi ệ t Nam';

  it('does not touch the address when the name search hits', async () => {
    const c = candidate();
    search.mockResolvedValueOnce([c]);

    const result = await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Park Hyatt Tokyo',
      address: MANGLED_ADDRESS,
    });

    expect(result).toEqual({ ok: true, candidates: [c], via: 'name' });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('falls back to the normalized address when the name finds nothing', async () => {
    const street = candidate({ name: 'Phố Nguyễn Cảnh Chân' });
    search.mockResolvedValueOnce([]).mockResolvedValueOnce([street]);

    const result = await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Amana Living - Nguyen Canh Chan',
      address: MANGLED_ADDRESS,
    });

    expect(result).toEqual({ ok: true, candidates: [street], via: 'address' });
    expect(search).toHaveBeenCalledTimes(2);
    // The fallback query must be de-mangled: PDF glyph splitting
    // ("Nguy ễ n") poisons matching if sent raw.
    const fallbackQuery = search.mock.calls[1]![0];
    expect(fallbackQuery).toContain('Nguyễn Cảnh Chân');
    expect(fallbackQuery).toContain('Việt Nam');
    expect(fallbackQuery).not.toContain('ễ ');
  });

  it('stays a clean empty result when the name misses and no address is on file', async () => {
    search.mockResolvedValueOnce([]);

    const result = await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Nowhere Inn',
    });

    expect(result).toEqual({ ok: true, candidates: [], via: 'name' });
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('address fallback — head+tail truncation for long addresses', () => {
  it('retries with street head + locality tail when the full address misses', async () => {
    const street = candidate({ name: 'Nguyễn Cảnh Chân' });
    // name miss, full-address miss, truncated hit
    search.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([street]);

    const result = await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Amana Living - Nguyen Canh Chan',
      address:
        '6A/20 Nguy ễ n C ả nh Chân, C ầ u Ông Lãnh, Amana Living, Stadtbezirk 1, Ho Chi Minh Stadt, Vietnam, 700000 Qu ậ n 1, H ồ Chí Minh, Vi ệ t Nam',
    });

    expect(result).toEqual({ ok: true, candidates: [street], via: 'address' });
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls[2]![0]).toBe('6A/20 Nguyễn Cảnh Chân, Hồ Chí Minh, Việt Nam');
  });

  it('does not fire a redundant retry for short addresses', async () => {
    search.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await searchPlaceCandidatesAction({
      type: 'hotel',
      name: 'Nowhere Inn',
      address: 'Somestreet 5, Springfield',
    });

    expect(result).toEqual({ ok: true, candidates: [], via: 'address' });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
