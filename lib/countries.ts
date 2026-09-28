/**
 * Countries, dialling codes and phone normalisation.
 *
 * The profile form used to take one free-text field and hope it was an M-Pesa number. That was
 * only ever true for Kenya, while the directory, the payout destinations and the KYC flow are
 * all international. So the phone is now a *pair*: a country (which supplies the dialling code
 * and the flag shown next to it) and a national number, and the pair is stored as one E.164
 * string plus the ISO country it came from.
 *
 * Two representations, deliberately:
 *  • `phone` — E.164 (`+254712345678`). This is the canonical value: what uniqueness is checked
 *    against, what the uniqueness index holds, and what travels to the payout provider. Comparing
 *    raw typed text is how "one phone, two accounts" gets past a naive check.
 *  • `phoneDisplay` — how the member sees it in the form (`+254 712 345 678`), derived, never
 *    trusted as input.
 *
 * Flags are Unicode regional-indicator emoji, so they are plain text: no image requests, no SVG
 * allow-listing, no bundle growth, and they inherit the surrounding font colour.
 *
 * Validation is deliberately two-tier:
 *  • **Sign-up / profile** — the generic ITU E.164 rule (country code + a national significant
 *    number of the length that country actually uses). This accepts the world.
 *  • **Payout** — `lib/payouts.ts` keeps its strict Kenyan mobile-money rule, because M-Pesa
 *    payouts are Kenyan by construction. A member in another country can hold a valid phone here
 *    and still only be paid to a bank account.
 */

// ─── Data ────────────────────────────────────────────────────────────────────

/**
 * `[ISO-3166 alpha-2, display name, dialling code, national number min, national number max]`.
 *
 * Lengths are the national significant number *excluding* the country code, per ITU-T E.164
 * assignments. They are deliberately a little generous at the edges: the point is to catch a
 * mistyped number, not to adjudicate between two carriers in a country we do not pay out to.
 */
type CountrySeed = readonly [string, string, string, number, number]

const COUNTRY_SEEDS: readonly CountrySeed[] = [
  ['KE', 'Kenya', '254', 9, 9],
  ['UG', 'Uganda', '256', 9, 9],
  ['TZ', 'Tanzania', '255', 9, 9],
  ['RW', 'Rwanda', '250', 9, 9],
  ['BI', 'Burundi', '257', 8, 8],
  ['SS', 'South Sudan', '211', 9, 9],
  ['ET', 'Ethiopia', '251', 9, 9],
  ['SO', 'Somalia', '252', 7, 9],
  ['DJ', 'Djibouti', '253', 8, 8],
  ['ER', 'Eritrea', '291', 7, 7],
  ['SD', 'Sudan', '249', 9, 9],
  ['EG', 'Egypt', '20', 9, 10],
  ['MA', 'Morocco', '212', 9, 9],
  ['DZ', 'Algeria', '213', 9, 9],
  ['TN', 'Tunisia', '216', 8, 8],
  ['LY', 'Libya', '218', 9, 9],
  ['NG', 'Nigeria', '234', 10, 10],
  ['GH', 'Ghana', '233', 9, 9],
  ['CI', "Côte d'Ivoire", '225', 8, 10],
  ['SN', 'Senegal', '221', 9, 9],
  ['ML', 'Mali', '223', 8, 8],
  ['BF', 'Burkina Faso', '226', 8, 8],
  ['NE', 'Niger', '227', 8, 8],
  ['TD', 'Chad', '235', 8, 8],
  ['CM', 'Cameroon', '237', 9, 9],
  ['GA', 'Gabon', '241', 8, 8],
  ['CG', 'Congo', '242', 9, 9],
  ['CD', 'DR Congo', '243', 9, 9],
  ['AO', 'Angola', '244', 9, 9],
  ['ZM', 'Zambia', '260', 9, 9],
  ['ZW', 'Zimbabwe', '263', 9, 9],
  ['MW', 'Malawi', '265', 9, 9],
  ['MZ', 'Mozambique', '258', 9, 9],
  ['BW', 'Botswana', '267', 8, 8],
  ['NA', 'Namibia', '264', 9, 9],
  ['SZ', 'Eswatini', '268', 8, 8],
  ['LS', 'Lesotho', '266', 8, 8],
  ['MG', 'Madagascar', '261', 9, 9],
  ['MU', 'Mauritius', '230', 8, 8],
  ['SC', 'Seychelles', '248', 7, 7],
  ['ZA', 'South Africa', '27', 9, 9],
]

