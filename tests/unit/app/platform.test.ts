import { describe, expect, test } from 'vitest';
import { detectIosSafari, computeStandalone } from '../../../src/lib/app/platform';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('detectIosSafari', () => {
  test('iPhone Safari → true', () => {
    expect(detectIosSafari(IPHONE_SAFARI, true)).toBe(true);
  });
  test('iPhone Chrome (CriOS) → false', () => {
    expect(detectIosSafari(IPHONE_CHROME, true)).toBe(false);
  });
  test('iPadOS masquerading as Mac, with touch → true', () => {
    expect(detectIosSafari(IPAD_DESKTOP_UA, true)).toBe(true);
  });
  test('real Mac desktop (Safari UA, no touch) → false', () => {
    expect(detectIosSafari(IPAD_DESKTOP_UA, false)).toBe(false);
  });
  test('Android Chrome → false', () => {
    expect(detectIosSafari(ANDROID_CHROME, true)).toBe(false);
  });
  test('desktop Chrome → false', () => {
    expect(detectIosSafari(DESKTOP_CHROME, false)).toBe(false);
  });
});

describe('computeStandalone', () => {
  test('display-mode: standalone → true', () => {
    expect(computeStandalone(true, false)).toBe(true);
  });
  test('navigator.standalone (iOS) → true', () => {
    expect(computeStandalone(false, true)).toBe(true);
  });
  test('neither → false (browser tab)', () => {
    expect(computeStandalone(false, false)).toBe(false);
  });
});
