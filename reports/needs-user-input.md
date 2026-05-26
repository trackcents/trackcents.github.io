# Items deferred because they need you (the architect/tester)

> Running list for the away-session. Everything here is BLOCKED on a human decision
> or a live device/account I can't drive from code. I'll keep building everything
> that ISN'T blocked and tick these off with you when you're back.
> Last updated: 2026-05-25.

## Needs you to TEST (code is written, correctness needs a real browser/account)

1. **Live Google Drive sync round-trip (T154).** `src/lib/sync/drive-blob.ts` type-checks and
   follows the Drive v3 REST contract, but the live path (GIS consent popup → real Drive
   upload/download → two-device round-trip) can only be verified in a browser with your signed-in
   Google account. **Test:** sign in on two devices, import on one, sync, confirm it appears on the
   other. I cannot do this offline.

2. **Checkpoint / restore via Drive version history (when built).** Listing and restoring prior
   `vault.bin` revisions is a live Drive API call — code is testable in unit form with a mock, but
   the real "roll back 3 days" action needs your browser + account to confirm.

## Needs you to TEST (continued)

6. **Browser smoke-test of the new P2 screens.** `/dashboard` (charts + click-a-slice drill-down),
   `/categories` (rules + apply), per-row category picker on `/transactions`, and `/budget`
   (paycheck windows) all pass type-check + build + unit tests, but I can't click through them
   from here. When convenient, run the app (`pnpm dev`) and eyeball them with a real imported
   statement. The money math behind the dashboard is independently IV&V-signed-off; this is a
   UI/interaction smoke check, not a correctness gate.

## Needs a DECISION from you (product/design, only you can choose)

3. **Recovery code (T115).** Constitution X allows an OPTIONAL passphrase-recovery code. Implementing
   it correctly means switching the crypto model to envelope encryption (a random data key wrapped by
   BOTH the passphrase-derived key AND a recovery-code-derived key). That's a change to the
   already-IV&V-signed-off P0 crypto path, so it should go through deliberate design + a fresh IV&V
   pass — not a blind edit. **Decision needed:** do you want recovery codes in v1, and accept the
   crypto-model change? (My recommendation: defer to a dedicated, planned task.)

4. **Real app icon / logo.** The PWA icons (`static/icons/*.png`) are generated placeholders. Replace
   with real artwork when you have it. (Not blocking; cosmetic.)

5. **v1.1 editable-field conflict UI.** Once categories/notes become editable (US-P2-A), two devices
   editing the SAME field is a true conflict. Plan is per-field last-write-wins + a "you both changed
   this — pick one" prompt (OneNote-style). The prompt UI + the LWW timestamp columns are a v1.1
   design item. (v1 has no editable fields, so nothing is blocked today.)

## Resolved with you already (for the record)

- **Sync conflict model (IV&V finding A1):** you chose **merge/union** (OneNote/Simplenote model) —
  done in code (`src/lib/sync/merge.ts`); a pull now unions instead of overwriting, so no unsynced
  import is ever lost.
- **Checkpoints:** use **Drive's built-in version history**, and only create a checkpoint when content
  actually changed (no redundant restore points) — the "skip push when unchanged" logic is in.