/** The rest of the dial plan, kept in its own block so the African plan above stays readable. */
const REST_OF_WORLD: readonly CountrySeed[] = [
  ['GB', 'United Kingdom', '44', 10, 10],
  ['IE', 'Ireland', '353', 7, 9],
  ['US', 'United States', '1', 10, 10],
  ['CA', 'Canada', '1', 10, 10],
  ['AU', 'Australia', '61', 9, 9],
  ['NZ', 'New Zealand', '64', 8, 10],
  ['IN', 'India', '91', 10, 10],
  ['PK', 'Pakistan', '92', 10, 10],
  ['BD', 'Bangladesh', '880', 10, 10],
  ['LK', 'Sri Lanka', '94', 9, 9],
  ['NP', 'Nepal', '977', 10, 10],
  ['CN', 'China', '86', 11, 11],
  ['JP', 'Japan', '81', 9, 10],
  ['KR', 'South Korea', '82', 9, 10],
  ['ID', 'Indonesia', '62', 9, 12],
  ['MY', 'Malaysia', '60', 9, 10],
  ['SG', 'Singapore', '65', 8, 8],
  ['TH', 'Thailand', '66', 8, 9],
  ['VN', 'Vietnam', '84', 9, 10],
  ['PH', 'Philippines', '63', 10, 10],
  ['KH', 'Cambodia', '855', 8, 9],
  ['MM', 'Myanmar', '95', 8, 10],
  ['BN', 'Brunei', '673', 7, 7],
  ['MN', 'Mongolia', '976', 8, 8],
  ['KZ', 'Kazakhstan', '7', 10, 10],
  ['UZ', 'Uzbekistan', '998', 9, 9],
  ['KG', 'Kyrgyzstan', '996', 9, 9],
  ['TJ', 'Tajikistan', '992', 9, 9],
  ['TM', 'Turkmenistan', '993', 8, 8],
  ['AZ', 'Azerbaijan', '994', 9, 9],
  ['GE', 'Georgia', '995', 9, 9],
  ['AM', 'Armenia', '374', 8, 8],
  ['TR', 'Turkey', '90', 10, 10],
  ['IR', 'Iran', '98', 10, 10],
  ['IQ', 'Iraq', '964', 10, 10],
  ['SY', 'Syria', '963', 9, 9],
  ['LB', 'Lebanon', '961', 7, 8],
  ['JO', 'Jordan', '962', 9, 9],
  ['IL', 'Israel', '972', 9, 9],
  ['SA', 'Saudi Arabia', '966', 9, 9],
  ['AE', 'United Arab Emirates', '971', 9, 9],
  ['QA', 'Qatar', '974', 8, 8],
  ['KW', 'Kuwait', '965', 8, 8],
  ['BH', 'Bahrain', '973', 8, 8],
  ['OM', 'Oman', '968', 8, 8],
  ['YE', 'Yemen', '967', 9, 9],
  ['PS', 'Palestine', '970', 9, 9],
  ['AF', 'Afghanistan', '93', 9, 9],
  ['RU', 'Russia', '7', 10, 10],
  ['KZ', 'Kazakhstan', '7', 10, 10],
  ['IT', 'Italy', '39', 6, 11],
  ['ES', 'Spain', '34', 9, 9],
  ['PT', 'Portugal', '351', 9, 9],
  ['FR', 'France', '33', 9, 9],
  ['DE', 'Germany', '49', 6, 11],
  ['AT', 'Austria', '43', 7, 13],
  ['CH', 'Switzerland', '41', 9, 9],
  ['NL', 'Netherlands', '31', 9, 9],
  ['BE', 'Belgium', '32', 8, 9],
  ['LU', 'Luxembourg', '352', 9, 9],
  ['DK', 'Denmark', '45', 8, 8],
  ['SE', 'Sweden', '46', 7, 13],
  ['NO', 'Norway', '47', 8, 8],
  ['FI', 'Finland', '358', 9, 10],
  ['IS', 'Iceland', '354', 7, 7],
  ['PL', 'Poland', '48', 9, 9],
  ['CZ', 'Czechia', '420', 9, 9],
  ['SK', 'Slovakia', '421', 9, 9],
  ['HU', 'Hungary', '36', 9, 9],
  ['RO', 'Romania', '40', 9, 9],
  ['BG', 'Bulgaria', '359', 8, 9],
  ['GR', 'Greece', '30', 10, 10],
  ['HR', 'Croatia', '385', 8, 9],
  ['RS', 'Serbia', '381', 8, 9],
  ['SI', 'Slovenia', '386', 8, 8],
  ['BA', 'Bosnia & Herzegovina', '387', 8, 8],
  ['MK', 'North Macedonia', '389', 8, 8],
  ['AL', 'Albania', '355', 8, 9],
  ['ME', 'Montenegro', '382', 8, 8],
  ['XK', 'Kosovo', '383', 8, 9],
  ['EE', 'Estonia', '372', 7, 8],
  ['LV', 'Latvia', '371', 8, 8],
  ['LT', 'Lithuania', '370', 8, 8],
  ['UA', 'Ukraine', '380', 9, 9],
  ['BY', 'Belarus', '375', 9, 9],
  ['MD', 'Moldova', '373', 8, 8],
  ['BR', 'Brazil', '55', 10, 11],
  ['AR', 'Argentina', '54', 10, 11],
  ['CL', 'Chile', '56', 9, 9],
  ['CO', 'Colombia', '57', 10, 10],
  ['PE', 'Peru', '51', 9, 9],
  ['VE', 'Venezuela', '58', 10, 10],
  ['EC', 'Ecuador', '593', 9, 9],
  ['BO', 'Bolivia', '591', 8, 8],
  ['PY', 'Paraguay', '595', 9, 9],
  ['UY', 'Uruguay', '598', 8, 9],
  ['CR', 'Costa Rica', '506', 8, 8],
  ['PA', 'Panama', '507', 8, 8],
  ['GT', 'Guatemala', '502', 8, 8],
  ['HN', 'Honduras', '504', 8, 8],
  ['NI', 'Nicaragua', '505', 8, 8],
  ['SV', 'El Salvador', '503', 8, 8],
  ['CU', 'Cuba', '53', 8, 8],
  ['DO', 'Dominican Republic', '1', 10, 10],
  ['HT', 'Haiti', '509', 8, 8],
  ['JM', 'Jamaica', '1', 10, 10],
  ['TT', 'Trinidad & Tobago', '1', 10, 10],
  ['BS', 'Bahamas', '1', 10, 10],
  ['BB', 'Barbados', '1', 10, 10],
  ['GY', 'Guyana', '592', 7, 7],
  ['SR', 'Suriname', '597', 6, 7],
]

