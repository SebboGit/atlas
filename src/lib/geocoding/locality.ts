// Shared "which locality goes on the card" logic for both providers
// (#111 follow-up). The goal is the city a traveller would say they're
// visiting — the metropolis, not the ward inside it.
//
// Two field-observed wrinkles drive the rules:
//   - Vietnam's 2025 admin reform put wards directly under provinces,
//     so OSM tags a *ward* as the point's city ("Nam Hoa Lư Ward",
//     "Phường ..."). When the city value is ward-shaped and a state
//     exists, the state is the travel-level answer.
//   - Vietnamese admin names carry classifier prefixes/suffixes
//     ("Thành phố Hà Nội" = Hanoi City, "Tỉnh Ninh Bình" = Ninh Bình
//     Province, "Ninh Binh province"). Strip the classifier, keep the
//     name. Deliberately NOT stripped: a trailing English " City" —
//     "Mexico City" and "Quebec City" are the actual names.

// Unicode-aware boundaries: JS \b is ASCII-only, so a trailing \b
// after "xã" can never match. Lookarounds on letters/digits do.
const SUBCITY_RE = /(?<![\p{L}\p{N}])(?:ward|phường|xã|commune)(?![\p{L}\p{N}])/iu;

// Case-insensitive: OSM tag casing is inconsistent ("Thành Phố",
// "thành phố"); /iu handles the Vietnamese letters correctly.
const CLASSIFIER_PREFIX_RE = /^(?:thành phố|tỉnh|thị xã)\s+/iu;
const CLASSIFIER_SUFFIX_RE = /\s+province$/iu;

function cleanLocality(raw: string): string {
  return raw.trim().replace(CLASSIFIER_PREFIX_RE, '').replace(CLASSIFIER_SUFFIX_RE, '').trim();
}

export interface LocalityParts {
  city?: string | null;
  town?: string | null;
  village?: string | null;
  municipality?: string | null;
  district?: string | null;
  county?: string | null;
  state?: string | null;
}

/**
 * Choose the card-line locality from a provider's structured address
 * parts. Most-specific city-like value first, falling back through the
 * coarser units; a ward-shaped winner defers to the state when one is
 * present. Returns null when nothing usable exists.
 */
export function chooseLocality(parts: LocalityParts): string | null {
  const order = [
    parts.city,
    parts.town,
    parts.village,
    parts.municipality,
    parts.district,
    parts.county,
    parts.state,
  ];
  let chosen: string | null = null;
  for (const candidate of order) {
    const v = candidate?.trim();
    if (v) {
      chosen = v;
      break;
    }
  }
  if (chosen === null) return null;

  // Classifier strip BEFORE the ward test: "Thị xã Sơn Tây" (a
  // provincial town whose own name is the right locality) must lose
  // its "Thị xã " prefix before the "xã" marker can misread it as a
  // commune. "Phường …" deliberately stays unstripped so the marker
  // fires and the state wins.
  let value = cleanLocality(chosen);
  if (value === '') return null;

  const stateRaw = parts.state?.trim();
  const state = stateRaw ? cleanLocality(stateRaw) : '';
  if (state !== '' && state !== value && SUBCITY_RE.test(value)) {
    value = state;
  }

  return value === '' ? null : value;
}
