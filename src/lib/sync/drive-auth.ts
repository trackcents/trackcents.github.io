/**
 * Google Drive authentication via Google Identity Services (GIS), token model.
 *
 * Constitution XIII amendment (2026-05-25): the GIS script is the ONE sanctioned
 * third-party runtime script. It is loaded LAZILY — only on a user-initiated
 * sign-in — and used solely to authorize sync to the user's OWN Drive via the
 * narrow `drive.file` scope (the app can read only files it created).
 *
 * The client ID comes from the public env var PUBLIC_GOOGLE_OAUTH_CLIENT_ID
 * (non-secret; see docs/setup-google-drive.md). When unset, sync is disabled and
 * the app runs local-only.
 */
import { env } from '$env/dynamic/public';

/** The app may only read/write files it itself created in the user's Drive. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_SAFETY_MARGIN_MS = 60_000; // treat a token as expired 60s early

const CLIENT_ID = env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? '';

interface TokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}
interface TokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
  revoke(accessToken: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

// The access token is cached BOTH in memory and in sessionStorage. sessionStorage
// survives a page reload within the same tab — which matters because "Sync now"
// reloads the page after a pull (to render freshly-synced stores), and without
// persistence that reload dropped the in-memory token, so the very next sync had
// to re-prompt the Google account picker EVERY time. With it, the token is reused
// across reloads for its full ~1h lifetime, so the picker only appears on the
// first sign-in (or after the token genuinely expires). Token is short-lived and
// narrow (drive.file); sessionStorage clears it when the tab closes.
const TOKEN_CACHE_KEY = 'mtrb.sync.token';
let cachedToken: CachedToken | null = null;
let gisLoad: Promise<void> | null = null;

function readCachedToken(): CachedToken | null {
  if (cachedToken !== null) return cachedToken;
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TOKEN_CACHE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CachedToken>;
    if (typeof parsed.value === 'string' && typeof parsed.expiresAt === 'number') {
      cachedToken = { value: parsed.value, expiresAt: parsed.expiresAt };
      return cachedToken;
    }
  } catch {
    /* ignore a corrupt/unavailable cache */
  }
  return null;
}

function writeCachedToken(tok: CachedToken): void {
  cachedToken = tok;
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(tok));
  } catch {
    /* best-effort — a quota/private-mode failure just means we re-prompt sooner */
  }
}

function clearCachedToken(): void {
  cachedToken = null;
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a client ID is configured — i.e. Drive sync is available. */
export function isSyncConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

/** The current access token if one is cached and not (nearly) expired; else null. */
export function getAccessToken(): string | null {
  const tok = readCachedToken();
  if (tok && Date.now() < tok.expiresAt) {
    return tok.value;
  }
  return null;
}

function loadGis(): Promise<void> {
  if (gisLoad) return gisLoad;
  gisLoad = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('drive-auth: Google sign-in is only available in the browser'));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('drive-auth: failed to load the Google sign-in script'));
    document.head.appendChild(script);
  });
  return gisLoad;
}

/**
 * Run the GIS token client once.
 *  - `silent: false` → normal interactive flow (account picker / consent popup).
 *  - `silent: true`  → `prompt: ''`, NO popup — succeeds only if the user already
 *    has a Google session AND has previously consented. Guarded with a timeout so
 *    a callback that never fires can't hang the caller.
 */
function runTokenClient(silent: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void (async () => {
      if (!isSyncConfigured()) {
        reject(
          new Error(
            'drive-auth: sync is not configured — set PUBLIC_GOOGLE_OAUTH_CLIENT_ID (see docs/setup-google-drive.md)'
          )
        );
        return;
      }
      try {
        await loadGis();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        reject(new Error('drive-auth: Google sign-in unavailable after script load'));
        return;
      }
      let settled = false;
      const timer = silent
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('drive-auth: silent token request timed out'));
          }, 4000)
        : null;
      const client = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_FILE_SCOPE,
        callback: (response) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (response.error || !response.access_token) {
            reject(
              new Error(`drive-auth: sign-in failed (${response.error ?? 'no token returned'})`)
            );
            return;
          }
          const ttlMs = (response.expires_in ?? 3600) * 1000;
          writeCachedToken({
            value: response.access_token,
            expiresAt: Date.now() + ttlMs - TOKEN_SAFETY_MARGIN_MS
          });
          resolve(response.access_token);
        }
      });
      client.requestAccessToken(silent ? { prompt: '' } : {});
    })();
  });
}

/**
 * Interactive sign-in: shows the Google account picker / consent popup. MUST be
 * called directly from a user gesture (button click) so the popup isn't blocked.
 * Loads the GIS script on first call.
 */
export async function signIn(): Promise<string> {
  return runTokenClient(false);
}

/**
 * Return a usable access token WITHOUT forcing a popup when possible:
 *   1. a cached, unexpired token, else
 *   2. a SILENT refresh (no popup — works once the user has consented), else
 *   3. interactive consent (popup).
 *
 * This is what fixes "Sync now" after a page reload on desktop: the in-memory
 * token is gone, and a consent popup opened mid-async gets blocked by the
 * browser. The silent refresh sidesteps the popup entirely for a signed-in,
 * already-consented user.
 */
export async function ensureToken(): Promise<string> {
  const cached = getAccessToken();
  if (cached !== null) return cached;
  try {
    return await runTokenClient(true);
  } catch {
    return await runTokenClient(false);
  }
}

/** Revoke the current token and clear local auth state. */
export function signOut(): void {
  const token = cachedToken?.value ?? readCachedToken()?.value;
  clearCachedToken();
  if (token) {
    window.google?.accounts?.oauth2?.revoke(token);
  }
}
