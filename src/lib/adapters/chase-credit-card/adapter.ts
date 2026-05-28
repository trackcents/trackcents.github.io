// Chase Credit Card adapter.
//
// Supports the modern Chase credit-card statement layout used by Sapphire
// Preferred (and similar Chase Travel cards) and the Amazon Prime Visa.
//
// Statement anatomy (4 pages typical, sometimes 2 or 3):
//   Page 1   ACCOUNT SUMMARY box (top-left), payment coupon (bottom)
//   Page 2   Legal / disclosures text — no transactions
//   Page 3+  ACCOUNT ACTIVITY table with PAYMENTS AND OTHER CREDITS, PURCHASE,
//            FEES CHARGED, INTEREST CHARGES sub-sections
//
// v0.1.0 — Account Summary only (Chase's public marketing PDF had no transactions).
// v0.2.0 — Adds transaction-listing parsing. Levels B + C populated.

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
// PDF.js emits text in many small items; once we join them with a single
// space, neighboring word-items can produce "Chase  Card  Services" (two
// spaces).  All detector regexes therefore use \s+ between words, never
// a literal single space.
const DETECT_PRIMARY = /Chase\s+Card\s+Services/i;
const DETECT_FALLBACK_BANK = /\bChase\b/i;
const DETECT_FALLBACK_FIELDS = /ACCOUNT\s+SUMMARY[\s\S]+Credit\s+(?:Limit|Access\s+Line)/i;
// Chase credit-card statements also reliably include "chase.com/cardhelp"
// (Sapphire) or "chase.com/amazon" (Amazon Prime Visa) in the header band.
const DETECT_FALLBACK_URL = /chase\.com\/(?:cardhelp|amazon|paycard)/i;

function detect(textSample: string): boolean {
  if (DETECT_PRIMARY.test(textSample)) return true;
  if (DETECT_FALLBACK_URL.test(textSample)) return true;
  return DETECT_FALLBACK_BANK.test(textSample) && DETECT_FALLBACK_FIELDS.test(textSample);
}

// ── Account-summary field extraction ─────────────────────────────────────────

interface ParsedSummary {
  previous_balance: bigint | null;
  payments_credits: bigint | null; // absolute value; bank prints "-$X"
  purchases: bigint | null;
  cash_advances: bigint | null;
  balance_transfers: bigint | null;
  fees: bigint | null;
  interest: bigint | null;
  new_balance: bigint | null;
  credit_limit: bigint | null;
  available_credit: bigint | null;
}

const SUMMARY_LABELS: Record<keyof ParsedSummary, RegExp> = {
  previous_balance: /^Previous Balance$/i,
  payments_credits: /^Payment,?\s*Credits?$/i,
  purchases: /^Purchases$/i,
  cash_advances: /^Cash Advances$/i,
  balance_transfers: /^Balance Transfers$/i,
  fees: /^Fees Charged$/i,
  interest: /^Interest Charged$/i,
  new_balance: /^New Balance$/i,
  credit_limit: /^(?:Credit Limit|Credit Access Line)$/i,
  available_credit: /^Available Credit$/i
};

