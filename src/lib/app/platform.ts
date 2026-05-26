/**
 * Platform detection for onboarding (US-P1-A / FR-001).
 *
 * iOS Safari evicts non-standalone web storage after ~7 days, so the app must be
 * installed to the home screen (standalone) before we let the user set up. The
 * pure helpers below take their inputs as arguments so they're unit-testable; the
 * exported wrappers read the real browser globals.
 */

/** Pure: is this user-agent iOS Safari (not Chrome/Firefox/Edge/Opera/Google-App on iOS)? */
export function detectIosSafari(userAgent: string, hasTouch: boolean): boolean {
  // iPadOS 13+ reports a desktop "Macintosh" UA but has touch — treat as iOS.
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && hasTouch);
  if (!isIosDevice) return false;
  // On iOS every engine is WebKit, but third-party browsers add their own token.
  const isThirdPartyBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(userAgent);
  return /Safari/.test(userAgent) && !isThirdPartyBrowser;
}

/** Pure: is the app running installed / standalone? */
export function computeStandalone(
  displayModeStandalone: boolean,
  navigatorStandalone: boolean
): boolean {
  return displayModeStandalone || navigatorStandalone;
}

function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function hasTouch(): boolean {
  return typeof document !== 'undefined' && 'ontouchend' in document;
}

export function isIosSafari(): boolean {
  return detectIosSafari(currentUserAgent(), hasTouch());
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayMode =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return computeStandalone(displayMode, navStandalone);
}

/** FR-001: onboarding must block on iOS Safari until the app is installed to the home screen. */
export function needsIosInstall(): boolean {
  return isIosSafari() && !isStandalone();
}