/**
 * One list. The `+1` and `+7` country codes are shared by several countries, which is why the
 * builder below keeps every row and the *reader* picks the longest matching dial code.
 */
const ALL_SEEDS: readonly CountrySeed[] = [...COUNTRY_SEEDS, ...REST_OF_WORLD]

export type Country = {
  /** ISO-3166 alpha-2. */
  code: string
  name: string
  /** Dialling code without the leading `+`. */
  dial: string
  /** National significant number length, excluding the country code. */
  nsnMin: number
  nsnMax: number
  /** Unicode flag emoji, derived from the ISO code. */
  flag: string
}

function flagFromCode(iso: string): string {
  // Regional indicator symbols: 'A' (0x41) → 🇦 (U+1F1E6).
  const points = Array.from(iso)
    .filter((ch) => /[A-Z]/.test(ch))
    .map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)
  return String.fromCodePoint(...points)
}

export const COUNTRIES: readonly Country[] = (() => {
  const seen = new Set<string>()
  const out: Country[] = []
  for (const [code, name, dial, nsnMin, nsnMax] of ALL_SEEDS) {
    if (seen.has(code)) continue
    seen.add(code)
    out.push({ code, name, dial, nsnMin, nsnMax, flag: flagFromCode(code) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})()

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]))

/** The country the platform is operated from — the default in every form. */
export const DEFAULT_COUNTRY = 'KE'

