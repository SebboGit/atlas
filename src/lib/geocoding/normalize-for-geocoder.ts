// Universal address-shape normalizer applied between `buildGeocodeQuery`
// and the geocoder (the cache key follows, so cache lookups land on the
// normalized form too). The job is narrow: strip interior-location
// designators and embedded postcodes that throw off Nominatim's
// left-to-right q-parser without changing the geocodable identity of
// the address. Country-agnostic by design — every rule is conservative
// enough to apply globally.
//
// See issue #27 and ADR-0010 for context. Pairs with the Plus Code
// path (#26): when `plusCode` is present, this function is not on the
// hot path because decoding wins precedence.
//
// **Where the cache key changes.** Day-one of rollout, every cached
// query for an address containing a postcode or designator changes
// shape. The 7d negative-result TTL sweeps stale null rows out; positive
// hits re-derive cleanly on the next mutation. No migration.
//
// **What this is NOT.** No country-detection branching, no retry-with-
// shrinking-query, no locality-name rewriting ("Minato City" → "Minato-ku").
// Those belong behind their own explicit codepaths if/when hit-rate
// metrics demand them.

/**
 * Strip universally low-signal address noise — interior-location
 * designators (floor, suite, building markers) and embedded postcodes —
 * before the result hits the geocoder. NFC-normalises Unicode along the
 * way. Idempotent and pure; safe to call on already-normalized input.
 *
 * Conservative by design: a string with no commas is treated as a
 * landmark query and passed through with only whitespace/Unicode
 * cleanup. Designator stripping only runs inside comma-separated
 * addresses, where the structure tells us we're processing an
 * address rather than a search target.
 */
// PDF text extraction emits one item per positioned glyph run, and
// Vietnamese fonts position each diacritic letter as its own run — so
// "Nguyễn" arrives as "Nguy ễ n", "Quận" as "Qu ậ n" (seen verbatim in
// extracted booking addresses). Those orphaned letters poison
// geocoder matching: three meaningless tokens instead of one word.
// Rejoin them. Deliberately narrow so real text survives:
//   - the orphan is a single NON-ASCII letter,
//   - the left fragment is short (≤4 letters — the split always lands
//     inside a syllable, and Vietnamese pre-vowel onsets max out at 4),
//   - the right side is consumed only when it looks like a syllable
//     coda (1–3 lowercase letters ending the word).
// "Chemin à Gauche" (a real single-letter French word between full
// words) stays untouched: "Chemin" exceeds the left-fragment bound.
// The orphan must be a STANDALONE token: either a syllable coda
// follows (consumed into the word) or the orphan itself ends at a
// boundary. Without the second lookahead, a clean word like "Ông"
// after a rejoined "Cầu" would donate its capital as a fake orphan
// on the next iteration and the space between the words would vanish.
const SPLIT_DIACRITIC_RE =
  /(^|[\s,])(\p{L}{1,4}) ((?![a-zA-Z])\p{L})(?: (\p{Ll}{1,3})(?=$|[\s,.;])|(?=$|[\s,.;]))/gu;

// Genuine standalone Romance/Iberian single-letter words ("Prêt à
// Manger", "é" in Portuguese). These only count as PDF-mangle orphans
// when the left fragment is too short to be a real word (≤2 letters —
// "Đ à Nẵng" repairs, "Prêt à Manger" survives).
const STANDALONE_WORDS = new Set(['à', 'è', 'é', 'ô', 'ò', 'ì', 'ù']);

