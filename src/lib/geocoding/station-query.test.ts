import { describe, expect, it } from 'vitest';

import { normalizeQuery } from './normalize';
import {
  canCompareStationName,
  encodeStationQuery,
  STATION_OSM_TAGS,
  stationNameMatches,
  stationRungs,
  stripStationName,
  tryParseStationQuery,
} from './station-query';

describe('encodeStationQuery / tryParseStationQuery', () => {
  it('round-trips a key with a country', () => {
    const key = encodeStationQuery({ mode: 'train', countryCode: 'JP', name: 'Kyoto Station' });
    expect(key).toBe('station:train:jp:Kyoto Station');
    expect(tryParseStationQuery(key)).toEqual({
      mode: 'train',
      countryCode: 'jp',
      name: 'Kyoto Station',
    });
  });

  it("writes '-' for a missing or invalid country", () => {
    expect(encodeStationQuery({ mode: 'bus', countryCode: null, name: 'Victoria' })).toBe(
      'station:bus:-:Victoria',
    );
    expect(encodeStationQuery({ mode: 'bus', countryCode: 'GBR', name: 'Victoria' })).toBe(
      'station:bus:-:Victoria',
    );
    expect(tryParseStationQuery('station:bus:-:Victoria')?.countryCode).toBeNull();
  });

  it('parses the lowercased cache-key form too', () => {
    const key = normalizeQuery(
      encodeStationQuery({ mode: 'ferry', countryCode: 'cl', name: 'Pudeto' }),
    );
    expect(tryParseStationQuery(key)).toEqual({ mode: 'ferry', countryCode: 'cl', name: 'pudeto' });
    expect(tryParseStationQuery('STATION:TRAIN:JP:Tokyo')?.mode).toBe('train');
  });

  it('collapses whitespace, including line breaks, on both sides', () => {
    const key = encodeStationQuery({ mode: 'train', countryCode: 'jp', name: 'Kyoto\nStation' });
    expect(key).toBe('station:train:jp:Kyoto Station');
    expect(tryParseStationQuery('station:train:jp:Kyoto\r\n  Station')?.name).toBe('Kyoto Station');
  });

  it('keeps colons inside the name', () => {
    expect(tryParseStationQuery('station:train:-:Terminal 1: Arrivals')?.name).toBe(
      'Terminal 1: Arrivals',
    );
  });

  it('rejects non-endpoint modes, Plus Codes, prose and empty names', () => {
    expect(tryParseStationQuery('station:car:jp:Kyoto')).toBeNull();
    expect(tryParseStationQuery('station:other:-:Kyoto')).toBeNull();
    expect(tryParseStationQuery('8Q7XMQJ8+FV')).toBeNull();
    expect(tryParseStationQuery('Station: Tokyo')).toBeNull();
    expect(tryParseStationQuery('station:train:jp:   ')).toBeNull();
    expect(tryParseStationQuery('')).toBeNull();
  });
});

describe('stripStationName', () => {
  it('strips the trailing station word', () => {
    expect(stripStationName('Tokyo Station', 'train')).toBe('Tokyo');
    expect(stripStationName('Kyoto Sta.', 'train')).toBe('Kyoto');
    expect(stripStationName('Shinjuku Stn', 'train')).toBe('Shinjuku');
    expect(stripStationName('東京駅', 'train')).toBe('東京');
  });

  it('takes a preceding rail word with it on trains', () => {
    expect(stripStationName('Kyoto Railway Station', 'train')).toBe('Kyoto');
  });

  it('drops a leading JR operator prefix on trains only', () => {
    expect(stripStationName('JR Kyoto Station', 'train')).toBe('Kyoto');
    expect(stripStationName('JR-Fujinomori', 'train')).toBe('Fujinomori');
    expect(stripStationName('JR Kyoto Station', 'bus')).toBe('JR Kyoto');
    expect(stripStationName('Jream', 'train')).toBe('Jream');
  });

  it('strips ferry terminal words', () => {
    expect(stripStationName('Dover Ferry Terminal', 'ferry')).toBe('Dover');
    expect(stripStationName('Sumida Pier', 'ferry')).toBe('Sumida');
  });

  it('keeps the rest of a bus station name', () => {
    expect(stripStationName('Victoria Coach Station', 'bus')).toBe('Victoria Coach');
  });

  it('leaves names without a trailing station word alone', () => {
    expect(stripStationName('Berlin Hbf', 'train')).toBe('Berlin Hbf');
    expect(stripStationName('Stationsplein', 'train')).toBe('Stationsplein');
    expect(stripStationName('Gare de Lyon', 'train')).toBe('Gare de Lyon');
    expect(stripStationName('Sta. Maria', 'train')).toBe('Sta. Maria');
  });

  it('never strips a name down to nothing', () => {
    expect(stripStationName('Station', 'train')).toBe('Station');
    expect(stripStationName('駅', 'train')).toBe('駅');
  });
});

