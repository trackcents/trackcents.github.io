/**
 * Favorite categories — small localStorage helper.
 *
 * Lets the user star categories they use most so the category picker shows
 * them at the top.  No sync (this is preference, not data) — same pattern as
 * `prefs.ts` and the biweekly-banner dismiss flag.
 */

const KEY = 'trackcents.favCats';

/** Read the user's favorite category IDs from localStorage.  Returns [] when
 *  absent, malformed, or running on the server. */
export function loadFavoriteCategoryIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(KEY);
  if (raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Persist the favorite category IDs.  Idempotent. */
export function saveFavoriteCategoryIds(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  // De-dupe + preserve order (first-seen wins).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  localStorage.setItem(KEY, JSON.stringify(out));
}

/** Add `id` to favorites (no-op if already present). Returns the new list. */
export function favoriteCategory(id: string): string[] {
  const cur = loadFavoriteCategoryIds();
  if (cur.includes(id)) return cur;
  const next = [...cur, id];
  saveFavoriteCategoryIds(next);
  return next;
}

/** Remove `id` from favorites (no-op if absent). Returns the new list. */
export function unfavoriteCategory(id: string): string[] {
  const cur = loadFavoriteCategoryIds();
  const next = cur.filter((x) => x !== id);
  if (next.length === cur.length) return cur;
  saveFavoriteCategoryIds(next);
  return next;
}

/** Convenience: toggle. Returns the new list. */
export function toggleFavoriteCategory(id: string): string[] {
  const cur = loadFavoriteCategoryIds();
  return cur.includes(id) ? unfavoriteCategory(id) : favoriteCategory(id);
}
