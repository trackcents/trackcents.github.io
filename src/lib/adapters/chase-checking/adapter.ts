// Chase Checking adapter.
//
// Parses JPMorgan Chase personal checking statements (Chase College Checking,
// Total Checking, Premier Plus, etc. — the consumer line).  Distinct from the
// chase-credit-card adapter, which parses Chase-issued credit cards.
//
// Statement anatomy (typical 2-page statement):
//   Page 1   Bank address block, account number, CHECKING SUMMARY box (4
//            balance lines), product-name banner, and the TRANSACTION DETAIL
//            table with a Beginning Balance marker row at the top.
//   Page 2+  TRANSACTION DETAIL (continued); ends with an Ending Balance
//            marker row, then the BILLING RIGHTS / FDIC disclosure.
//
// Chase wraps every section in explicit text-stream markers that we anchor
// on for robust parsing (immune to layout drift):
//     *start*summary             *end*summary
//     *start*transactiondetail   *end*transaction detail
//
// Checksum: Level A only — Beginning Balance + Σ(transactions) = Ending
// Balance.  This is the strongest single check for a deposit account and the
// only one a Chase statement structurally supports.

import { ParseError } from '../types';
import type {
  AccountType,
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
import { detectCardPayment } from '../../util/card-payment';
import { groupAllRows, rowText, type LayoutRow } from '../_layout/table';

// ── Detection ────────────────────────────────────────────────────────────────
// Chase checking statements always carry the bank's legal name on page 1.
// We require the CHECKING SUMMARY or transaction-detail markers in addition,
// so a credit-card statement that happens to mention JPMorgan Chase Bank in
// boilerplate doesn't false-positive against this adapter.
const DETECT_BANK = /JPMorgan\s+Chase\s+Bank/i;
const DETECT_PRODUCT_OR_MARKER =
  /\b(?:CHECKING\s+SUMMARY|\*start\*transactiondetail|Chase\s+(?:College|Total|Premier|Secure|High\s+School)\s+Checking)\b/i;
// And we must NOT also be a credit-card statement (Chase prints
// "Chase Card Services" on every CC payment coupon).
const DETECT_NOT_CC = /Chase\s+Card\s+Services/i;

function detect(textSample: string): boolean {
  if (!DETECT_BANK.test(textSample)) return false;
  if (!DETECT_PRODUCT_OR_MARKER.test(textSample)) return false;
  if (DETECT_NOT_CC.test(textSample)) return false;
  return true;
}

// ── Period extraction (long-form: "February 26, 2026 through March 24, 2026")
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
// Captures: month name, day, year — two of those, joined by "through".
const PERIOD_RE =
  /\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+through\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/i;

interface Period {
  start: string; // ISO YYYY-MM-DD
  end: string;
  start_year: number;
  end_year: number;
}

function parseLongDate(monthName: string, day: string, year: string): string | null {
  const idx = MONTH_NAMES.indexOf(monthName.toLowerCase());
  if (idx < 0) return null;
  const mm = String(idx + 1).padStart(2, '0');
  const dd = day.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function extractPeriod(flatText: string): Period | null {
  const m = PERIOD_RE.exec(flatText);
  if (!m) return null;
  const start = parseLongDate(m[1]!, m[2]!, m[3]!);
  const end = parseLongDate(m[4]!, m[5]!, m[6]!);
  if (start === null || end === null) return null;
  return {
    start,
    end,
    start_year: parseInt(m[3]!, 10),
    end_year: parseInt(m[6]!, 10)
  };
}

// ── Account number extraction ────────────────────────────────────────────────
// Chase checking statements print: "Account Number:  000000533089535"
// (15 digits, leading zeros).  We keep only the last 4 for storage.
const ACCOUNT_NUMBER_RE = /Account\s+Number:\s*(\d{6,20})\b/i;

function extractAccountLast4(flatText: string): string | null {
  const m = ACCOUNT_NUMBER_RE.exec(flatText);
  if (!m || !m[1]) return null;
  return m[1].slice(-4);
}

// ── CHECKING SUMMARY box extraction ──────────────────────────────────────────
// Four labeled lines between *start*summary and *end*summary:
//   Beginning Balance         $X.XX
//   Deposits and Additions     X.XX        (bare, no $)
//   Electronic Withdrawals    -X,XXX.XX    (signed negative)
//   Ending Balance            $X.XX

interface CheckingSummary {
  beginning_balance: bigint | null;
  deposits_additions: bigint | null; // absolute (always positive in print)
  electronic_withdrawals: bigint | null; // SIGNED (bank prints negative)
  ending_balance: bigint | null;
}

const SUMMARY_LABELS: Record<keyof CheckingSummary, RegExp> = {
  beginning_balance: /^Beginning\s+Balance$/i,
  deposits_additions: /^Deposits\s+and\s+Additions$/i,
  electronic_withdrawals: /^Electronic\s+Withdrawals$/i,
  ending_balance: /^Ending\s+Balance$/i
};

function extractSummary(rows: LayoutRow[]): CheckingSummary {
  const out: CheckingSummary = {
    beginning_balance: null,
    deposits_additions: null,
    electronic_withdrawals: null,
    ending_balance: null
  };

  let inSummary = false;
  for (const row of rows) {
    const text = rowText(row).trim();
    if (!inSummary) {
      if (/\*start\*summary\b/i.test(text) || /^CHECKING\s+SUMMARY$/i.test(text)) {
        inSummary = true;
      }
      continue;
    }
    if (/\*end\*summary\b/i.test(text)) break;

    // A summary row has a label cell on the left and a money cell on the right.
    const cells = row.items.map((i) => i.text.trim()).filter((s) => s.length > 0);
    if (cells.length < 2) continue;

    // Find the money cell — last cell on the right that starts with $, -, or a digit.
    const moneyIdx = (() => {
      for (let i = cells.length - 1; i >= 0; i--) {
        if (/^[-$+]?\s*\$?\s*[\d.,]/.test(cells[i]!)) return i;
      }
      return -1;
    })();
    if (moneyIdx < 1) continue;

    const label = cells.slice(0, moneyIdx).join(' ').replace(/\s+/g, ' ').trim();
    const moneyText = cells[moneyIdx]!.replace(/^\+\s*/, '');

    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof CheckingSummary>) {
      if (!SUMMARY_LABELS[key].test(label)) continue;
      let signed: bigint;
      try {
        signed = parseMoney(moneyText);
      } catch {
        break;
      }
      // Sign convention:
      //   - beginning_balance & ending_balance: keep sign as printed (rarely
      //     negative but possible if overdrafted).
      //   - deposits_additions: store absolute (always printed positive).
      //   - electronic_withdrawals: keep sign as printed (bank prints negative).
      if (key === 'deposits_additions') {
        out[key] = signed < 0n ? -signed : signed;
      } else {
        out[key] = signed;
      }
      break;
    }
  }

  return out;
}

// ── Transaction extraction ───────────────────────────────────────────────────
// In the TRANSACTION DETAIL section:
//   Date column at x ≈ 36 (MM/DD)
//   Description: multiple items between x ≈ 78 and x ≈ 350 (varies)
//   Amount: x ≈ 420-440 (signed bare number, e.g. "-700.00" or "210.00")
//   Balance: x ≈ 490-500 (running balance after this transaction)
//
// "Beginning Balance" and "Ending Balance" rows have no Date and live in the
// same table.  We skip them as marker rows.

const MMDD_RE = /^(\d{1,2})\/(\d{1,2})$/;
// An amount item starts with "-" or "+" or a digit, may have "$" prefix.  No
// trailing letters (rules out "X.XX" anonymized placeholder when developers
// run the parser against real data).
const AMOUNT_LIKE_RE = /^[-+]?\s*\$?\s*\.?\d/;
const TRANSACTION_DETAIL_RE = /\*start\*transactiondetail\b|^TRANSACTION\s+DETAIL\b/i;
const END_TRANSACTION_DETAIL_RE = /\*end\*transaction\s*detail\b/i;
const BEGINNING_BALANCE_ROW_RE = /^Beginning\s+Balance$/i;
const ENDING_BALANCE_ROW_RE = /^Ending\s+Balance$/i;

/**
 * Map a transaction description to its semantic type.  Order matters: more
 * specific patterns first.
 *
 * Credit-card payments (whether to Chase or to another issuer paid from this
 * Chase bank account) are detected via the shared `detectCardPayment()`
 * pattern set, so cross-bank reconciliation can find the matching CC
 * statement (US-P1-D works across all issuers, not just Chase-to-Chase).
 */
function descriptionToTxnType(description: string): TransactionType {
  // ALL credit-card payments (Chase, BoA, Amex, Discover, Robinhood, etc.) —
  // these are the rows the reconciliation matcher tries to link.
  if (detectCardPayment(description) !== null) return 'payment_to_card';

  if (/Card\s+Purchase\s+Return\b/i.test(description)) return 'refund';
  // Zelle/Venmo PAYMENT TO someone = outflow from your bank.
  if (/Zelle\s+Payment\s+To\b/i.test(description)) return 'transfer';
  // Zelle PAYMENT FROM someone = inflow into your bank.
  if (/Zelle\s+Payment\s+From\b/i.test(description)) return 'deposit';
  // Direct deposit / payroll / IRS Treas / SSA inflow.
  // NB: `\d+` not `\d` — "Treas 310" has 3 digits, and `\d\b` only matches a
  // single digit followed by a non-word char (the adversarial test caught this).
  if (/(?:Payroll|Treas\s+\d+|Direct\s+Dep(?:osit)?|SSI|SOC\s+SEC)\b/i.test(description)) {
    return 'deposit';
  }
  // BNPL / loan / car / utility / generic ACH bill payments → transfer.
  if (
    /(?:Affirm\.Com|Klarna|Pennymac|Vw\s+Credit|Ford\s+Credit|Toyota\s+Financial|T-Mobile|Verizon|AT&T|PG&E|Electric|Water|Gas\s+Company|Mortgage|Loan\s+Pmt)/i.test(
      description
    )
  ) {
    return 'transfer';
  }
  // Wire transfers.
  if (/\b(?:Wire\s+Transfer|DOMESTIC\s+WIRE|INTL\s+WIRE)\b/i.test(description)) return 'transfer';
  // ATM withdrawals.
  if (/\bATM\s+(?:WITHDRAWAL|CASH\s+WITHDRAWAL)/i.test(description)) return 'withdrawal';
  // Bank fees (overdraft, NSF, monthly maintenance, etc.).
  if (
    /\b(?:OVERDRAFT\s+FEE|NSF\s+FEE|NON-SUFFICIENT\s+FUNDS|MONTHLY\s+(?:SERVICE\s+|MAINTENANCE\s+)?FEE|RETURNED\s+ITEM\s+FEE|WIRE\s+FEE|STOP\s+PAYMENT\s+FEE)\b/i.test(
      description
    )
  ) {
    return 'fee';
  }
  // Interest earned (rare on checking, common on savings).
  if (/\b(?:INTEREST\s+(?:PAYMENT|EARNED|CREDIT))\b/i.test(description)) return 'interest';
  // Self-directed transfer to/from another bank.
  if (/\bTransfer\b/i.test(description)) return 'transfer';
  return 'other';
}

interface ExtractTxnsResult {
  transactions: ParsedTransaction[];
  /** Beginning balance marker as printed in the transaction table header row. */
  beginning_balance_marker: bigint | null;
  /** Ending balance marker as printed in the transaction table footer row. */
  ending_balance_marker: bigint | null;
}

/**
 * Extract transaction rows.  Exported so a local validator can call this on
 * anonymized fixtures and inspect structural correctness.
 */
export function extractTransactions(rows: LayoutRow[], period: Period | null): ExtractTxnsResult {
  const transactions: ParsedTransaction[] = [];
  let beginning_balance_marker: bigint | null = null;
  let ending_balance_marker: bigint | null = null;

  let inTxns = false;
  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    if (!inTxns) {
      if (TRANSACTION_DETAIL_RE.test(text)) inTxns = true;
      continue;
    }

    if (END_TRANSACTION_DETAIL_RE.test(text)) {
      inTxns = false;
      continue;
    }

    // Beginning Balance marker (no date, label + balance only)
    if (BEGINNING_BALANCE_ROW_RE.test(extractLabelLeadingCell(row))) {
      beginning_balance_marker = extractRightmostMoney(row) ?? beginning_balance_marker;
      continue;
    }
    // Ending Balance marker
    if (ENDING_BALANCE_ROW_RE.test(extractLabelLeadingCell(row))) {
      ending_balance_marker = extractRightmostMoney(row) ?? ending_balance_marker;
      continue;
    }

    // Date column-header row?
    if (/^DATE\b/i.test(extractLabelLeadingCell(row))) continue;

    // A transaction row: leftmost non-empty item must be MM/DD.
    const firstItem = row.items.find((i) => i.text.trim() !== '');
    if (!firstItem) continue;
    const dateText = firstItem.text.trim();
    if (!MMDD_RE.test(dateText)) continue;

    // Find the AMOUNT and BALANCE items (rightmost two amount-shaped items).
    const moneyItems = row.items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it.x >= 380 && AMOUNT_LIKE_RE.test(it.text.trim()));
    if (moneyItems.length < 1) {
      // Date with no amount column found — surface loudly per Principle II.
      throw new ParseError(`chase-checking: row dated ${dateText} has no parseable amount column`);
    }
    // Amount is the LEFTMOST money item (x ≈ 420-440); balance is the
    // RIGHTMOST (x ≈ 490-500).  When only one money item is found (rare —
    // some statements omit the balance for $0 rows) we treat it as the amount.
    const amountEntry = moneyItems[0]!;
    const balanceEntry = moneyItems.length > 1 ? moneyItems[moneyItems.length - 1] : undefined;

    let amount: bigint;
    try {
      amount = parseMoney(amountEntry.it.text);
    } catch (err) {
      throw new ParseError(
        `chase-checking: cannot parse amount ${JSON.stringify(
          amountEntry.it.text
        )} on row dated ${dateText} (${err instanceof Error ? err.message : String(err)})`
      );
    }

    // Description = every non-empty item between the date and the amount,
    // joined left-to-right with single spaces.
    const description = row.items
      .filter((it) => {
        if (it === firstItem) return false;
        if (balanceEntry && it === balanceEntry.it) return false;
        if (it === amountEntry.it) return false;
        const t = it.text.trim();
        return t.length > 0;
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
      // Chase Checking prints the sign from the bank-account perspective
      // already, which is also our schema convention (outflow negative,
      // inflow positive).  No inversion.
      amount_minor: amount,
      currency: 'USD',
      transaction_type: descriptionToTxnType(description)
    });
  }

  return { transactions, beginning_balance_marker, ending_balance_marker };
}