export function getCountry(code: unknown): Country | null {
  const clean = String(code ?? '').trim().toUpperCase()
  if (!clean) return null
  return BY_CODE.get(clean) ?? null
}

export function countryName(code: unknown): string {
  return getCountry(code)?.name ?? String(code ?? '').trim().toUpperCase()
}

export function countryFlag(code: unknown): string {
  return getCountry(code)?.flag ?? '🏳️'
}

/** True when `code` names a country we can actually format a number for. */
export function isKnownCountry(code: unknown): boolean {
  return getCountry(code) !== null
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * "Where is this person?" — answered from the browser, before they type anything.
 *
 * A member who has never told us their country should not have to scroll a 190-row list to pick
 * it: an operator opening a profile on a phone in Kampala should land on Uganda, and the same
 * member in Nairobi on Kenya. The picker stays authoritative — this only preselects it.
 *
 * Two independent signals, and the order between them is the whole design:
 *
 *  1. **IANA time zone** (`Intl.DateTimeFormat().resolvedOptions().timeZone`). This is the
 *     honest one. A phone in Kenya reports `Africa/Nairobi` no matter what language pack, region
 *     setting or VPN the handset happens to carry.
 *  2. **Locale region** (`navigator.language` → `en-KE`, `sw-KE`). A weak fallback, and last on
 *     purpose: a large share of handsets ship with `en-US` regardless of where they are, so
 *     trusting it first would confidently label Nairobi as United States.
 *
 * Returns `null` — never a guess — when neither signal names a country we can format a number
 * for. Callers keep their own default, so an unknown device degrades to today's behaviour rather
 * than to a wrong country pre-selected in a form a member then submits.
 */
const TIMEZONE_COUNTRIES: Readonly<Record<string, string>> = {
  'Africa/Nairobi': 'KE',
  'Africa/Mombasa': 'KE',
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Dodoma': 'TZ',
  'Africa/Kigali': 'RW',
  'Africa/Bujumbura': 'BI',
  'Africa/Juba': 'SS',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Asmara': 'ER',
  'Africa/Djibouti': 'DJ',
  'Africa/Khartoum': 'SD',
  'Africa/Mogadishu': 'SO',
  'Africa/Johannesburg': 'ZA',
  'Africa/Cape_Town': 'ZA',
  'Africa/Maseru': 'LS',
  'Africa/Mbabane': 'SZ',
  'Africa/Windhoek': 'NA',
  'Africa/Gaborone': 'BW',
  'Africa/Harare': 'ZW',
  'Africa/Lusaka': 'ZM',
  'Africa/Maputo': 'MZ',
  'Africa/Blantyre': 'MW',
  'Africa/Lilongwe': 'MW',
  'Africa/Port_Louis': 'MU',
  'Africa/Victoria': 'SC',
  'Africa/Lagos': 'NG',
  'Africa/Porto-Novo': 'BJ',
  'Africa/Cotonou': 'BJ',
  'Africa/Accra': 'GH',
  'Africa/Abidjan': 'CI',
  'Africa/Bamako': 'ML',
  'Africa/Ouagadougou': 'BF',
  'Africa/Dakar': 'SN',
  'Africa/Banjul': 'GM',
  'Africa/Bissau': 'GW',
  'Africa/Conakry': 'GN',
  'Africa/Freetown': 'SL',
  'Africa/Monrovia': 'LR',
  'Africa/Lome': 'TG',
  'Africa/Niamey': 'NE',
  'Africa/Nouakchott': 'MR',
  'Africa/Douala': 'CM',
  'Africa/Cairo': 'EG',
  'Africa/Casablanca': 'MA',
  'Africa/El_Aaiun': 'EH',
  'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN',
  'Africa/Tripoli': 'LY',
  'Africa/Libreville': 'GA',
  'Africa/Brazzaville': 'CG',
  'Africa/Kinshasa': 'CD',
  'Africa/Luanda': 'AO',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Lisbon': 'PT',
  'Europe/Madrid': 'ES',
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
  'Europe/Berlin': 'DE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Rome': 'IT',
  'Europe/Prague': 'CZ',
  'Europe/Warsaw': 'PL',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Kyiv': 'UA',
  'Europe/Istanbul': 'TR',
  'Europe/Moscow': 'RU',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'America/Detroit': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/Mexico_City': 'MX',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'America/Sao_Paulo': 'BR',
  'America/Manaus': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Santo_Domingo': 'DO',
  'America/Panama': 'PA',
  'America/Guatemala': 'GT',
  'America/Costa_Rica': 'CR',
  'America/Jamaica': 'JM',
  'America/Puerto_Rico': 'PR',
  'Asia/Jerusalem': 'IL',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Doha': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Bahrain': 'BH',
  'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Asia/Damascus': 'SY',
  'Asia/Baghdad': 'IQ',
  'Asia/Tehran': 'IR',
  'Asia/Karachi': 'PK',
  'Asia/Kolkata': 'IN',
  'Asia/Colombo': 'LK',
  'Asia/Dhaka': 'BD',
  'Asia/Kathmandu': 'NP',
  'Asia/Kabul': 'AF',
  'Asia/Almaty': 'KZ',
  'Asia/Tashkent': 'UZ',
  'Asia/Bishkek': 'KG',
  'Asia/Dushanbe': 'TJ',
  'Asia/Ashgabat': 'TM',
  'Asia/Baku': 'AZ',
  'Asia/Tbilisi': 'GE',
  'Asia/Yerevan': 'AM',
  'Asia/Hong_Kong': 'HK',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Taipei': 'TW',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Phnom_Penh': 'KH',
  'Asia/Yangon': 'MM',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Australia/Hobart': 'AU',
  'Pacific/Auckland': 'NZ',
  'Pacific/Fiji': 'FJ',
  'Atlantic/Reykjavik': 'IS',
}

/**
 * `Africa/Nairobi` → `KE`, `Asia/Tokyo` → `JP`, `Nowhere/Special` → `null`.
 *
 * Exact match only — deliberately no "every unlisted `Africa/*` zone must be Kenya" shortcut. That
 * shortcut is wrong for a member in Bissau, and the failure mode is a form that opens
 * pre-labelled with the wrong flag *and* the wrong dialling code, which they then have to notice
 * and correct. Returning `null` leaves the picker exactly where it was.
 */
export function detectCountryFromTimeZone(timeZone: unknown): string | null {
  const zone = String(timeZone ?? '').trim()
  if (!zone) return null
  const exact = TIMEZONE_COUNTRIES[zone]
  return exact && isKnownCountry(exact) ? exact : null
}

/** `en-KE` → `KE`, `sw-UG` → `UG`, `en-US` → `US`, `en` → `null`. */
export function detectCountryFromLocale(locale: unknown): string | null {
  const tag = String(locale ?? '').trim()
  if (!tag) return null
  let region = ''
  try {
    // `Intl.Locale` understands `en-KE` and `ke` alike. Read the *explicit* region subtag and
    // never `maximize()`: maximising would turn a bare `fr` into France on the strength of a
    // language majority and confidently preselect the wrong country on the form.
    region = new Intl.Locale(tag).region ?? ''
  } catch {
    const match = /[-_]([A-Za-z]{2})\b/.exec(tag)
    region = match?.[1]?.toUpperCase() ?? ''
  }
  return region && isKnownCountry(region) ? region : null
}

/**
 * The member's most likely country, or `null`.
 *
 * Server-safe: every browser API it touches is behind a `typeof window` guard, so it can be called
 * during SSR (where it always answers `null`) without the caller needing its own guard.
 */
export function detectCountry(): string | null {
  if (typeof window === 'undefined' || typeof Intl === 'undefined') return null
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const fromZone = detectCountryFromTimeZone(zone)
    if (fromZone) return fromZone
  } catch {
    /* fall through to the locale */
  }
  const locales = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const locale of locales ?? []) {
    const fromLocale = detectCountryFromLocale(locale)
    if (fromLocale) return fromLocale
  }
  return null
}