function extractSummary(rows: LayoutRow[]): ParsedSummary {
  const summary: ParsedSummary = {
    previous_balance: null,
    payments_credits: null,
    purchases: null,
    cash_advances: null,
    balance_transfers: null,
    fees: null,
    interest: null,
    new_balance: null,
    credit_limit: null,
    available_credit: null
  };

  // ── Primary pass: label and value on the SAME layout row ─────────────────
  for (const row of rows) {
    const cells = row.items.map((i) => i.text.trim()).filter((s) => s.length > 0);
    if (cells.length < 2) continue;

    const moneyIdx = cells.findIndex((c) => /^[-+]?\s*\$/.test(c) || /^[-+]?\s*\$?-?\d/.test(c));
    if (moneyIdx < 1) continue;

    const label = cells.slice(0, moneyIdx).join(' ').replace(/\s+/g, ' ').trim();
    // Take ONLY the matched money cell.  The previous slice+join glued the
    // right-column body text on (e.g. "Cardmembers earn unlimited 5% back…"
    // on the same Y as Previous Balance / Cash Advances / Fees Charged in
    // Chase Prime Visa statements), turning "$931.01" into
    // "$931.01status,signintotheAmazonaccount…" which parseMoney throws on
    // and left those fields null → Account Summary refused → import refused.
    // PDF.js already represents the value as a single item; concatenation
    // was never needed.  Investigation showed Statements-9 and -11 both fail
    // here, never in the stacked fallback below.
    const moneyText = cells[moneyIdx]!.replace(/\s+/g, '');

    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof ParsedSummary>) {
      if (!SUMMARY_LABELS[key].test(label)) continue;
      try {
        // parseMoney handles leading "-" and "(…)" as negative; only "+"
        // needs stripping first (parseMoney rejects it).
        const cleaned = moneyText.replace(/^\+\s*/, '');
        const signed = parseMoney(cleaned);
        // Previous Balance and New Balance carry intrinsic sign:
        //   positive = user owes the bank (debt)
        //   negative = bank owes the user (credit balance, e.g. after a refund)
        // The Level C balance equation NEEDS that sign — discarding it caused
        // the v0.2.0 bug where statements following a credit balance failed
        // checksum by 2× |previous|.
        //
        // Other fields (Purchases, Payments, Cash Advances, Fees, Interest,
        // Balance Transfers) carry directional sign in print but represent
        // absolute contribution amounts to the balance equation — store abs.
        const signPreserving = key === 'previous_balance' || key === 'new_balance';
        summary[key] = signPreserving ? signed : signed < 0n ? -signed : signed;
      } catch {
        // leave as null; gate flags the gap
      }
      break;
    }
  }

  // ── Fallback pass: the "stacked" Account Summary layout (REQ-B2.1) ──────
  //
  // Some Chase Prime Visa statement variants (e.g. Statements-9 / Statements-11
  // from temp3) lay the Account Summary out as a vertical LABEL column followed
  // by a vertical VALUE column.  PDF.js then groups each label and each value
  // on its OWN layout row — every row has only ONE cell, so the primary pass
  // skips them all (`cells.length < 2`) and we end up with Previous Balance =
  // New Balance = null and the import fails.
  //
  // To recover: walk the rows after the "ACCOUNT SUMMARY" header, classify
  // each one as either a label match (against SUMMARY_LABELS), a money-shaped
  // value, or neither (date / blank).  Then pair labels[i] with values[i] in
  // source order.  Anything the primary pass already filled is left alone.
  if (summary.previous_balance === null || summary.new_balance === null) {
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const t = rowText(rows[i]!).trim();
      // Word-boundary not end-anchor: real Chase statements lay body text
      // alongside the "ACCOUNT SUMMARY" header on the SAME Y, so the row's
      // joined text ends up "ACCOUNT SUMMARY Cardmembers earn unlimited…".
      // The previous /^ACCOUNT\s+SUMMARY$/i never matched and the fallback
      // silently did nothing — the real PDFs failed both passes.
      if (/^ACCOUNT\s+SUMMARY\b/i.test(t)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) {
      const labelsSeq: Array<keyof ParsedSummary> = [];
      const valuesSeq: string[] = [];
      // Money-shaped: optional sign, optional $, at least one digit.
      // We accept "$931.01", "-$1,453.31", "+$382.95", "$35,000", "$0.00", ".50".
      const MONEY_LIKE = /^[-+]?\s*\$\s*-?\s*[0-9.,]+$|^[-+]?\s*\.\d{1,2}$|^-\s*\$\s*[0-9.,]+$/;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const t = rowText(rows[i]!).trim().replace(/\s+/g, ' ');
        if (t === '') continue;
        let matched = false;
        for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof ParsedSummary>) {
          if (SUMMARY_LABELS[key].test(t)) {
            labelsSeq.push(key);
            matched = true;
            break;
          }
        }
        if (matched) continue;
        if (MONEY_LIKE.test(t.replace(/\s+/g, ''))) {
          valuesSeq.push(t.replace(/\s+/g, ''));
        }
      }
      for (let i = 0; i < Math.min(labelsSeq.length, valuesSeq.length); i++) {
        const key = labelsSeq[i]!;
        if (summary[key] !== null) continue;
        try {
          const cleaned = valuesSeq[i]!.replace(/^\+\s*/, '');
          const signed = parseMoney(cleaned);
          const signPreserving = key === 'previous_balance' || key === 'new_balance';
          summary[key] = signPreserving ? signed : signed < 0n ? -signed : signed;
        } catch {
          /* skip */
        }
      }
    }
  }

  return summary;
}

// ── Statement period / account number / due-date / minimum payment ──────────
const PERIOD_RE = /Opening\/Closing Date\s+(\d{2}\/\d{2}\/\d{2,4})\s*-\s*(\d{2}\/\d{2}\/\d{2,4})/i;
const ACCOUNT_NUMBER_RE = /Account Number:\s*X{4}\s*X{4}\s*X{4}\s*(\d{4})/i;
const PAYMENT_DUE_DATE_RE = /Payment\s+Due\s+Date:?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
// Minimum payment may print as "$X.XX", "$X", or sub-$1 ".XX".  Allow all.
const MIN_PAYMENT_DUE_RE =
  /Minimum\s+Payment\s+Due:?\s+\$?\s*((?:\d{1,3}(?:,\d{3})*|\d+)?(?:\.\d{1,2})?)/i;
