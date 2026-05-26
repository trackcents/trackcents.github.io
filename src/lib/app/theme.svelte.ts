/**
 * Light/dark theme controller (Rocket Money offers light/dark/system; we default
 * to light per the user's request). The choice is reactive ($state) so chart
 * colours that render to canvas can recompute, and persisted to localStorage.
 * Applying a theme toggles the `dark` class on <html>, which flips the CSS tokens
 * defined in app.css.
 */
export type ThemeMode = 'light' | 'dark';

const KEY = 'mtrb.theme';
let mode = $state<ThemeMode>('light');

/** Reactive accessor — read inside components/$derived to track the theme. */
export function themeMode(): ThemeMode {
  return mode;
}

export function applyTheme(next: ThemeMode): void {
  mode = next;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', next === 'dark');
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(KEY, next);
  }
}

/** Read the persisted choice (default light) and apply it. Call once on mount. */
export function initTheme(): void {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(KEY);
  applyTheme(stored === 'dark' ? 'dark' : 'light');
}

export function toggleTheme(): void {
  applyTheme(mode === 'dark' ? 'light' : 'dark');
}