const DETECTED_COUNTRY_KEY = 'afterworks:detected-country'

/**
 * The last country we detected on this device.
 *
 * Read as well as detected, because a member who is filling the profile form in several sittings
 * should land on the same country each time even if they travel, and because detection is a
 * *preselection* — once a person has corrected it, the correction is the better answer.
 *
 * Every access is wrapped: storage throws outright in Safari private mode and when a site's cookies
 * are blocked, and losing this convenience must never take a form down with it.
 */
export function recallDetectedCountry(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(DETECTED_COUNTRY_KEY)
    return stored && isKnownCountry(stored) ? stored.toUpperCase() : null
  } catch {
    return null
  }
}

/** Remembers a country so the next form on this device opens on it. Best effort, never throws. */
export function rememberDetectedCountry(code: unknown): void {
  const clean = String(code ?? '').trim().toUpperCase()
  if (typeof window === 'undefined' || !isKnownCountry(clean)) return
  try {
    window.localStorage.setItem(DETECTED_COUNTRY_KEY, clean)
  } catch {
    /* storage blocked — detection still works for this page view */
  }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/** Everything except a leading `+` and digits is noise a person pasted in. */
function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/[^\d]/g, '')
}

export type PhoneResult =
  | { ok: true; e164: string; national: string; country: string; display: string }
  | { ok: false; error: string }

