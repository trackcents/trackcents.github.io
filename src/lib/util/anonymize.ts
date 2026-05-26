// Statement anonymization — pure function, no I/O.
//
// Used by scripts/anonymize-statement.ts to scrub PII from a real bank statement
// before the user shares the extracted text with the parser developer.
//
// Strategy:
//   - User declares the obvious identifiers via config (full name, address, phone, email).
//     We cannot reliably auto-detect names/addresses; user input is required.
//   - We auto-detect well-known PII patterns: credit-card numbers, SSNs, emails, phones.
//   - We DO NOT touch: dates, transaction amounts, merchant names, or any string
//     that doesn't match a sensitive pattern.
//
// Output is the redacted text PLUS a report listing every redaction made — the user
// reviews the report to confirm nothing leaked through.

export interface AnonymizeConfig {
  /** Full account-holder name(s) to redact, e.g. "John Smith". Case-insensitive. */
  names?: string[];
  /** Address fragments to redact, e.g. "123 Main St". Case-insensitive. */
  addresses?: string[];
  /** Specific phone numbers to redact (auto-detection also catches common formats). */
  phones?: string[];
  /** Specific email addresses to redact. */
  emails?: string[];
  /** When redacting account numbers, keep this many trailing digits (default 4). */
  keep_last_n_digits?: number;
  /** Disable auto-detection of common patterns (default: enabled). */
  disable_auto_detect?: boolean;
}

export interface Redaction {
  /** What was redacted (e.g. "name", "phone", "credit_card_number"). */
  category: string;
  /** Original (sensitive) text that was found.  Not included in the safe output. */
  original: string;
  /** Replacement text that appears in the redacted output. */
  replacement: string;
  /** Approximate offset in the source text (for human review only). */
  offset: number;
}

export interface AnonymizeResult {
  /** The redacted text.  Safe to share. */
  redacted: string;
  /** Every redaction performed, in order of first occurrence. */
  redactions: Redaction[];
}

// ── Auto-detect patterns ────────────────────────────────────────────────────
//
// Tuned to be specific enough to avoid false-positive redaction of merchant
// names or transaction amounts.  False negatives (missed PII) are caught by
// the user reviewing the output; false positives (over-redaction) would hide
// legitimate data the parser needs.

// 16-digit numbers in CC formats (groups of 4 with optional separators).
// Anchored to non-digit boundaries so "transaction 1234567890123456789"
// (18 digits) does NOT match.
const CC_RE = /(?<![\d-])\b(\d{4})[ -]?(\d{4})[ -]?(\d{4})[ -]?(\d{4})\b(?![\d-])/g;

// 9- to 12-digit standalone account numbers (avoiding overlap with phones / CCs / amounts).
// Matches when the number is on a line that LOOKS like an account number declaration:
//   "Account Number: 123456789", "Acct No. 123456789", "A/C # 123456789", "Account 123456789"
const ACCOUNT_NUM_RE = /\b(?:Account|Acct\.?|A\/C)\s*(?:Number|No\.?|#)?\s*[#:]?\s*(\d{9,12})\b/gi;

// US SSN format
const SSN_RE = /\b(\d{3})-(\d{2})-(\d{4})\b/g;

// Email addresses
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// US phone numbers — covers (###) ###-####, ###-###-####, ###.###.####, +1 ### ### ####
// Trailing lookahead allows a period (sentence punctuation) but rejects digits and
// dashes (which would mean this is part of a longer reference number, not a phone).
const PHONE_RE =
  /(?<![\d.-])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d-])/g;

// ── Main API ────────────────────────────────────────────────────────────────

