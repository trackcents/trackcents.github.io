/**
 * Generates `src/lib/app/brand-logos.ts` — the registry of merchant/service
 * logos used to make a category instantly recognizable (Netflix, Uber, Swiggy…).
 *
 * Two kinds of entry:
 *   - kind:'mark'   — the REAL official monochrome mark, from Simple Icons
 *                     (CC0-1.0). Rendered in the brand's official colour.
 *   - kind:'letter' — a brand-coloured lettermark TILE we draw ourselves, for
 *                     services Simple Icons does not carry (many were removed at
 *                     the brand's request). Honestly an approximation, not the
 *                     official logo.
 *
 * IP note: brand names/logos are trademarks of their respective owners. They are
 * used here ONLY to identify the actual service a user is tracking (nominative
 * use) — no affiliation or endorsement is implied. See NOTICE-brands.md.
 *
 * Run:  node scripts/gen-brand-logos.mjs   (then `pnpm format` tidies output)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as si from 'simple-icons';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'lib', 'app', 'brand-logos.ts');

// Build a slug -> icon lookup once.
const bySlug = {};
for (const k of Object.keys(si)) {
  const ic = si[k];
  if (ic && ic.slug) bySlug[ic.slug] = ic;
}

/**
 * Curated brand set. `slug` (if present in Simple Icons) yields the real mark;
 * otherwise we fall back to a lettermark tile using `text` + `color` (+ `fg`).
 * `keywords` are matched word-bounded against the category/description text.
 */
