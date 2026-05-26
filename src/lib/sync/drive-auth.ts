/**
 * Google Drive authentication via Google Identity Services (GIS), token model.
 *
 * Constitution XIII amendment (2026-05-25): the GIS script is the ONE sanctioned
 * third-party runtime script. It is loaded LAZILY — only on a user-initiated
 * sign-in — and used solely to authorize sync to the user's OWN Drive via the
 * narrow `drive.file` scope. The synced blob is client-side-encrypted, so this
 * never exposes plaintext to Google.
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

let cachedToken: { value: string; expiresAt: number } | null = null;
let gisLoad: Promise<void> | null = null;

/** True when a client ID is configured — i.e. Drive sync is available. */
export function isSyncConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

/** The current access token if one is cached and not (nearly) expired; else null. */
export function getAccessToken(): string | null {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
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
 * Prompt the user to sign in and authorize Drive. Resolves with a short-lived
 * access token (also cached via getAccessToken until shortly before it expires).
 * Loads the GIS script on first call — user-initiated only.
 */
export async function signIn(): Promise<string> {
  if (!isSyncConfigured()) {
    throw new Error(
      'drive-auth: sync is not configured — set PUBLIC_GOOGLE_OAUTH_CLIENT_ID (see docs/setup-google-drive.md)'
    );
  }
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('drive-auth: Google sign-in unavailable after script load');
  }
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(`drive-auth: sign-in failed (${response.error ?? 'no token returned'})`)
          );
          return;
        }
        const ttlMs = (response.expires_in ?? 3600) * 1000;
        cachedToken = {
          value: response.access_token,
          expiresAt: Date.now() + ttlMs - TOKEN_SAFETY_MARGIN_MS
        };
        resolve(response.access_token);
      }
    });
    client.requestAccessToken();
  });
}

/** Revoke the current token and clear local auth state. */
export function signOut(): void {
  const token = cachedToken?.value;
  cachedToken = null;
  if (token) {
    window.google?.accounts?.oauth2?.revoke(token);
  }
}
