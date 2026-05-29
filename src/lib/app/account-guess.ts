/**
 * Best-effort account (payment-method) guesser for the quick-add flow.
 *
 * Hemanth's ask (2026-05-29): "account should also fill as I type ... I will
 * add the types of payments and next time if I type them then it should fill
 * it, instead of me manually selecting it."
 *
 * So as the user types a description, if it mentions one of their saved
 * accounts — by full name ("hdfc upi") or a distinctive word of it ("hdfc",
 * "chase") — we auto-fill the Account field. The "learning" is simply that the
 * match set IS the user's own account list: every account they add becomes
 * matchable next time, mirroring how `guessCategoryId` learns from their rules.
 *
 * Pure / on-device / deterministic. It is a SUGGESTION the user can override —
 * the form's `userTouchedAccount` flag wins once they pick manually, exactly
 * like amount/date/category.
 */

/**
 * Words common to many account names; on their own they must NOT decide which
 * account matched (otherwise "card" / "upi" / "bank" would be ambiguous across
 * "HDFC UPI", "ICICI UPI", "Amex Card", …). They are only excluded from the
 * DISTINCTIVE-WORD pass; a full account name that happens to equal one of these
 * (e.g. the "Cash" wallet) still matches via the whole-name pass.
 */
const GENERIC_ACCOUNT_WORDS: ReadonlySet<string> = new Set([
  'cash',
  'card',
  'account',
  'acct',
  'bank',
  'credit',
  'debit',
  'checking',
  'chequing',
  'savings',
  'saving',
  'current',
  'wallet',
  'upi',
  'pay',
  'online',
  'the',
  'my'
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `token` appear as a whole word inside `text` (case-insensitive)?
 *  Word boundary is "not a letter or digit", so "cash" does NOT match inside
 *  "cashback", and "hdfc" matches in "450 hdfc" and "hdfc-upi". */
function containsWord(text: string, token: string): boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}(?:$|[^a-z0-9])`, 'i');
  return re.test(text);
}

/**
 * Guess which of the user's accounts a description refers to.
 *
 * Strategy (most-specific wins — longest matched token):
 *   1. The WHOLE account name appears as a word (e.g. typed "hdfc upi").
 *   2. A DISTINCTIVE word of the account name appears (e.g. "hdfc" from
 *      "HDFC UPI", "chase" from "Chase Checking 9535"), skipping generic
 *      banking words and pure-number tokens (last-4s) to avoid false hits.
 *
 * @returns the matched account's display name (verbatim from `accounts`), or
 *          null when nothing matches.
 */
export function guessAccount(description: string, accounts: readonly string[]): string | null {
  const desc = description.trim().toLowerCase();
  if (desc.length === 0) return null;

  let best: string | null = null;
  let bestLen = 0;

  for (const acc of accounts) {
    const name = acc.trim();
    if (name.length === 0) continue;

    // 1. Whole account name as a word — strongest signal.
    if (name.length >= 2 && containsWord(desc, name) && name.length > bestLen) {
      best = acc;
      bestLen = name.length;
      continue;
    }

    // 2. A distinctive (non-generic, non-numeric, >=3 char) word of the name.
    for (const word of name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0)) {
      if (word.length < 3) continue;
      if (GENERIC_ACCOUNT_WORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      if (containsWord(desc, word) && word.length > bestLen) {
        best = acc;
        bestLen = word.length;
      }
    }
  }

  return best;
}
