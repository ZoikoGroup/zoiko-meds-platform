/**
 * ISO-3166-1 alpha-2 country resolution.
 *
 * Operators type what they know. A profile field labelled "Country" receives
 * "India", "india", "IN" or "Bharat" depending on who fills it in, while billing
 * needs exactly one of those forms: a Stripe customer address and the price
 * catalog are both keyed on the alpha-2 code. Rather than push that mismatch onto
 * every reader — the checkout resolving a market, the billing profile copying the
 * value, the provider adapter sending it — the platform accepts either form at
 * the edge and stores the code.
 *
 * Resolution is deliberately conservative: an unrecognised value returns null so
 * the caller can refuse it. A country guessed wrong silently selects the wrong tax
 * jurisdiction and the wrong market price, which is worse than a rejected form.
 */

/**
 * The officially assigned alpha-2 codes. Kept explicit rather than derived from a
 * runtime API so a code either exists or does not, identically on every host —
 * "ZZ" is a two-character string but not a country, and the old length check
 * accepted it.
 */
const ALPHA2_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW',
  'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
  'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const;

export const ISO_ALPHA2: ReadonlySet<string> = new Set<string>(ALPHA2_CODES);

/**
 * English names for the markets the platform actually operates in or is asked
 * about, so resolution does not depend on the host's ICU data being complete.
 * Everything outside this list still resolves through Intl below; this map is the
 * part that must work everywhere, including a slim container image.
 */
const CORE_NAMES: Record<string, string> = {
  'india': 'IN',
  'united states': 'US',
  'united kingdom': 'GB',
  'united arab emirates': 'AE',
  'canada': 'CA',
  'australia': 'AU',
  'new zealand': 'NZ',
  'singapore': 'SG',
  'malaysia': 'MY',
  'indonesia': 'ID',
  'philippines': 'PH',
  'thailand': 'TH',
  'vietnam': 'VN',
  'japan': 'JP',
  'china': 'CN',
  'hong kong': 'HK',
  'pakistan': 'PK',
  'bangladesh': 'BD',
  'sri lanka': 'LK',
  'nepal': 'NP',
  'saudi arabia': 'SA',
  'qatar': 'QA',
  'oman': 'OM',
  'kuwait': 'KW',
  'bahrain': 'BH',
  'jordan': 'JO',
  'turkey': 'TR',
  'israel': 'IL',
  'egypt': 'EG',
  'morocco': 'MA',
  'nigeria': 'NG',
  'ghana': 'GH',
  'kenya': 'KE',
  'tanzania': 'TZ',
  'uganda': 'UG',
  'ethiopia': 'ET',
  'south africa': 'ZA',
  'germany': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'portugal': 'PT',
  'netherlands': 'NL',
  'belgium': 'BE',
  'ireland': 'IE',
  'switzerland': 'CH',
  'austria': 'AT',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'poland': 'PL',
  'greece': 'GR',
  'romania': 'RO',
  'brazil': 'BR',
  'mexico': 'MX',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'russia': 'RU',
  'ukraine': 'UA',
};

/**
 * Colloquial and historical names people actually type. Kept separate from
 * CORE_NAMES because these are not the ISO names — "England" is not a country
 * code, but somebody typing it into a UK pharmacy profile means GB.
 */
const ALIASES: Record<string, string> = {
  'usa': 'US',
  // Reachable only from an initialism such as "U.S." — a bare "US" is resolved as a
  // code long before the name lookups run.
  'us': 'US',
  'united states of america': 'US',
  'america': 'US',
  'uk': 'GB',
  'great britain': 'GB',
  'britain': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'northern ireland': 'GB',
  'uae': 'AE',
  'emirates': 'AE',
  'dubai': 'AE',
  'abu dhabi': 'AE',
  'bharat': 'IN',
  'republic of india': 'IN',
  'south korea': 'KR',
  'korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  'holland': 'NL',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'burma': 'MM',
  'myanmar': 'MM',
  'swaziland': 'SZ',
  'eswatini': 'SZ',
  'macedonia': 'MK',
  'north macedonia': 'MK',
  'ivory coast': 'CI',
  'cote divoire': 'CI',
  'cape verde': 'CV',
  'east timor': 'TL',
  'timor leste': 'TL',
  'vatican': 'VA',
  'vatican city': 'VA',
  'laos': 'LA',
  'syria': 'SY',
  'iran': 'IR',
  'bolivia': 'BO',
  'venezuela': 'VE',
  'tanzania mainland': 'TZ',
  'drc': 'CD',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'macau': 'MO',
  'taiwan': 'TW',
  'palestine': 'PS',
};

