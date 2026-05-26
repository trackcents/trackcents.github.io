// Bank of America credit card adapter (Visa Signature template; covers most
// BofA consumer cards).
//
// Statement quirks:
//   - Account number: "Account # XXXX-XXXX-XXXX-NNNN" (hyphenated, vs Chase's spaces)
//   - Period: "March 13 - April 12, 2026" (long-form months, dash separator)
//   - Section headers: "Payments and Other Credits", "Purchases and Adjustments",
//     "Fees Charged", "Interest Charged"
//   - SIGN QUIRK: negative amounts print the "-" as a SEPARATE PDF text item
//     at a slightly-lower X than the digits.  Example row:
//       y=657  ... 498:"-"  503:"39.99"
//     The adapter joins them into "-39.99" before parseMoney.
//   - Transactions have BOTH Transaction Date and Posting Date columns
//     (we use the Transaction Date as posted_date).

import { ParseError } from '../types';
import type {
  BankAdapter,
  ChecksumLevel,
  ParseResult,
  ParsedStatement,
  ParsedTransaction,
  PdfTextWithPositions,
  SummaryLine,
  TransactionType
} from '../types';
import { parseMoney } from '../../util/money';
import { groupAllRows, rowText, type LayoutRow } from '../_layout/table';

// ── Detection ────────────────────────────────────────────────────────────────
// CRITICAL: the bank name "Bank of America" appears in OTHER banks'
// statements as a transaction descriptor (e.g., Chase Checking shows
// "Bk of Amer Visa Online Pmt" or "Bank of America Payment").  A detect
// regex that just looks for the bank name would false-positive on those.
// We require markers that ONLY appear on BofA's own statement template:
//   - The bankofamerica.com URL (BofA prints it on every page header/footer)
//   - "Visa Signature®" or "Visa Platinum" card brand banners
//   - "New Balance Total" (BofA's specific terminology; other banks use
//     "New Balance" or "Equals New Balance")
// AND an account number formatted as four groups of four (XXXX XXXX XXXX NNNN).
// NOTE: real BofA PDFs use SPACES between groups ("Account# #### #### ####
// ####"), while the local anonymizer's output formats them as hyphens.  We
// accept either to keep both real PDFs and fixtures matching.
const DETECT_URL = /bankofamerica\.com/i;
const DETECT_VISA_BRAND = /\bVisa\s+(?:Signature|Platinum)\b/i;
const DETECT_NEW_BALANCE_TOTAL = /\bNew\s+Balance\s+Total\b/i;
const DETECT_HYPHEN_ACCOUNT = /Account\s*#?\s*XXXX[-\s]XXXX[-\s]XXXX[-\s]\d{4}/i;

function detect(textSample: string): boolean {
  // bankofamerica.com URL is the strongest single signal — it doesn't appear
  // in transaction descriptors anywhere.
  if (DETECT_URL.test(textSample)) return true;
  // Otherwise require a header-specific marker AND the hyphenated account
  // number format together — neither alone is sufficient.
  return (
    (DETECT_VISA_BRAND.test(textSample) || DETECT_NEW_BALANCE_TOTAL.test(textSample)) &&
    DETECT_HYPHEN_ACCOUNT.test(textSample)
  );
}

// ── Account number / period extraction ───────────────────────────────────────
// Real BofA: "Account# #### #### #### 2050" (spaces between groups).
// Anonymized fixtures: "Account # XXXX-XXXX-XXXX-2050" (hyphens between groups).
// Accept either separator between the four groups.
const ACCOUNT_HYPHEN_RE =
  /Account\s*#?\s*(?:X{4}|\d{4})[-\s]+(?:X{4}|\d{4})[-\s]+(?:X{4}|\d{4})[-\s]+(\d{4})/i;
const PAYMENT_DUE_DATE_RE = /Payment\s+Due\s+Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const MIN_PAYMENT_RE =
  /Total\s+Minimum\s+Payment\s+Due\s+\$?\s*((?:\d{1,3}(?:,\d{3})*|\d+)?(?:\.\d{1,2})?)/i;

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

