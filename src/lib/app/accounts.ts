/**
 * Accounts helper — the union of (a) every account name discovered from
 * imported statements and (b) every account name the user has typed
 * manually in QuickAddSheet, with a "last used" pointer so the form
 * doesn't always default to "Cash".
 *
 * Rationale for being separate from the imports table:
 *
 *   • Bhargav-type users (manual only, no PDF imports) need to ADD their
 *     own accounts ("HDFC UPI", "Wallet", "Office card") and have them
 *     remembered next time.  The imports array won't help him.
 *
 *   • Murali-type users HAVE imported statements but each ImportRecord's
 *     `bank_name` is just the bank (e.g. "Chase") — multiple accounts at
 *     the same bank collapse into one suggestion.  Splitting them out
 *     here lets us surface "Chase Checking 9535" + "Chase CC 3004"
 *     as separate options.
 *
 * Persistence is localStorage (same pattern as favorites.ts) so it's a
 * preference, not synced data.  The accounts list is a derived view: we
 * recompute it on every render from (imports + manualAccountSet).  Only
 * the manual additions and the "last used" pointer persist.
 */

/** The subset of an ImportRecord / ImportSuccess we need.  Loose by
 *  design: both `loadState().imports` (ImportRecord) and `loadImports()`
 *  (ImportSuccess) satisfy this, so the same helper feeds Home and the
 *  Transactions view. */
export interface AccountImportLike {
  bank_name?: string;
  adapter_name?: string;
  statement?: { account_last_4?: string | null };
}

const MANUAL_KEY = 'trackcents.manualAccounts';
const LAST_USED_KEY = 'trackcents.lastAccount';

/** Read manually-added account names. */
export function loadManualAccounts(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(MANUAL_KEY);
  if (raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** Persist (idempotent, de-duped, case-preserving). */
export function saveManualAccounts(names: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const trimmed = n.trim();
    if (trimmed.length === 0) continue;
    const k = trimmed.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(trimmed);
  }
  localStorage.setItem(MANUAL_KEY, JSON.stringify(out));
}

/** Add a name (no-op if already present, case-insensitive). Returns the new list. */
export function rememberManualAccount(name: string): string[] {
  const cur = loadManualAccounts();
  const trimmed = name.trim();
  if (trimmed.length === 0) return cur;
  if (cur.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return cur;
  const next = [...cur, trimmed];
  saveManualAccounts(next);
  return next;
}

/** Drop a name. Returns the new list. */
export function forgetManualAccount(name: string): string[] {
  const cur = loadManualAccounts();
  const next = cur.filter((x) => x.toLowerCase() !== name.toLowerCase());
  if (next.length === cur.length) return cur;
  saveManualAccounts(next);
  return next;
}

/** Read the last-used account name (or null). */
export function loadLastUsedAccount(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const v = localStorage.getItem(LAST_USED_KEY);
  return v !== null && v.trim().length > 0 ? v : null;
}

/** Persist the last-used account. */
export function saveLastUsedAccount(name: string): void {
  if (typeof localStorage === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  localStorage.setItem(LAST_USED_KEY, trimmed);
}

/**
 * The single source of truth for the QuickAddSheet account dropdown:
 * imported accounts (deduped) + manually-added accounts + "Cash" (always
 * available as a fallback wallet).  Sorted with Cash first, then
 * alphabetical so users find their accounts predictably.
 *
 * We surface a richer display name for imports — `<bank> <last-4>` when
 * a last-4 is known — so Murali's two Chase accounts don't collapse to
 * "Chase".  The `manual_entry.account_nickname` already carries this
 * for manual imports (it stores the typed name verbatim).
 */
export function listAllAccounts(imports: readonly AccountImportLike[]): string[] {
  const set = new Map<string, string>(); // lower-case key → display name (first seen)
  function add(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const k = trimmed.toLowerCase();
    if (!set.has(k)) set.set(k, trimmed);
  }
  add('Cash');
  for (const imp of imports) {
    // For real statement imports, prefer "<bank> <last-4>" so different
    // accounts at the same bank are distinguishable.  For manual entries
    // bank_name is whatever the user typed in QuickAddSheet (their
    // "account" field), so use that verbatim.
    const last4 = imp.statement?.account_last_4;
    const isManual = imp.adapter_name === 'manual';
    if (isManual) {
      // For manual imports, the user's chosen account name was stored
      // in bank_name (see makeManualImport in manual-entry.ts).
      if (imp.bank_name) add(imp.bank_name);
    } else if (imp.bank_name) {
      const display =
        last4 !== undefined && last4 !== null && last4 !== ''
          ? `${imp.bank_name} ${last4}`
          : imp.bank_name;
      add(display);
    }
  }
  for (const n of loadManualAccounts()) add(n);
  const items = [...set.values()];
  items.sort((a, b) => {
    if (a === 'Cash') return -1;
    if (b === 'Cash') return 1;
    return a.localeCompare(b);
  });
  return items;
}