const BRANDS = [
  // ── Video streaming / OTT ─────────────────────────────────────────────
  { key: 'netflix', title: 'Netflix', slug: 'netflix', keywords: ['netflix'] },
  {
    key: 'primevideo',
    title: 'Prime Video',
    keywords: ['prime video', 'primevideo'],
    text: 'PV',
    color: '#1399FF',
    fg: '#FFFFFF'
  },
  {
    key: 'hotstar',
    title: 'Hotstar',
    keywords: ['hotstar', 'disney+ hotstar'],
    text: 'hs',
    color: '#1F80E0',
    fg: '#FFFFFF'
  },
  {
    key: 'disneyplus',
    title: 'Disney+',
    keywords: ['disney+', 'disney plus', 'disneyplus', 'disney'],
    text: 'D+',
    color: '#113CCF',
    fg: '#FFFFFF'
  },
  { key: 'hulu', title: 'Hulu', keywords: ['hulu'], text: 'hulu', color: '#1CE783', fg: '#0B0C0F' },
  {
    key: 'zee5',
    title: 'ZEE5',
    keywords: ['zee5', 'zee 5'],
    text: 'ZEE5',
    color: '#6F2DA8',
    fg: '#FFFFFF'
  },
  {
    key: 'sonyliv',
    title: 'SonyLIV',
    keywords: ['sonyliv', 'sony liv'],
    text: 'LIV',
    color: '#1A1A6C',
    fg: '#FFFFFF'
  },
  {
    key: 'jiocinema',
    title: 'JioCinema',
    keywords: ['jiocinema', 'jio cinema'],
    text: 'JC',
    color: '#B5179E',
    fg: '#FFFFFF'
  },
  {
    key: 'jiohotstar',
    title: 'JioHotstar',
    keywords: ['jiohotstar', 'jio hotstar'],
    text: 'JH',
    color: '#E9357A',
    fg: '#FFFFFF'
  },
  {
    key: 'sunnxt',
    title: 'Sun NXT',
    keywords: ['sun nxt', 'sunnxt'],
    text: 'SUN',
    color: '#D71921',
    fg: '#FFFFFF'
  },
  {
    key: 'aha',
    title: 'aha',
    keywords: ['aha video'],
    text: 'aha',
    color: '#FF5A1F',
    fg: '#FFFFFF'
  },
  { key: 'crunchyroll', title: 'Crunchyroll', slug: 'crunchyroll', keywords: ['crunchyroll'] },
  {
    key: 'appletv',
    title: 'Apple TV',
    slug: 'appletv',
    keywords: ['apple tv', 'appletv', 'apple tv+']
  },
  {
    key: 'paramountplus',
    title: 'Paramount+',
    slug: 'paramountplus',
    keywords: ['paramount+', 'paramount plus', 'paramount']
  },
  { key: 'hbomax', title: 'Max', slug: 'hbomax', keywords: ['hbo max', 'hbomax', 'hbo'] },
  { key: 'youtube', title: 'YouTube', slug: 'youtube', keywords: ['youtube premium', 'youtube'] },
  {
    key: 'peacock',
    title: 'Peacock',
    keywords: ['peacock'],
    text: 'NBC',
    color: '#000000',
    fg: '#FFFFFF'
  },

  // ── Music ─────────────────────────────────────────────────────────────
  { key: 'spotify', title: 'Spotify', slug: 'spotify', keywords: ['spotify'] },
  {
    key: 'applemusic',
    title: 'Apple Music',
    slug: 'applemusic',
    keywords: ['apple music', 'applemusic']
  },
  {
    key: 'youtubemusic',
    title: 'YT Music',
    slug: 'youtubemusic',
    keywords: ['youtube music', 'yt music']
  },
  { key: 'gaana', title: 'Gaana', keywords: ['gaana'], text: 'G', color: '#E72C30', fg: '#FFFFFF' },
  { key: 'wynk', title: 'Wynk', keywords: ['wynk'], text: 'W', color: '#FF3278', fg: '#FFFFFF' },
  { key: 'audible', title: 'Audible', slug: 'audible', keywords: ['audible'] },

  // ── Ride hailing / transport ──────────────────────────────────────────
  { key: 'uber', title: 'Uber', slug: 'uber', keywords: ['uber'] },
  {
    key: 'ola',
    title: 'Ola',
    keywords: ['ola cabs', 'olacabs', 'ola'],
    text: 'Ola',
    color: '#00A14B',
    fg: '#FFFFFF'
  },
  {
    key: 'rapido',
    title: 'Rapido',
    keywords: ['rapido'],
    text: 'R',
    color: '#FFD200',
    fg: '#1A1A1A'
  },
  { key: 'lyft', title: 'Lyft', slug: 'lyft', keywords: ['lyft'] },
  { key: 'grab', title: 'Grab', slug: 'grab', keywords: ['grab'] },
  {
    key: 'redbus',
    title: 'redBus',
    keywords: ['redbus', 'red bus'],
    text: 'rB',
    color: '#D84E55',
    fg: '#FFFFFF'
  },
  {
    key: 'irctc',
    title: 'IRCTC',
    keywords: ['irctc'],
    text: 'IR',
    color: '#213A8F',
    fg: '#FFFFFF'
  },
  {
    key: 'makemytrip',
    title: 'MakeMyTrip',
    keywords: ['makemytrip', 'make my trip'],
    text: 'MMT',
    color: '#E5253D',
    fg: '#FFFFFF'
  },

  // ── Food delivery / restaurants ───────────────────────────────────────
  { key: 'swiggy', title: 'Swiggy', slug: 'swiggy', keywords: ['swiggy'] },
  { key: 'zomato', title: 'Zomato', slug: 'zomato', keywords: ['zomato'] },
  { key: 'dunzo', title: 'Dunzo', slug: 'dunzo', keywords: ['dunzo'] },
  {
    key: 'mcdonalds',
    title: "McDonald's",
    slug: 'mcdonalds',
    keywords: ['mcdonald', 'mcdonalds', 'mcd']
  },
  { key: 'kfc', title: 'KFC', slug: 'kfc', keywords: ['kfc'] },
  { key: 'starbucks', title: 'Starbucks', slug: 'starbucks', keywords: ['starbucks'] },
  {
    key: 'burgerking',
    title: 'Burger King',
    slug: 'burgerking',
    keywords: ['burger king', 'burgerking']
  },
  {
    key: 'dominos',
    title: "Domino's",
    keywords: ['domino', 'dominos'],
    text: 'D',
    color: '#006491',
    fg: '#FFFFFF'
  },
  {
    key: 'pizzahut',
    title: 'Pizza Hut',
    keywords: ['pizza hut', 'pizzahut'],
    text: 'PH',
    color: '#ED1C24',
    fg: '#FFFFFF'
  },
  {
    key: 'subway',
    title: 'Subway',
    keywords: ['subway'],
    text: 'S',
    color: '#008C15',
    fg: '#FFFFFF'
  },
  {
    key: 'dunkin',
    title: "Dunkin'",
    keywords: ['dunkin'],
    text: 'DD',
    color: '#FF6E0C',
    fg: '#FFFFFF'
  },

  // ── Quick-commerce / shopping ─────────────────────────────────────────
  {
    key: 'bigbasket',
    title: 'BigBasket',
    slug: 'bigbasket',
    keywords: ['bigbasket', 'big basket']
  },
  {
    key: 'blinkit',
    title: 'Blinkit',
    keywords: ['blinkit', 'grofers'],
    text: 'b',
    color: '#F8CB46',
    fg: '#1A1A1A'
  },
  { key: 'zepto', title: 'Zepto', keywords: ['zepto'], text: 'Z', color: '#5A2BD6', fg: '#FFFFFF' },
  {
    key: 'amazon',
    title: 'Amazon',
    keywords: ['amazon'],
    text: 'a',
    color: '#FF9900',
    fg: '#131A22'
  },
  {
    key: 'flipkart',
    title: 'Flipkart',
    keywords: ['flipkart'],
    text: 'F',
    color: '#2874F0',
    fg: '#FFEB3B'
  },
  {
    key: 'myntra',
    title: 'Myntra',
    keywords: ['myntra'],
    text: 'M',
    color: '#FF3F6C',
    fg: '#FFFFFF'
  },

  // ── Payments / telecom / banks ────────────────────────────────────────
  { key: 'phonepe', title: 'PhonePe', slug: 'phonepe', keywords: ['phonepe', 'phone pe'] },
  {
    key: 'googlepay',
    title: 'Google Pay',
    slug: 'googlepay',
    keywords: ['google pay', 'googlepay', 'gpay']
  },
  { key: 'paytm', title: 'Paytm', slug: 'paytm', keywords: ['paytm'] },
  {
    key: 'amazonpay',
    title: 'Amazon Pay',
    keywords: ['amazon pay', 'amazonpay'],
    text: 'aP',
    color: '#FF9900',
    fg: '#131A22'
  },
  { key: 'razorpay', title: 'Razorpay', slug: 'razorpay', keywords: ['razorpay'] },
  { key: 'cred', title: 'CRED', keywords: ['cred'], text: 'CRED', color: '#0B0B0B', fg: '#FFFFFF' },
  { key: 'airtel', title: 'Airtel', slug: 'airtel', keywords: ['airtel'] },
  { key: 'jio', title: 'Jio', slug: 'jio', keywords: ['jio'] },
  { key: 'vodafone', title: 'Vi', slug: 'vodafone', keywords: ['vodafone', 'vi recharge'] },

  // ── Other common subscriptions ────────────────────────────────────────
  {
    key: 'applearcade',
    title: 'Apple',
    slug: 'apple',
    keywords: ['icloud', 'apple one', 'apple arcade', 'app store']
  },
  {
    key: 'playstation',
    title: 'PS Plus',
    slug: 'playstation',
    keywords: ['playstation', 'ps plus', 'psn']
  },
  {
    key: 'xbox',
    title: 'Xbox',
    keywords: ['xbox', 'game pass'],
    text: 'X',
    color: '#107C10',
    fg: '#FFFFFF'
  },
  { key: 'steam', title: 'Steam', slug: 'steam', keywords: ['steam'] },
  { key: 'notion', title: 'Notion', slug: 'notion', keywords: ['notion'] },
  { key: 'figma', title: 'Figma', slug: 'figma', keywords: ['figma'] },
  {
    key: 'adobe',
    title: 'Adobe',
    keywords: ['adobe', 'photoshop', 'creative cloud'],
    text: 'A',
    color: '#FF0000',
    fg: '#FFFFFF'
  },
  {
    key: 'chatgpt',
    title: 'ChatGPT',
    keywords: ['chatgpt', 'openai'],
    text: 'AI',
    color: '#10A37F',
    fg: '#FFFFFF'
  }
];