export function rejoinSplitDiacritics(input: string): string {
  let prev = input;
  // A word can be split around more than one diacritic; iterate until
  // stable with a hard cap so a pathological input can't loop.
  for (let i = 0; i < 5; i += 1) {
    const next = prev.replace(
      SPLIT_DIACRITIC_RE,
      (match, lead: string, left: string, orphan: string, coda: string | undefined) => {
        // PDF glyph splitting is a Latin-script phenomenon here
        // (Vietnamese). Cyrillic/Greek single-letter words (и, у, ο)
        // are real words — never glue them.
        if (!/\p{Script=Latin}/u.test(orphan)) return match;
        if (STANDALONE_WORDS.has(orphan.toLowerCase()) && left.length > 2) return match;
        return `${lead}${left}${orphan}${coda ?? ''}`;
      },
    );
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

export function normalizeForGeocoder(input: string): string {
  const nfc = input.normalize('NFC');
  const collapsed = rejoinSplitDiacritics(nfc.replace(/\s+/g, ' ').trim());
  if (collapsed === '') return '';

  // No commas → treat as a bare landmark / POI query. "Eiffel Tower",
  // "Senso-ji", "Tokyo Tower" all pass through unchanged — those are
  // search targets, not addresses we should be stripping pieces from.
  if (!collapsed.includes(',')) return collapsed;

  const segments = collapsed.split(',').map((seg) => seg.trim());
  const cleaned: string[] = [];

  for (const seg of segments) {
    const processed = processSegment(seg);
    if (processed !== '') cleaned.push(processed);
  }

  return cleaned.join(', ');
}

// Per-segment cleanup. Returns the empty string when the segment
// contains nothing the geocoder can use (e.g. a standalone "2. OG"
// or "Flat 3").
function processSegment(segment: string): string {
  const hadBuildingMarker = BUILDING_PATTERNS.some((re) => testReset(re, segment));
  const hadFloorOrUnit =
    FLOOR_PATTERNS.some((re) => testReset(re, segment)) ||
    UNIT_PATTERNS.some((re) => testReset(re, segment));

  // Strip postcodes and floor / unit designators inline — a unit
  // designator like "Suite 200" almost always sits next to real
  // street content ("123 Main St Suite 200") that benefits from
  // being freed of the noise.
  let s = segment;
  s = stripPostcodes(s);
  for (const re of FLOOR_PATTERNS) s = s.replace(re, '');
  for (const re of UNIT_PATTERNS) s = s.replace(re, '');

  // Building markers are different: stripping "Tower 5" inline from
  // "Tower 5 Hotel" would clobber the venue name. Only strip the
  // building marker when, after the floor / unit strip above, the
  // marker IS the rest of the segment — i.e. the segment is a pure
  // building identifier like "Tower 2" or "Block A". When other
  // content remains, leave the marker in place so the venue name
  // survives.
  if (hadBuildingMarker) {
    let buildingStripped = s;
    for (const re of BUILDING_PATTERNS) buildingStripped = buildingStripped.replace(re, '');
    if (buildingStripped.replace(/\s+/g, ' ').trim() === '') {
      s = '';
    }
  }

  s = s.replace(/\s+/g, ' ').trim();
  if (s === '') return '';

  // Dual-signature drop: "Peace Bldg. B1F" — a building marker AND
  // an interior-position designator with no street number after
  // stripping. The remnant ("Peace") is just the building's own
  // name, which has no place value on its own — the downstream
  // segments carry the resolvable address. This is the issue's
  // documented null-causing pattern.
  if (hadBuildingMarker && hadFloorOrUnit && !/\d/.test(s)) return '';

  return s;
}

// Strip postcodes by position — they're low-signal for Nominatim's
// q-parser and often shift the parse off course. Per-position matching
// keeps the pattern conservative so we never confuse a street number
// for a postcode (the main risk for 4-5 digit European postcodes vs.
// "1234 Elm Street"-style addresses).
function stripPostcodes(segment: string): string {
  let s = segment;
  // UK: "London SW1A 2AA" → "London" (alphanumeric, no street-number confusion)
  s = s.replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, '');
  // Canada: "Toronto ON M5J 2N8" → "Toronto ON" (alphanumeric)
  s = s.replace(/\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, '');
  // NL: "1012 LG Amsterdam" → "Amsterdam" (digits + letters, distinct shape)
  s = s.replace(/^\d{4}\s?[A-Z]{2}\s+/i, '');
  // JP at end: "Tokyo 160-0022" → "Tokyo" (7 digits, no realistic street-number overlap)
  s = s.replace(/\s+\d{3}-?\d{4}$/, '');

  // The remaining three patterns are pure digits at segment edges and
  // could collide with a street number. Gate on absence of a street-
  // type indicator ("Street", "Highway", "Straße", etc.) — a segment
  // that announces itself as a street segment is not a postcode
  // segment, so its leading/trailing digits are off-limits.
  if (!STREET_TYPE_RE.test(s)) {
    // US ZIP (+4) at end: "IL 62701" → "IL", "IL 62701-1234" → "IL"
    s = s.replace(/\s+\d{5}(-\d{4})?$/, '');
    // DE/FR/ES/IT/AT 4-5 digit at start: "80331 München" → "München"
    s = s.replace(/^\d{4,5}\s+/, '');
    // AU/NZ 4-digit at end: "Sydney NSW 2000" → "Sydney NSW"
    s = s.replace(/\s+\d{4}$/, '');
  }

  return s;
}

// Street-type indicators across English and German — the two language
// families this normalizer covers in v1 (issue scope). Longest forms
// first so alternation prefers them. Wrapped in word boundaries; the
// trailing `\.?` swallows the optional period in abbreviations like
// "St." and "Str."
const STREET_TYPE_RE =
  /\b(?:Boulevard|Highway|Parkway|Avenue|Street|Square|Circle|Plaza|Place|Court|Drive|Trail|Road|Lane|Ave|Blvd|Hwy|Pkwy|Cir|Sq|Pl|Ct|Dr|Rd|Ln|Tr|St|Strasse|Straße|Allee|Platz|Gasse|Damm|Weg|Ring|Str)\b\.?/i;

// Floor designators — token-scoped strips.
const FLOOR_PATTERNS: RegExp[] = [
  // B1F, 2F, 12F (basement/normal Asian floor notation)
  /\bB?\d+F\b/g,
  // "Ground Floor", "1st Floor", "2nd Floor", "23rd Floor"
  /\bGround\s+Floor\b/gi,
  /\b\d+(?:st|nd|rd|th)\s+Floor\b/gi,
  // German "Erdgeschoss" abbreviation: EG
  /\bEG\b/g,
  // German "Obergeschoss" abbreviation: 1. OG, 2.OG
  /\b\d+\.\s*OG\b/g,
];

// Unit/suite designators — token-scoped strips that include the number.
const UNIT_PATTERNS: RegExp[] = [/\b(?:Suite|Apt|Unit|Flat|Room)\s+\d+\w?\b/gi];

// Building markers — see processSegment for the drop rule.
const BUILDING_PATTERNS: RegExp[] = [
  /\bBldg\.?\b/gi,
  // "Building A", "Building 5", "Building 12B" — short identifier
  // token only (≤3 chars). Multi-word names like "Building Society"
  // (London landmark) or "Empire State Building" don't match.
  /\bBuilding\s+\w{1,3}\b/gi,
  // "Tower 1", "Tower 25" — numeric only, so "Eiffel Tower" survives.
  /\bTower\s+\d+\b/gi,
  // "Block A", "Block B" — single-letter only, so "Block 123" (a
  // Singapore-style block identifier that IS the address) survives.
  /\bBlock\s+[A-Z]\b/g,
];

// `RegExp.test` on a `/g`-flagged regex mutates `lastIndex`. The
// fast path through `processSegment` runs each pattern twice (detect
// + strip), so we reset between calls.
function testReset(re: RegExp, s: string): boolean {
  const matched = re.test(s);
  re.lastIndex = 0;
  return matched;
}
