/**
 * Keyboard-inset tracker — Hemanth's ask: "when I want to search or add new
 * category if I type there, the keyboard is opening and that popup is not
 * moving above, so I have to minimize the keyboard and then click on save.
 * See what other standard apps solves this and add the same for us."
 *
 * The problem is well-known on mobile web: a `position: fixed; bottom: 0`
 * bottom-sheet is anchored to the LAYOUT viewport, which doesn't shrink
 * when the soft keyboard opens.  The visible viewport DOES shrink, so the
 * sheet ends up hidden under the keyboard.
 *
 * Standard solutions:
 *   1. iOS Safari 17+: CSS `env(keyboard-inset-height)` ← only Safari iOS
 *   2. Android Chrome: `visualViewport.height` shrinks ← all WebKit/Blink
 *   3. Older browsers: nothing reliable.
 *
 * This module exposes the keyboard inset as a CSS variable
 * `--kb-inset-bottom` on `<html>`, updated live from the visualViewport
 * API.  Components then anchor with:
 *
 *    .sheet {
 *      position: fixed;
 *      inset-inline: 0;
 *      bottom: var(--kb-inset-bottom, 0px);
 *      max-height: calc(100dvh - var(--kb-inset-bottom, 0px) - 24px);
 *    }
 *
 * Pattern modelled on Slack/WhatsApp web — both use the same visualViewport
 * resize-listener trick.  Call `installKeyboardInsetTracker()` once at app
 * mount (from +layout.svelte's onMount).
 */

let installed = false;

export function installKeyboardInsetTracker(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const vv = window.visualViewport;
  if (!vv) {
    // Older browser — no live keyboard tracking.  Sheets will fall back
    // to bottom: 0 which is acceptable on desktop / iPad sidecar.
    return;
  }
  installed = true;
  const root = document.documentElement;
  function update(): void {
    if (!window.visualViewport) return;
    // Difference between the layout viewport (innerHeight) and the visual
    // viewport (visualViewport.height) ≈ the part covered by the keyboard
    // (plus tiny browser chrome on some Android skins).  Clamp at 0 so
    // pull-to-refresh overscroll doesn't push the sheet up.
    const inset = Math.max(0, window.innerHeight - window.visualViewport.height);
    root.style.setProperty('--kb-inset-bottom', `${inset}px`);
  }
  // Fire once so the variable exists from the start.
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Note: we deliberately don't expose an uninstall — the listener is
  // cheap and the app is a single page.  If a future flow needs to stop
  // it, refactor here.
}