/**
 * The single rule for "what is a valid phone number here".
 *
 * Accepts either the full international form (`+254 712 345 678`, `254712345678`) or a bare
 * national number **together with** the selected country. Returns E.164, which is what gets
 * stored, compared for uniqueness and sent to a payout provider.
 *
 * The `0` trunk prefix is stripped, because a Kenyan member types `0712 345 678` and an E.164
 * number may not contain it. This is the step the old free-text field skipped, and it is exactly
 * why `0712345678` and `+254712345678` used to look like two different people.
 */
export function normalisePhone(input: unknown, countryCode: unknown = DEFAULT_COUNTRY): PhoneResult {
  const country = getCountry(countryCode)
  if (!country) {
    return { ok: false, error: 'Choose a country for your phone number.' }
  }

  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter your phone number.' }

  const dial = country.dial
  let national = digitsOnly(raw)

  // A leading `+` (or the full country code) means the number is already international — trust
  // the number over the selected country only when they agree.
  const hasPlus = /^\s*\+/.test(raw)
  if (hasPlus && national.startsWith(dial)) {
    national = national.slice(dial.length)
  } else if (!hasPlus && country.code === 'KE' && national.startsWith('0')) {
    national = national.slice(1)
  } else if (!hasPlus && national.startsWith('0') && country.nsnMin === country.nsnMax) {
    // Countries whose national numbers never start with 0: drop a stray trunk prefix rather than
    // rejecting the number outright.
    national = national.replace(/^0+/, '')
  }

  if (national.startsWith(dial) && national.length > country.nsnMin) {
    // The member pasted the country code into a national field. Drop exactly one copy.
    national = national.slice(dial.length)
  }

  if (national.length < country.nsnMin || national.length > country.nsnMax) {
    return {
      ok: false,
      error: `That is not a valid ${country.name} number — it should be ${country.nsnMin} digits after the +${dial} country code.`,
    }
  }

  // Kenya-specific: the country code is shared with Tanzania (+255 is separate, but +254 1… and
  // +254 7… are both valid Kenyan numbers — 7 for mobile, 1 for fixed line). Anything else in a
  // +254 number is a mistyped mobile number, and an M-Pesa payout depends on it being right.
  if (country.code === 'KE' && !/^[17]\d{8}$/.test(national)) {
    return { ok: false, error: 'Enter a Kenyan mobile number starting with 7 or 1, e.g. 0712 345 678.' }
  }

  return {
    ok: true,
    e164: `+${dial}${national}`,
    national,
    country: country.code,
    display: formatPhoneForDisplay(`+${dial}${national}`, country.code),
  }
}

