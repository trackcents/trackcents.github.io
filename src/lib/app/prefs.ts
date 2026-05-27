// Non-sensitive user preferences (no statement data) — stored UNENCRYPTED in
// localStorage so they can be applied synchronously at app start, before any
// money is rendered. Sensitive financial data lives only in the encrypted store.
import { setDisplayCurrency } from '$lib/util/money';

export type CurrencyCode = 'USD' | 'INR';

export interface Prefs {
  currency: CurrencyCode;
}

export const CURRENCIES: ReadonlyArray<{ code: CurrencyCode; symbol: string; label: string }> = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' }
];

const KEY = 'trackcents.prefs';
const DEFAULT_PREFS: Prefs = { currency: 'USD' };

export function loadPrefs(): Prefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { currency: parsed.currency === 'INR' ? 'INR' : 'USD' };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private-mode write errors — prefs are best-effort */
  }
}

/** Apply saved prefs to runtime state (display currency). Call once at app start. */
export function applyPrefs(): Prefs {
  const p = loadPrefs();
  setDisplayCurrency(p.currency);
  return p;
}

/** Set the display currency and persist it. */
export function setCurrencyPref(code: CurrencyCode): void {
  const p = loadPrefs();
  p.currency = code;
  savePrefs(p);
  setDisplayCurrency(code);
}