// "March 13 - April 12, 2026" → period_start = 2026-03-13, period_end = 2026-04-12
// Also handles "March 13 - April 12, 2026" with whitespace variations.
const PERIOD_RE = /\b([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/;

interface Period {
  start: string;
  end: string;
  start_year: number;
  end_year: number;
}

function parseLongDate(month: string, day: string, year: string): string | null {
  const idx = MONTH_NAMES.indexOf(month.toLowerCase());
  if (idx < 0) return null;
  return `${year}-${String(idx + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function extractPeriod(flatText: string): Period | null {
  const m = PERIOD_RE.exec(flatText);
  if (!m) return null;
  const year = m[5]!;
  // The year applies to BOTH start and end UNLESS start month > end month
  // (cycle crosses December boundary).  In that case the end year is `year`
  // and start year is `year - 1`.
  const startMonthIdx = MONTH_NAMES.indexOf(m[1]!.toLowerCase());
  const endMonthIdx = MONTH_NAMES.indexOf(m[3]!.toLowerCase());
  if (startMonthIdx < 0 || endMonthIdx < 0) return null;
  const startYear = startMonthIdx > endMonthIdx ? String(parseInt(year, 10) - 1) : year;
  const start = parseLongDate(m[1]!, m[2]!, startYear);
  const end = parseLongDate(m[3]!, m[4]!, year);
  if (start === null || end === null) return null;
  return {
    start,
    end,
    start_year: parseInt(startYear, 10),
    end_year: parseInt(year, 10)
  };
}

function extractAccountLast4(flatText: string): string | null {
  const m = ACCOUNT_HYPHEN_RE.exec(flatText);
  return m && m[1] ? m[1] : null;
}

function extractPaymentDueDate(flatText: string): string | null {
  const m = PAYMENT_DUE_DATE_RE.exec(flatText);
  if (!m || !m[1]) return null;
  try {
    const parts = m[1].split('/');
    if (parts.length !== 3) return null;
    const yy = parts[2]!.length === 2 ? `20${parts[2]}` : parts[2]!;
    return `${yy}-${parts[0]!.padStart(2, '0')}-${parts[1]!.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function extractMinimumPaymentDue(flatText: string): bigint | null {
  const m = MIN_PAYMENT_RE.exec(flatText);
  if (!m || !m[1]) return null;
  try {
    return parseMoney(m[1]);
  } catch {
    return null;
  }
}

// ── Account Summary extraction ───────────────────────────────────────────────
// BofA's Account Summary uses labels like:
//   "Previous Balance"
//   "Payments and Other Credits"
//   "Purchases and Adjustments"
//   "Fees Charged"
//   "Interest Charged"
//   "New Balance Total"
//   "Total Credit Line"
//   "Total Credit Available"
//   "Cash Credit Line"
//   "Portion of Credit Available for Cash"
// Amounts are at x ≈ 240-260 in the summary box.

interface BofaSummary {
  previous_balance: bigint | null;
  payments_other_credits: bigint | null; // absolute
  purchases_adjustments: bigint | null;
  fees_charged: bigint | null;
  interest_charged: bigint | null;
  new_balance: bigint | null;
  credit_limit: bigint | null;
  available_credit: bigint | null;
}

const SUMMARY_LABELS: Record<keyof BofaSummary, RegExp> = {
  previous_balance: /^Previous\s+Balance$/i,
  payments_other_credits: /^Payments\s+and\s+Other\s+Credits$/i,
  purchases_adjustments: /^Purchases\s+and\s+Adjustments$/i,
  fees_charged: /^Fees\s+Charged$/i,
  interest_charged: /^Interest\s+Charged$/i,
  new_balance: /^New\s+Balance\s+Total$/i,
  credit_limit: /^Total\s+Credit\s+Line$/i,
  available_credit: /^Total\s+Credit\s+Available$/i
};

function extractAccountSummary(rows: LayoutRow[]): BofaSummary {
  const out: BofaSummary = {
    previous_balance: null,
    payments_other_credits: null,
    purchases_adjustments: null,
    fees_charged: null,
    interest_charged: null,
    new_balance: null,
    credit_limit: null,
    available_credit: null
  };

  // BofA's Account Summary box has TWO possible cell layouts depending on
  // how the PDF generator emitted glyphs:
  //   (a) label + amount SQUISHED into a single cell at x=36, e.g.
  //       " Previous Balance   $1,234.56"
  //   (b) label cell at x=36 ("Previous Balance"), amount split into
  //       "$" at x≈252 and "1,234.56" at x≈257 in the SAME row.
  //
  // The anonymized JSON fixtures captured layout (a); the real BofA PDFs
  // emit layout (b).  This caused April + May 2026 statements to fail with
  // "could not find Previous Balance or New Balance Total in Account
  // Summary" (bug observed 2026-05-23).  rowText() concatenates all cells
  // in a row with single-space separators and collapses whitespace, which
  // normalizes both layouts to the same string:
  //     "Previous Balance $1,234.56"  →  one regex handles both.
  const labelAmountRe = (labelPattern: RegExp): RegExp =>
    new RegExp(
      `^${labelPattern.source.replace(/^\^|\$$/g, '')}\\s+([-+]?\\$?\\s*-?\\s*[\\d.,]+)$`,
      'i'
    );

  for (const row of rows) {
    const text = rowText(row);
    if (text === '') continue;

    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof BofaSummary>) {
      if (out[key] !== null) continue;
      const re = labelAmountRe(SUMMARY_LABELS[key]);
      const m = re.exec(text);
      if (!m) continue;
      try {
        const signed = parseMoney(m[1]!.replace(/\s+/g, ''));
        const signPreserving = key === 'previous_balance' || key === 'new_balance';
        out[key] = signPreserving ? signed : signed < 0n ? -signed : signed;
      } catch {
        /* leave null and keep scanning */
      }
      break;
    }
  }
  return out;
}

// ── Transaction extraction ───────────────────────────────────────────────────
const MMDD_RE = /^(\d{1,2})\/(\d{1,2})$/;
const PAYMENTS_HDR_RE = /^Payments\s+and\s+Other\s+Credits$/i;
const PURCHASES_HDR_RE = /^Purchases\s+and\s+Adjustments$/i;
const FEES_HDR_RE = /^Fees\s+Charged$/i;
const INTEREST_HDR_RE = /^Interest\s+Charged$/i;
const TRANSACTIONS_END_RE =
  /\b(?:Year-to-Date|Interest\s+Charge\s+Calculation|Important\s+Information|APR\s+Type\s+Definitions)\b/i;
const TOTAL_FOR_PERIOD_RE = /TOTAL\s+(?:PAYMENTS|PURCHASES|FEES|INTEREST)/i;

type Section = 'payments' | 'purchases' | 'fees' | 'interest' | null;

function txnTypeForRow(section: Section): TransactionType {
  switch (section) {
    case 'payments':
      return 'payment_to_card';
    case 'purchases':
      return 'purchase';
    case 'fees':
      return 'fee';
    case 'interest':
      return 'interest';
    default:
      return 'other';
  }
}

function yearForMMDD(mmdd: string, period: Period): string {
  const m = MMDD_RE.exec(mmdd);
  if (!m || !m[1] || !m[2]) {
    throw new ParseError(`bofa-credit-card: invalid MM/DD ${mmdd}`);
  }
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  const monthNum = parseInt(mm, 10);
  if (period.start_year !== period.end_year) {
    const startMonth = parseInt(period.start.slice(5, 7), 10);
    return monthNum >= startMonth
      ? `${period.start_year}-${mm}-${dd}`
      : `${period.end_year}-${mm}-${dd}`;
  }
  return `${period.end_year}-${mm}-${dd}`;
}

export function extractTransactions(rows: LayoutRow[], period: Period): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let section: Section = null;
  let inTransactions = false;

  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    if (!inTransactions) {
      // Wait for the "Transactions" section header (BofA prints "Transactions"
      // as the page header on the transactions page).
      if (/^Transactions$/i.test(text)) {
        inTransactions = true;
      }
      continue;
    }

    if (TRANSACTIONS_END_RE.test(text)) {
      section = null;
      inTransactions = false;
      continue;
    }
    if (TOTAL_FOR_PERIOD_RE.test(text)) continue; // skip subtotal rows

    if (PAYMENTS_HDR_RE.test(text)) {
      section = 'payments';
      continue;
    }
    if (PURCHASES_HDR_RE.test(text)) {
      section = 'purchases';
      continue;
    }
    if (FEES_HDR_RE.test(text)) {
      section = 'fees';
      continue;
    }
    if (INTEREST_HDR_RE.test(text)) {
      section = 'interest';
      continue;
    }
    if (section === null) continue;

    const firstNonEmpty = row.items.find((i) => i.text.trim() !== '');
    if (!firstNonEmpty) continue;
    if (!MMDD_RE.test(firstNonEmpty.text.trim())) continue;

    const dateText = firstNonEmpty.text.trim();

    // Locate the AMOUNT (rightmost money-like item) AND check the item just
    // before it for a "-" sign (BofA's quirky split sign).
    let amountIdx = -1;
    let signIsNegative = false;
    for (let i = row.items.length - 1; i >= 0; i--) {
      const it = row.items[i]!;
      const t = it.text.trim();
      if (t === '') continue;
      if (it.x < 480) continue;
      // Match a bare digit pattern (no $ in BofA's transaction column).
      if (/^[-+]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(t) || /^\.\d{1,2}$/.test(t)) {
        amountIdx = i;
        // Check the immediately-preceding non-empty item for a "-" sign.
        for (let j = i - 1; j >= 0; j--) {
          const prev = row.items[j]!;
          if (prev.text.trim() === '') continue;
          if (prev.text.trim() === '-') {
            signIsNegative = true;
          }
          break;
        }
        break;
      }
    }
    if (amountIdx < 0) continue;

    let printedAmount: bigint;
    try {
      printedAmount = parseMoney(row.items[amountIdx]!.text);
    } catch (err) {
      throw new ParseError(
        `bofa-credit-card: cannot parse amount ${JSON.stringify(
          row.items[amountIdx]!.text
        )} on row dated ${dateText} (${err instanceof Error ? err.message : String(err)})`
      );
    }
    if (signIsNegative && printedAmount > 0n) printedAmount = -printedAmount;

    const description = row.items
      .filter((it, idx) => {
        if (it === firstNonEmpty) return false;
        if (idx === amountIdx) return false;
        const t = it.text.trim();
        // Skip the bare "-" sign item and the per-row Reference Number / Account Number columns.
        if (t === '-') return false;
        if (t.length === 0) return false;
        return true;
      })
      .sort((a, b) => a.x - b.x)
      .map((it) => it.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    transactions.push({
      posted_date: yearForMMDD(dateText, period),
      description,
      raw_text: rowText(row, '\t'),
      // INVERT sign per ParsedTransaction contract.
      amount_minor: -printedAmount,
      currency: 'USD',
      transaction_type: txnTypeForRow(section)
    });
  }
  return transactions;
}

function buildSummaryLines(s: BofaSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null, sign: 1n | -1n = 1n) => {
    if (value === null) return;
    lines.push({ label, amount_minor: sign * value });
  };
  push('Previous Balance', s.previous_balance);
  push('Payments and Other Credits', s.payments_other_credits, -1n);
  push('Purchases and Adjustments', s.purchases_adjustments);
  push('Fees Charged', s.fees_charged);
  push('Interest Charged', s.interest_charged);
  push('New Balance Total', s.new_balance);
  push('Total Credit Line', s.credit_limit);
  push('Total Credit Available', s.available_credit);
  return lines;
}

export const bofaCreditCardAdapter: BankAdapter = {
  name: 'layout-bofa-credit-card',
  version: '0.1.0',
  bank_name: 'Bank of America',
  detect,
  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) throw new ParseError('bofa-credit-card: PDF has no pages');

    const rows = groupAllRows(pdf.pages, 3);
    const flatText = pdf.pages
      .flatMap((p) => p.items.map((i) => i.text))
      .join(' ')
      .replace(/\s+/g, ' ');

    const summary = extractAccountSummary(rows);
    const period = extractPeriod(flatText);
    const last4 = extractAccountLast4(flatText);
    const paymentDueDate = extractPaymentDueDate(flatText);
    const minPayment = extractMinimumPaymentDue(flatText);

    if (period === null) {
      throw new ParseError(
        'bofa-credit-card: could not find statement period (e.g. "March 13 - April 12, 2026")'
      );
    }
    if (summary.previous_balance === null || summary.new_balance === null) {
      throw new ParseError(
        'bofa-credit-card: could not find Previous Balance or New Balance Total in Account Summary'
      );
    }

    const transactions = extractTransactions(rows, period);

    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    const parser_provides: ChecksumLevel[] = ['C'];

    if (transactions.length > 0) {
      parser_provides.push('D');
      const debitFields: Array<bigint | null> = [
        summary.purchases_adjustments,
        summary.fees_charged,
        summary.interest_charged
      ];
      if (debitFields.every((f) => f !== null) && summary.payments_other_credits !== null) {
        total_debits_minor = debitFields.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
        total_credits_minor = summary.payments_other_credits;
        parser_provides.unshift('B');
      }
    }

    const statement: ParsedStatement = {
      account_type: 'credit_card',
      account_last_4: last4,
      period_start: period.start,
      period_end: period.end,
      currency: 'USD',
      opening_balance_minor: null,
      closing_balance_minor: null,
      total_debits_minor,
      total_credits_minor,
      previous_balance_minor: summary.previous_balance,
      statement_balance_minor: summary.new_balance,
      printed_transaction_count: transactions.length > 0 ? transactions.length : null,
      summary_lines: buildSummaryLines(summary),
      payment_due_date: paymentDueDate,
      statement_date: period.end,
      minimum_payment_due_minor: minPayment,
      parser_provides
    };

    return { statement, transactions, suggested_account_nickname: 'BofA Visa' };
  }
};