// Luminance-based fallback for foreground if a lettermark omits `fg`.
function pickFg(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

const entries = [];
const keywordPairs = [];
let nMark = 0;
let nLetter = 0;
const missingRequested = [];

for (const b of BRANDS) {
  let entry;
  if (b.slug && bySlug[b.slug]) {
    const ic = bySlug[b.slug];
    entry = { kind: 'mark', title: b.title, hex: `#${ic.hex}`, path: ic.path };
    nMark++;
  } else {
    if (b.slug) missingRequested.push(b.slug); // asked for a real mark but not available
    const color = b.color ?? '#475569';
    entry = {
      kind: 'letter',
      title: b.title,
      hex: color,
      text: b.text ?? b.title.slice(0, 2),
      fg: b.fg ?? pickFg(color)
    };
    nLetter++;
  }
  entries.push([b.key, entry]);
  for (const kw of b.keywords) keywordPairs.push([kw.toLowerCase(), b.key]);
}

// Longest keyword first so "prime video" wins over "amazon", "apple music" over "apple".
keywordPairs.sort((a, b) => b[0].length - a[0].length);

const body = `/**
 * AUTO-GENERATED by scripts/gen-brand-logos.mjs — DO NOT EDIT BY HAND.
 * Re-run the generator to change this file.
 *
 * Brand marks (kind:'mark') come from Simple Icons (CC0-1.0) and are the REAL
 * official monochrome marks, rendered in each brand's official colour. Marks
 * we draw ourselves (kind:'letter') are brand-coloured lettermark tiles for
 * services Simple Icons does not carry — an honest approximation, NOT the
 * official logo.
 *
 * Brand names and logos are trademarks of their respective owners and are used
 * here only to identify the service a user is tracking (nominative use); no
 * affiliation or endorsement is implied. See NOTICE-brands.md.
 *
 * Stats: ${nMark} official marks, ${nLetter} lettermark tiles.
 */

/** An official single-path mark drawn in the brand colour. */
export interface BrandMark {
  kind: 'mark';
  title: string;
  /** Official brand colour, e.g. "#E50914". */
  hex: string;
  /** SVG path data in a 24x24 viewBox. */
  path: string;
}

/** A brand-coloured lettermark tile we draw (for logos we can't ship). */
export interface BrandLetter {
  kind: 'letter';
  title: string;
  /** Tile background = brand colour. */
  hex: string;
  /** Short text shown on the tile. */
  text: string;
  /** Foreground (text) colour. */
  fg: string;
}

export type BrandLogo = BrandMark | BrandLetter;

export type BrandKey = ${entries.map(([k]) => `'${k}'`).join(' | ')};

export const BRAND_LOGOS: Record<BrandKey, BrandLogo> = {
${entries.map(([k, e]) => `  ${k}: ${JSON.stringify(e)}`).join(',\n')}
};

/** [keyword, brandKey] pairs, longest keyword first (so the most specific wins). */
export const BRAND_KEYWORDS: ReadonlyArray<readonly [string, BrandKey]> = [
${keywordPairs.map(([kw, k]) => `  ['${kw}', '${k}']`).join(',\n')}
];
`;

writeFileSync(OUT, body, 'utf8');
console.log(`Wrote ${OUT}`);
console.log(
  `  ${nMark} official marks, ${nLetter} lettermark tiles, ${keywordPairs.length} keywords`
);
if (missingRequested.length) {
  console.log(
    `  NOTE: requested-but-unavailable Simple Icons slugs -> lettermark: ${missingRequested.join(', ')}`
  );
}