/**
 * Fold a typed country to a comparison key: case, accents, punctuation and a
 * leading article are all things a human varies and a lookup should not care
 * about. "Côte d'Ivoire", "cote d ivoire" and "COTE DIVOIRE" all land together.
 */
function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/ +/g, ' ');
}

/**
 * Names for every remaining code, built once from the host's ICU data.
 *
 * Cached including the failure case: on an image built with a trimmed ICU,
 * Intl.DisplayNames returns the code back instead of a name, so the index is
 * discarded and resolution falls back to CORE_NAMES rather than silently matching
 * nothing. The size check is what distinguishes "trimmed ICU" from "one odd code".
 */
let intlIndexCache: Map<string, string> | null | undefined;

function intlNameIndex(): Map<string, string> | null {
  if (intlIndexCache !== undefined) return intlIndexCache;

  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    const index = new Map<string, string>();
    for (const code of ALPHA2_CODES) {
      const name = display.of(code);
      if (!name || name === code) continue;
      const key = normalizeName(name);
      // First writer wins: CORE_NAMES and ALIASES are consulted before this, so
      // a collision here only ever picks between two ICU spellings.
      if (key && !index.has(key)) index.set(key, code);
    }
    intlIndexCache = index.size >= 100 ? index : null;
  } catch {
    intlIndexCache = null;
  }

  return intlIndexCache;
}

/**
 * Resolve a country written as a code or a name to its alpha-2 code, or null when
 * it cannot be identified.
 *
 * Accepts "IN", "in", "India", "india", "Bharat". Rejects "ZZ" (well-formed but
 * not assigned) and "Hyderabad" (a city in the wrong field) — both return null so
 * the caller reports a bad country rather than storing one.
 */
export function resolveCountryAlpha2(input?: string | null): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // An assigned code is the answer as typed. An unassigned pair of letters is not
  // rejected here but carried on to the aliases: "UK" is not a country code, and
  // GB is what the person meant.
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && ISO_ALPHA2.has(upper)) return upper;

  const key = normalizeName(trimmed);
  if (!key) return null;

  const direct = CORE_NAMES[key] ?? ALIASES[key];
  if (direct) return direct;

  // An initialism loses its separators to the fold above: "U.S.A." arrives here as
  // "u s a" and "U.K." as "u k", neither of which is a key anyone would store.
  // Closing the gaps recovers the code the typist meant — but only against the
  // curated names, never against the code set: "n/a" folds to "na", and a blank
  // answer must not silently become Namibia.
  const compact = key.replace(/ /g, '');
  if (compact !== key) {
    const joined = CORE_NAMES[compact] ?? ALIASES[compact];
    if (joined) return joined;
  }

  return intlNameIndex()?.get(key) ?? null;
}

/** The English name for a code, for messages that echo back what was stored. */
export function countryDisplayName(alpha2: string): string {
  const code = alpha2.trim().toUpperCase();
  if (!ISO_ALPHA2.has(code)) return alpha2;

  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    if (name && name !== code) return name;
  } catch {
    // Falls through to the core map below.
  }

  for (const [name, mapped] of Object.entries(CORE_NAMES)) {
    if (mapped === code) return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return code;
}

/**
 * The currency a market is normally charged in (ISO-4217).
 *
 * Used only to choose between prices that are already approved — never to convert
 * an amount or to invent one. A market absent from this map simply has no
 * preference, and the caller must be told to name the currency explicitly.
 */
const MARKET_CURRENCY: Record<string, string> = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SA: 'SAR', QA: 'QAR', OM: 'OMR', KW: 'KWD',
  BH: 'BHD', JO: 'JOD', IL: 'ILS', TR: 'TRY', EG: 'EGP', MA: 'MAD',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', MY: 'MYR', ID: 'IDR', PH: 'PHP', TH: 'THB',
  VN: 'VND', JP: 'JPY', CN: 'CNY', HK: 'HKD', TW: 'TWD', KR: 'KRW',
  PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  NG: 'NGN', GH: 'GHS', KE: 'KES', TZ: 'TZS', UG: 'UGX', ET: 'ETB', ZA: 'ZAR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', RO: 'RON', UA: 'UAH', RU: 'RUB',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP',
  // Eurozone.
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR',
  GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR',
  NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
};

export function marketDefaultCurrency(alpha2: string): string | null {
  return MARKET_CURRENCY[alpha2.trim().toUpperCase()] ?? null;
}