export function anonymize(text: string, config: AnonymizeConfig = {}): AnonymizeResult {
  const keepLast = config.keep_last_n_digits ?? 4;
  const redactions: Redaction[] = [];
  let working = text;

  // 1. User-declared names (whole-word match, case insensitive, longest first).
  for (const name of (config.names ?? []).sort((a, b) => b.length - a.length)) {
    const re = wholeWordRegex(name);
    working = working.replace(re, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      redactions.push({ category: 'name', original: match, replacement: 'ACCOUNT HOLDER', offset });
      return 'ACCOUNT HOLDER';
    });
  }

  // 2. User-declared addresses (case insensitive).
  for (const address of (config.addresses ?? []).sort((a, b) => b.length - a.length)) {
    const re = literalRegex(address, 'gi');
    working = working.replace(re, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      redactions.push({
        category: 'address',
        original: match,
        replacement: 'ADDRESS REDACTED',
        offset
      });
      return 'ADDRESS REDACTED';
    });
  }

  // 3. User-declared phones (literal match).
  for (const phone of config.phones ?? []) {
    const re = literalRegex(phone, 'g');
    working = working.replace(re, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      redactions.push({
        category: 'phone',
        original: match,
        replacement: 'PHONE REDACTED',
        offset
      });
      return 'PHONE REDACTED';
    });
  }

  // 4. User-declared emails.
  for (const email of config.emails ?? []) {
    const re = literalRegex(email, 'gi');
    working = working.replace(re, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      redactions.push({
        category: 'email',
        original: match,
        replacement: 'EMAIL REDACTED',
        offset
      });
      return 'EMAIL REDACTED';
    });
  }

  if (config.disable_auto_detect !== true) {
    // 5. Credit-card-style 16-digit numbers — preserve last `keepLast` digits.
    working = working.replace(CC_RE, (match, g1, g2, g3, g4, offset: number) => {
      const last4 = String(g4);
      const replacement =
        keepLast >= 4
          ? `XXXX-XXXX-XXXX-${last4}`
          : keepLast === 0
            ? 'CARD NUMBER REDACTED'
            : `XXXX-XXXX-XXXX-XXX${last4.slice(-keepLast)}`;
      redactions.push({
        category: 'credit_card_number',
        original: match,
        replacement,
        offset
      });
      return replacement;
    });

    // 6. Account-number declarations ("Account Number: 123456789").
    working = working.replace(ACCOUNT_NUM_RE, (match, num: string, offset: number) => {
      // Clamp keepLast into [0, num.length]. Without the clamp, keepLast===0 made
      // `num.slice(-0)` return the WHOLE number (privacy LEAK — it'd be appended
      // after the X's), and keepLast>length made `'X'.repeat(negative)` THROW.
      const eff = Math.min(Math.max(keepLast, 0), num.length);
      const last = eff > 0 ? num.slice(-eff) : '';
      const masked = 'X'.repeat(num.length - eff) + last;
      const replacement = match.replace(num, masked);
      redactions.push({
        category: 'account_number',
        original: match,
        replacement,
        offset
      });
      return replacement;
    });

    // 7. SSNs.
    working = working.replace(SSN_RE, (match, _a, _b, _c, offset: number) => {
      redactions.push({
        category: 'ssn',
        original: match,
        replacement: 'SSN REDACTED',
        offset
      });
      return 'SSN REDACTED';
    });

    // 8. Emails (auto-detect, in addition to declared ones).
    working = working.replace(EMAIL_RE, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      // Skip already-redacted markers if any.
      if (match === 'EMAIL') return match;
      redactions.push({
        category: 'email_auto',
        original: match,
        replacement: 'EMAIL REDACTED',
        offset
      });
      return 'EMAIL REDACTED';
    });

    // 9. Phones (auto-detect).
    working = working.replace(PHONE_RE, (match, _a, _b, _c, offset: number) => {
      redactions.push({
        category: 'phone_auto',
        original: match,
        replacement: 'PHONE REDACTED',
        offset
      });
      return 'PHONE REDACTED';
    });
  }

  // Sort redactions by first-occurrence offset for the report.
  redactions.sort((a, b) => a.offset - b.offset);

  return { redacted: working, redactions };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a case-insensitive regex that matches the literal phrase as whole word(s).
 * Used for name matching where "Smith" should match "Smith" but not "Blacksmith".
 */
function wholeWordRegex(phrase: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(phrase)}(?![A-Za-z0-9])`, 'gi');
}

/**
 * Build a regex from a literal string (escaping regex metacharacters).
 */
function literalRegex(s: string, flags: string): RegExp {
  return new RegExp(escapeRegex(s), flags);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Quick summary string for the user (shown at the top of the review file).
 */
export function summarizeRedactions(redactions: Redaction[]): string {
  if (redactions.length === 0) {
    return 'No redactions made.\n\n⚠️  This could mean either: (a) the statement contains no detectable PII, or (b) the PII format was not recognized.  Review the output carefully before sharing.';
  }
  const counts: Record<string, number> = {};
  for (const r of redactions) {
    counts[r.category] = (counts[r.category] ?? 0) + 1;
  }
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `  ${cat.padEnd(24)} ${n}`);
  return `${redactions.length} redaction${redactions.length === 1 ? '' : 's'} made:\n${lines.join('\n')}`;
}
