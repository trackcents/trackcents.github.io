/**
 * Per-account nicknames — Hemanth's ask: "as you are selecting the account
 * type as credit card, bank name + last 4 digits right, I should have the
 * option to add some nicknames on top of that so I will know instead of
 * remembering the card numbers, but the original name with last-4 also has
 * to be there but not visible directly."
 *
 * Pattern: the raw account key (e.g. "Chase Checking 9535" or "BofA 2050")
 * remains the canonical key everywhere in the data layer — it's what
 * import records and annotations reference.  This module ADDS a nickname
 * map on top:
 *
 *   raw="Chase Checking 9535"  →  nickname="Main checking"
 *
 * UI calls `accountDisplayName(raw)` and gets the nickname if one exists,
 * else the raw name.  The raw name is still available as secondary text
 * ("Chase Checking 9535") so the user never loses sight of which card it
 * actually is.
 *
 * Storage = localStorage (preference, not synced).  The map survives
 * across reloads but is per-device until the synced blob lands in Phase
 * 2.  Note: Cash is a sentinel — renaming it would conflict with default
 * fallbacks, so we reject the nickname for the raw name "Cash".
 */

const KEY = 'trackcents.accountNicknames';
const RESERVED_RAW = new Set(['Cash', 'Income', 'Transfer']);

type NicknameMap = Record<string, string>;

function read(): NicknameMap {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem(KEY);
  if (raw === null || raw === '') return {};
  try {
    const p = JSON.parse(raw);
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return {};
    const out: NicknameMap = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim().length > 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(map: NicknameMap): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

/** Return the user-set nickname for a raw account name, or null. */
export function getAccountNickname(rawName: string): string | null {
  const m = read();
  return m[rawName] ?? null;
}

/** Set / update a nickname.  Empty nickname removes the entry. */
export function setAccountNickname(rawName: string, nickname: string): void {
  if (RESERVED_RAW.has(rawName)) return;
  const m = read();
  const trimmed = nickname.trim();
  if (trimmed.length === 0) {
    delete m[rawName];
  } else {
    m[rawName] = trimmed;
  }
  write(m);
}

/** Drop a nickname (used when a manual account is deleted). */
export function clearAccountNickname(rawName: string): void {
  const m = read();
  if (delete m[rawName]) write(m);
}

/** What to display in UI for a raw account name.  Returns the nickname when
 *  one exists, else the raw name unchanged.  Pure besides the localStorage
 *  read — callers can $derive it. */
export function accountDisplayName(rawName: string): string {
  return getAccountNickname(rawName) ?? rawName;
}

/** Snapshot the entire nickname map (for derived $state in components). */
export function loadAllNicknames(): NicknameMap {
  return read();
}