const STATEMENT_DATE_RE = /Statement\s+Date:?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;

interface Period {
  start: string;
  end: string;
  start_year: number;
  end_year: number;
}

function extractPeriod(allText: string): Period | null {
  const m = PERIOD_RE.exec(allText);
  if (!m || !m[1] || !m[2]) return null;
  const start = normalize(m[1]);
  const end = normalize(m[2]);
  return {
    start,
    end,
    start_year: parseInt(start.slice(0, 4), 10),
    end_year: parseInt(end.slice(0, 4), 10)
  };
}

function normalize(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new ParseError(`chase-credit-card: cannot normalize date ${date}`);
  }
  const mm = parts[0].padStart(2, '0');
  const dd = parts[1].padStart(2, '0');
  const yyRaw = parts[2];
  const yyyy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${yyyy}-${mm}-${dd}`;
}

function extractAccountLast4(text: string): string | null {
  const m = ACCOUNT_NUMBER_RE.exec(text);
  return m && m[1] ? m[1] : null;
}

function extractDate(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m || !m[1]) return null;
  try {
    return normalize(m[1]);
  } catch {
    return null;
  }
}

function extractMinimumPaymentDue(text: string): bigint | null {
  const m = MIN_PAYMENT_DUE_RE.exec(text);
  if (!m || !m[1] || m[1] === '') return null;
  try {
    return parseMoney(m[1]);
  } catch {
    return null;
  }
}

/**
 * Build the verbatim Account-Summary panel from the parsed summary fields,
 * re-applying the BANK'S PRINTED sign so the UI shows what the cardholder
 * actually saw on their statement:
 *  - Previous Balance / New Balance: signed (already preserved on parse)
 *  - Payment, Credits: printed negative — re-apply minus
 *  - Purchases / Cash Advances / Balance Transfers / Fees / Interest: printed
 *    positive (sometimes with explicit '+')
 *  - Credit Limit / Available Credit: positive
 *
 * Lines whose source field was null are omitted (not displayed as $0.00 to
 * avoid the parser inventing data).
 */
function buildSummaryLines(summary: ParsedSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null, sign: 1n | -1n = 1n) => {
    if (value === null) return;
    lines.push({ label, amount_minor: sign * value });
  };
  push('Previous Balance', summary.previous_balance); // signed already
  push('Payment, Credits', summary.payments_credits, -1n);
  push('Purchases', summary.purchases);
  push('Cash Advances', summary.cash_advances);
  push('Balance Transfers', summary.balance_transfers);
  push('Fees Charged', summary.fees);
  push('Interest Charged', summary.interest);
  push('New Balance', summary.new_balance); // signed already
  push('Credit Limit', summary.credit_limit);
  push('Available Credit', summary.available_credit);
  return lines;
}

// ── Transaction extraction ───────────────────────────────────────────────────
// The ACCOUNT ACTIVITY table on page 3+ uses three column anchors:
//   x ≈ 27   "MM/DD" date
//   x ≈ 112  description text (possibly multiple items joined left-to-right)
//   x ≈ 460  amount, optionally with leading "-" for credits
// Sub-section headers ("PAYMENTS AND OTHER CREDITS", "PURCHASE",
// "INTEREST CHARGES", "FEES CHARGED") appear on their own row at x ≈ 26
// with no date or amount.
//
// Continuation rows (Amazon Prime Visa "Order Number 113-…") have no MM/DD
// and start at x ≈ 113; we append them to the previous transaction.

const MMDD_RE = /^(\d{1,2})\/(\d{1,2})$/;
// Matches anything that LOOKS like a money amount, including the leading-zero
// sub-$1 form Chase emits ("$0.50" → ".50" in the amount column).  Accepts:
//   "5.00", "1,234.56", "-29.99", "(50.00)", ".50", "-.50", "$.34", "+5.00"
const AMOUNT_LIKE_RE = /^[-(+]?\s*\$?\s*\.?\d/;
const ACCOUNT_ACTIVITY_RE = /\bACCOUNT\s*ACTIVITY\b/i;
const PAYMENTS_HDR_RE = /\bPAYMENTS\s+AND\s+OTHER\s+CREDITS\b/i;
const PURCHASE_HDR_RE = /^PURCHASES?$/i;
const FEES_HDR_RE = /^FEES\s+CHARGED$/i;
const INTEREST_HDR_RE = /\bINTEREST\s+CHARGES?\b/i;
const YEAR_TOTALS_RE = /\b\d{4}\s+Totals\s+Year-to-Date\b/i;
const ORDER_NUMBER_RE = /^Order\s+Number\b/i;

type Section = 'payments_credits' | 'purchase' | 'fees' | 'interest' | null;

// Within "PAYMENTS AND OTHER CREDITS" Chase mixes two semantically different
// row types and the user has to know which is which:
//   - Cardholder paying off their own balance (money from your bank → Chase).
//     Description includes "Payment Thank You", "MOBILE PAYMENT", "AUTOPAY",
//     "ELECTRONIC PAYMENT", etc.  We tag these `payment_to_card`.
//   - Merchant-initiated credits: refunds for returns, reversed authorizations,
//     statement credits, reward redemptions.  Money from a merchant → your
//     card.  We tag these `refund` (the closest fit in our TransactionType
//     enum; a future enum could split refund / statement_credit / reward).
const CC_PAYMENT_DESC_RE =
  /\b(?:Payment\s+Thank\s+You|Mobile\s+Payment|AUTOPAY|Electronic\s+Payment|ACH\s+Payment|E[-\s]?Payment|Online\s+Payment)\b/i;

function txnTypeForRow(section: Section, description: string): TransactionType {
  switch (section) {
    case 'payments_credits':
      return CC_PAYMENT_DESC_RE.test(description) ? 'payment_to_card' : 'refund';
    case 'purchase':
      return 'purchase';
    case 'fees':
      return 'fee';
    case 'interest':
      return 'interest';
    default:
      return 'other';
  }
}

function yearForMMDD(mmdd: string, period: Period | null): string {
  const m = MMDD_RE.exec(mmdd);
  if (!m || !m[1] || !m[2]) {
    throw new ParseError(`chase-credit-card: invalid MM/DD ${mmdd}`);
  }
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');

  if (period === null) {
    // No period available — fall back to "unknown year" sentinel that downstream
    // can recognize. The orchestrator will reject this; we still emit something
    // so the validator can count rows.
    return `0000-${mm}-${dd}`;
  }

  // If period crosses a year boundary (e.g. 12/15/2025 - 01/14/2026),
  // a 12/xx date belongs to start_year and a 01/xx date belongs to end_year.
  const monthNum = parseInt(mm, 10);
  if (period.start_year !== period.end_year) {
    const startMonth = parseInt(period.start.slice(5, 7), 10);
    return monthNum >= startMonth
      ? `${period.start_year}-${mm}-${dd}`
      : `${period.end_year}-${mm}-${dd}`;
  }
  return `${period.end_year}-${mm}-${dd}`;
}

function findAmountItem(row: LayoutRow): { idx: number; text: string } | null {
  // Search right-to-left for a money-looking token at the right edge of the row.
  for (let i = row.items.length - 1; i >= 0; i--) {
    const item = row.items[i]!;
    const t = item.text.trim();
    if (t === '') continue;
    if (item.x < 350) break; // amount column is far right on Chase CC
    if (AMOUNT_LIKE_RE.test(t)) return { idx: i, text: t };
  }
  return null;
}

/**
 * Extract transactions from page rows.  Exported so a local-only validation
 * script can run just this step on anonymized fixtures (where period extraction
 * would fail because dates are placeholder MM/DD/YYYY).
 */
export function extractTransactions(rows: LayoutRow[], period: Period | null): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let inActivity = false;
  let section: Section = null;

  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    if (!inActivity) {
      if (ACCOUNT_ACTIVITY_RE.test(text)) inActivity = true;
      continue;
    }

    if (YEAR_TOTALS_RE.test(text)) {
      // End of activity table on this page.  Reset so multi-page statements
      // don't re-trigger on a stale header — but on Chase, the YTD totals row
      // appears once at the very end, so we can break entirely.
      break;
    }

    // Sub-section headers
    if (PAYMENTS_HDR_RE.test(text)) {
      section = 'payments_credits';
      continue;
    }
    if (PURCHASE_HDR_RE.test(text)) {
      section = 'purchase';
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

    // First non-empty item
    const firstNonEmpty = row.items.find((i) => i.text.trim() !== '');
    if (!firstNonEmpty) continue;

    if (MMDD_RE.test(firstNonEmpty.text.trim())) {
      // Transaction row
      const dateText = firstNonEmpty.text.trim();
      const amountItem = findAmountItem(row);
      if (amountItem === null) {
        // Date without a parseable amount — could be a header anomaly; skip.
        continue;
      }

      // Description = all items between date and amount, joined left-to-right.
      const description = row.items
        .filter((it) => it !== firstNonEmpty && row.items.indexOf(it) !== amountItem.idx)
        .map((it) => it.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      let printedAmount: bigint;
      try {
        printedAmount = parseMoney(amountItem.text);
      } catch (err) {
        // A truly unparseable amount IS a parser bug; surface it with the row
        // context so the user (and we) can read it directly in the UI instead
        // of decoding a cryptic checksum diff.  The only legitimate place this
        // fires is the local validator running on strict-anonymized fixtures
        // (amounts like "$X.XX"); the validator passes the row through a
        // separate code path and doesn't call this function for those rows.
        const dateText = firstNonEmpty.text.trim();
        throw new ParseError(
          `chase-credit-card: cannot parse transaction amount ${JSON.stringify(
            amountItem.text
          )} on row dated ${dateText} (${err instanceof Error ? err.message : String(err)})`
        );
      }

      transactions.push({
        posted_date: yearForMMDD(dateText, period),
        description,
        raw_text: rowText(row, '\t'),
        // INVERT sign per ParsedTransaction contract (outflow negative).
        amount_minor: -printedAmount,
        currency: 'USD',
        transaction_type: txnTypeForRow(section, description)
      });
      continue;
    }

    // Continuation row: "Order Number 113-…"
    if (transactions.length > 0 && ORDER_NUMBER_RE.test(text)) {
      const last = transactions[transactions.length - 1]!;
      last.description = `${last.description} (${text})`;
      last.raw_text = `${last.raw_text}\n${rowText(row, '\t')}`;
    }
  }

  return transactions;
}

// ── Adapter export ───────────────────────────────────────────────────────────

export const chaseCreditCardAdapter: BankAdapter = {
  name: 'layout-chase-credit-card',
  version: '0.2.0',
  bank_name: 'Chase',

  detect,

  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) {
      throw new ParseError('chase-credit-card: PDF has no pages');
    }

    const rows = groupAllRows(pdf.pages, 3);
    const flatText = pdf.pages
      .flatMap((p) => p.items.map((i) => i.text))
      .join(' ')
      .replace(/\s+/g, ' ');

    const summary = extractSummary(rows);
    const period = extractPeriod(flatText);
    const last4 = extractAccountLast4(flatText);

    if (period === null) {
      throw new ParseError(
        'chase-credit-card: could not find statement period (Opening/Closing Date)'
      );
    }
    if (summary.previous_balance === null || summary.new_balance === null) {
      throw new ParseError(
        'chase-credit-card: could not find Previous Balance or New Balance in Account Summary box'
      );
    }

    const transactions = extractTransactions(rows, period);

    // Level B aggregates — only meaningful when there are transactions to
    // compare against the printed Account Summary aggregates.  If transactions
    // is empty (e.g. marketing-sample fixture), we leave B unpopulated.
    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    const parser_provides: ChecksumLevel[] = ['C'];

    if (transactions.length > 0) {
      parser_provides.push('D');
      const debitFields: Array<bigint | null> = [
        summary.purchases,
        summary.cash_advances,
        summary.balance_transfers,
        summary.fees,
        summary.interest
      ];
      if (debitFields.every((f) => f !== null) && summary.payments_credits !== null) {
        total_debits_minor = debitFields.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
        total_credits_minor = summary.payments_credits;
        parser_provides.unshift('B');
      }
    }

    const statement: ParsedStatement = {
      account_type: 'credit_card',
      account_last_4: last4,
      period_start: period.start,
      period_end: period.end,
      currency: 'USD',
      // Level A — not used on credit cards.
      opening_balance_minor: null,
      closing_balance_minor: null,
      // Level B
      total_debits_minor,
      total_credits_minor,
      // Level C
      previous_balance_minor: summary.previous_balance,
      statement_balance_minor: summary.new_balance,
      // Level D (supplementary only)
      printed_transaction_count: transactions.length > 0 ? transactions.length : null,
      // Full Account Summary preserved (every label-value pair the bank printed).
      summary_lines: buildSummaryLines(summary),
      // Statement-level dates and minimum-payment due.  Statement Date comes
      // from page-2 footer; sometimes the PDF doesn't carry it as a single
      // text item, in which case it falls back to the closing date.
      payment_due_date: extractDate(flatText, PAYMENT_DUE_DATE_RE),
      statement_date: extractDate(flatText, STATEMENT_DATE_RE) ?? period.end,
      minimum_payment_due_minor: extractMinimumPaymentDue(flatText),
      parser_provides
    };

    return { statement, transactions };
  }
};