/** `+254712345678` → `+254 712 345 678`. Grouping is per country length, so nothing is guessed. */
export function formatPhoneForDisplay(e164: string, countryCode?: string): string {
  const country = getCountry(countryCode)
  const digits = digitsOnly(e164)
  if (!digits || !country) return e164
  const national = digits.startsWith(country.dial) ? digits.slice(country.dial.length) : digits
  const groups: string[] = []
  // Read right to left in threes, which is how most national plans are written out.
  for (let end = national.length; end > 0; end -= 3) {
    groups.unshift(national.slice(Math.max(0, end - 3), end))
  }
  return `+${country.dial} ${groups.join(' ')}`
}

/**
 * Best-effort country guess for a stored E.164 value, used to preselect the picker on the form.
 *
 * Longest dial code wins, so `+255` never steals a `+254` number. Two dial codes in the plan are
 * genuinely shared — `+1` (North America and the Caribbean) and `+7` (Russia and Kazakhstan) — and
 * for those the number itself carries no country information at all. `SHARED_DIAL_DEFAULT` is
 * where that is made explicit rather than left to list order, which would otherwise answer
 * "Bahamas" for a New York number because the list is sorted by name.
 *
 * This is only ever a *default* for a form. The authoritative country is the `phoneCountry` stored
 * with the number, which is why a number is never re-guessed from its prefix once it is saved.
 */
const SHARED_DIAL_DEFAULT: Record<string, string> = { '1': 'US', '7': 'RU' }

export function guessCountryFromE164(e164: unknown): string {
  const digits = digitsOnly(e164)
  if (!digits) return DEFAULT_COUNTRY
  let best: Country | null = null
  for (const country of COUNTRIES) {
    if (!digits.startsWith(country.dial)) continue
    if (!best || country.dial.length > best.dial.length) best = country
  }
  if (!best) return DEFAULT_COUNTRY
  if (SHARED_DIAL_DEFAULT[best.dial] && best.dial.length === 1) {
    return SHARED_DIAL_DEFAULT[best.dial] ?? best.code
  }
  return best.code
}

/**
 * The digits used for uniqueness comparison: the national number without the country code.
 *
 * Normalises first rather than assuming it was handed an E.164 string, because the callers that
 * matter most are comparing a *stored* value against a *freshly typed* one, and a comparison key
 * that silently changes shape with input formatting is worse than no key at all.
 */
export function phoneMatchKey(e164: unknown, countryCode?: string): string {
  const country = getCountry(countryCode ?? guessCountryFromE164(e164))
  const parsed = normalisePhone(e164, country?.code ?? DEFAULT_COUNTRY)
  if (parsed.ok) return parsed.national
  // Unparseable input still gets a stable key so a bad row cannot match everything.
  const digits = digitsOnly(e164)
  if (!country) return digits
  return digits.startsWith(country.dial) ? digits.slice(country.dial.length) : digits
}