function extractLabelLeadingCell(row: LayoutRow): string {
  for (const it of row.items) {
    const t = it.text.trim();
    if (t.length > 0) return t;
  }
  return '';
}

function extractRightmostMoney(row: LayoutRow): bigint | null {
  for (let i = row.items.length - 1; i >= 0; i--) {
    const t = row.items[i]!.text.trim();
    if (t === '') continue;
    if (AMOUNT_LIKE_RE.test(t)) {
      try {
        return parseMoney(t);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function yearForMMDD(mmdd: string, period: Period | null): string {
  const m = MMDD_RE.exec(mmdd);
  if (!m || !m[1] || !m[2]) {
    throw new ParseError(`chase-checking: invalid MM/DD ${mmdd}`);
  }
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');

  if (period === null) return `0000-${mm}-${dd}`;

  // Handle Dec/Jan boundary: if start_year != end_year, a 12/xx date belongs
  // to start_year and a 01/xx date belongs to end_year.
  const monthNum = parseInt(mm, 10);
  if (period.start_year !== period.end_year) {
    const startMonth = parseInt(period.start.slice(5, 7), 10);
    return monthNum >= startMonth
      ? `${period.start_year}-${mm}-${dd}`
      : `${period.end_year}-${mm}-${dd}`;
  }
  return `${period.end_year}-${mm}-${dd}`;
}

// ── Build summary_lines (the 4 verbatim CHECKING SUMMARY rows) ───────────────
function buildSummaryLines(summary: CheckingSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null) => {
    if (value === null) return;
    lines.push({ label, amount_minor: value });
  };
  push('Beginning Balance', summary.beginning_balance);
  push('Deposits and Additions', summary.deposits_additions);
  push('Electronic Withdrawals', summary.electronic_withdrawals);
  push('Ending Balance', summary.ending_balance);
  return lines;
}

// ── Adapter export ───────────────────────────────────────────────────────────
export const chaseCheckingAdapter: BankAdapter = {
  name: 'layout-chase-checking',
  version: '0.1.0',
  bank_name: 'Chase',

  detect,

  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) {
      throw new ParseError('chase-checking: PDF has no pages');
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
        'chase-checking: could not find statement period (e.g. "February 26, 2026 through March 24, 2026")'
      );
    }
    if (summary.beginning_balance === null || summary.ending_balance === null) {
      throw new ParseError(
        'chase-checking: could not find Beginning Balance or Ending Balance in CHECKING SUMMARY box'
      );
    }

    const { transactions, beginning_balance_marker, ending_balance_marker } = extractTransactions(
      rows,
      period
    );

    // Cross-check: the Beginning/Ending Balance values in the SUMMARY box
    // should equal the marker rows printed at the top/bottom of the
    // TRANSACTION DETAIL table.  Mismatch = parser bug; throw with detail.
    if (
      beginning_balance_marker !== null &&
      beginning_balance_marker !== summary.beginning_balance
    ) {
      throw new ParseError(
        `chase-checking: Beginning Balance in CHECKING SUMMARY (${summary.beginning_balance}) ` +
          `does not match the Beginning Balance row in the TRANSACTION DETAIL table ` +
          `(${beginning_balance_marker}). Parser likely misread one of them.`
      );
    }
    if (ending_balance_marker !== null && ending_balance_marker !== summary.ending_balance) {
      throw new ParseError(
        `chase-checking: Ending Balance in CHECKING SUMMARY (${summary.ending_balance}) ` +
          `does not match the Ending Balance row in the TRANSACTION DETAIL table ` +
          `(${ending_balance_marker}). Parser likely misread one of them.`
      );
    }

    // Checksum levels.  Level A is the strongest single check for a
    // checking account and always available on Chase statements.  Level D
    // (count) is supplementary.
    const parser_provides: ChecksumLevel[] = ['A'];
    if (transactions.length > 0) parser_provides.push('D');
    // Level B (total debits / total credits) is also available:
    //   total_credits_minor = deposits_additions (positive)
    //   total_debits_minor  = |electronic_withdrawals|
    // We populate it when both are extracted.
    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    if (
      summary.electronic_withdrawals !== null &&
      summary.deposits_additions !== null &&
      transactions.length > 0
    ) {
      total_debits_minor =
        summary.electronic_withdrawals < 0n
          ? -summary.electronic_withdrawals
          : summary.electronic_withdrawals;
      total_credits_minor = summary.deposits_additions;
      parser_provides.unshift('B');
    }

    const account_type: AccountType = 'checking';
    const statement: ParsedStatement = {
      account_type,
      account_last_4: last4,
      period_start: period.start,
      period_end: period.end,
      currency: 'USD',
      // Level A — checking-account balance reconciliation.
      opening_balance_minor: summary.beginning_balance,
      closing_balance_minor: summary.ending_balance,
      // Level B — aggregate totals (when transactions are present).
      total_debits_minor,
      total_credits_minor,
      // Level C — N/A for checking accounts.
      previous_balance_minor: null,
      statement_balance_minor: null,
      // Level D
      printed_transaction_count: transactions.length > 0 ? transactions.length : null,
      summary_lines: buildSummaryLines(summary),
      // Chase Checking doesn't print a Payment Due Date or Minimum Payment Due
      // (those are credit-card concepts).
      payment_due_date: null,
      statement_date: period.end,
      minimum_payment_due_minor: null,
      parser_provides
    };

    return { statement, transactions, suggested_account_nickname: 'Chase Checking' };
  }
};