describe('STATION_OSM_TAGS', () => {
  it('only uses labels that are safe inside a Photon include parameter', () => {
    for (const tags of Object.values(STATION_OSM_TAGS)) {
      for (const tag of tags) {
        expect(tag.key).toMatch(/^[a-zA-Z0-9_-]+$/);
        expect(tag.value).toMatch(/^[a-zA-Z0-9_-]+$/);
      }
    }
  });
});

describe('stationRungs', () => {
  it('tries the raw name, then the stripped name, then the stripped name worldwide', () => {
    expect(stationRungs({ mode: 'train', countryCode: 'jp', name: 'Tokyo Station' })).toEqual([
      { query: 'Tokyo Station', countryCode: 'jp' },
      { query: 'Tokyo', countryCode: 'jp' },
      { query: 'Tokyo', countryCode: null },
    ]);
  });

  it('drops duplicate rungs when stripping changes nothing', () => {
    expect(stationRungs({ mode: 'train', countryCode: 'de', name: 'Berlin Hbf' })).toEqual([
      { query: 'Berlin Hbf', countryCode: 'de' },
      { query: 'Berlin Hbf', countryCode: null },
    ]);
  });

  it('searches worldwide only when the segment has no country', () => {
    expect(
      stationRungs({ mode: 'ferry', countryCode: null, name: 'Dover Ferry Terminal' }),
    ).toEqual([
      { query: 'Dover Ferry Terminal', countryCode: null },
      { query: 'Dover', countryCode: null },
    ]);
  });
});

describe('stationNameMatches', () => {
  it('matches across accents and dropped category words', () => {
    expect(stationNameMatches('Tokyo Station', 'Tōkyō')).toBe(true);
    expect(stationNameMatches('Shin-Osaka', 'Shin-Ōsaka')).toBe(true);
    expect(stationNameMatches('Kyoto Station', 'Kyoto Station Building')).toBe(true);
    expect(stationNameMatches('JR Kyoto Station', 'Kyoto')).toBe(true);
    expect(stationNameMatches('Gare de Lyon', 'Gare de Lyon')).toBe(true);
  });

  it('folds letters that accent stripping leaves whole', () => {
    expect(stationNameMatches('Lodz Fabryczna', 'Łódź Fabryczna')).toBe(true);
  });

  it('rejects a hit that only shares part of the name', () => {
    expect(stationNameMatches('Busta Shinjuku', 'Shinjuku-3chome')).toBe(false);
    expect(stationNameMatches('Tokyo Station', 'Shakujii-kōen')).toBe(false);
  });

  it('rejects a hit that contains the name plus more — a different station', () => {
    expect(stationNameMatches('Yokohama Station', 'Mutsu-Yokohama Station')).toBe(false);
    expect(stationNameMatches('Kobe Station', 'Kobe Airport Station')).toBe(false);
    expect(stationNameMatches('Berlin Hbf', 'Berlin Hauptbahnhof (tief)')).toBe(false);
  });

  it('never matches a query with no comparable Latin words', () => {
    expect(canCompareStationName('東京駅')).toBe(false);
    expect(canCompareStationName('JR 京都駅')).toBe(false);
    expect(canCompareStationName('Kyoto Station')).toBe(true);
    expect(stationNameMatches('東京駅', 'Tōkyō')).toBe(false);
    expect(stationNameMatches('JR 京都駅', 'Kyoto')).toBe(false);
  });

  it('rejects a nameless hit', () => {
    expect(stationNameMatches('Kyoto', null)).toBe(false);
    expect(stationNameMatches('Kyoto', '  ')).toBe(false);
  });
});
