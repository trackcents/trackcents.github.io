// Robinhood Credit card adapter.
//
// Statement quirks the QA needs to know:
//   - Account number: "Account Number: XXXX XXXX XXXX 9024" (spaces, like Chase)
//   - Period: "Statement Closing Date March 29, 2026" (long-form month + day + year)
//     and explicit "Days in Billing Cycle: N"
//   - Account Summary uses operator-prefixed labels:
//     "- Payments & Credits", "+ Purchases & Other Charges", "+ FEE CHARGED", etc.
//   - SIGN QUIRK: payments printed with TRAILING MINUS ("344.92-" not "-344.92").
//     The adapter normalizes "X.XX-" → "-X.XX" before parseMoney.
//   - Each transaction row has BOTH "Tran Date" and "Post Date" columns.
//   - Multi-row transaction descriptions can occur (e.g., airline itinerary
//     lines under a flight purchase).  Currently treated as continuation rows.

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

const DETECT_BRAND = /\bRobinhood\s+(?:Credit|Card)\b/i;
const DETECT_FALLBACK = /\bRobinhood\b/i;
const DETECT_FIELDS = /Account\s+Number:\s+X{4}|85\s+Willow\s+Road|Menlo\s+Park,\s+CA\s+94025/i;
// Robinhood's logo at the top of page 1 is rendered as an image (no extracted
// text), so the brand keyword first appears on page 3 in the legal notices.
// The operator-prefixed summary labels ("+ FEE CHARGED", "+ INTEREST
// CHARGED", "= New Balance") together with "Days in Billing Cycle" form a
// page-1 fingerprint no other supported bank uses.  We require AT LEAST TWO
// of these to fire to avoid claiming statements from other banks that happen
// to use one of these phrases in a different context.
const DETECT_PAGE1_PATTERNS: RegExp[] = [
  /\bDays\s+in\s+Billing\s+Cycle\b/i,
  /\+\s+FEE\s+CHARGED/i,
  /\+\s+INTEREST\s+CHARGED/i,
  /=\s+New\s+Balance\b/i,
  /\+\s+Purchases\s+&\s+Other\s+Charges/i,
  /-\s+Payments\s+&\s+Credits/i
];

function detect(textSample: string): boolean {
  // The brand strings "Robinhood Credit" and "Robinhood Card" appear in OTHER
  // banks' transaction descriptors (e.g., "Robinhood Card Payment" on a Chase
  // Checking statement).  So the brand match alone is NOT sufficient — we
  // require an additional Robinhood-specific signal alongside it.  Tightening
  // this caught a synthetic-test false positive on 2026-05-23.
  const hasBrand = DETECT_BRAND.test(textSample);
  const hasFields = DETECT_FIELDS.test(textSample);
  if (hasBrand && hasFields) return true;
  if (DETECT_FALLBACK.test(textSample) && hasFields) return true;
  // Page-1 fingerprint: at least 2 of the Robinhood-style operator labels
  // must appear together.  One alone is too easy to false-positive (e.g.,
  // any statement that uses "Days in Billing Cycle" terminology).
  let hits = 0;
  for (const re of DETECT_PAGE1_PATTERNS) {
    if (re.test(textSample)) hits++;
    if (hits >= 2) return true;
  }
  // Brand + ANY operator label also clinches it (covers real statements
  // where the brand only appears in legal text + summary on different pages).
  if (hasBrand && hits >= 1) return true;
  return false;
}

const ACCOUNT_RE = /Account\s+Number:\s*X{4}\s*X{4}\s*X{4}\s*(\d{4})/i;
const CLOSING_DATE_RE = /Statement\s+Closing\s+Date\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i;
const PAYMENT_DUE_RE = /Payment\s+Due\s+Date\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i;
const DAYS_BILLING_RE = /Days\s+in\s+Billing\s+Cycle\s+(\d{1,3})/i;
const MIN_PAYMENT_RE =
  /Minimum\s+Payment\s+Due\s+\$?\s*((?:\d{1,3}(?:,\d{3})*|\d+)?(?:\.\d{1,2})?)/i;

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

function parseLongDate(s: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1]!.toLowerCase());
  if (idx < 0) return null;
  return `${m[3]}-${String(idx + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

function addDays(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

interface Period {
  start: string;
  end: string;
  start_year: number;
  end_year: number;
}

function extractPeriod(flatText: string): Period | null {
  const closingMatch = CLOSING_DATE_RE.exec(flatText);
  if (!closingMatch || !closingMatch[1]) return null;
  const end = parseLongDate(closingMatch[1]);
  if (end === null) return null;
  const daysMatch = DAYS_BILLING_RE.exec(flatText);
  const days = daysMatch && daysMatch[1] ? parseInt(daysMatch[1], 10) : 30;
  const start = addDays(end, -(days - 1));
  return {
    start,
    end,
    start_year: parseInt(start.slice(0, 4), 10),
    end_year: parseInt(end.slice(0, 4), 10)
  };
}

function extractAccountLast4(flatText: string): string | null {
  const m = ACCOUNT_RE.exec(flatText);
  return m && m[1] ? m[1] : null;
}

function extractPaymentDueDate(flatText: string): string | null {
  const m = PAYMENT_DUE_RE.exec(flatText);
  if (!m || !m[1]) return null;
  return parseLongDate(m[1]);
}

function extractMinimumPaymentDue(flatText: string): bigint | null {
  const m = MIN_PAYMENT_RE.exec(flatText);
  if (!m || !m[1] || m[1] === '') return null;
  try {
    return parseMoney(m[1]);
  } catch {
    return null;
  }
}

// Robinhood's trailing-minus convention.  Normalize "344.92-" → "-344.92"
// before parseMoney.  parseMoney itself rejects trailing minus per Constitution
// (this normalization is the adapter's responsibility).
function normalizeAmount(raw: string): string {
  const trimmed = raw.trim();
  if (/^[\d.,]+-$/.test(trimmed)) return `-${trimmed.slice(0, -1)}`;
  return trimmed;
}

interface RobinhoodSummary {
  credit_limit: bigint | null;
  credit_available: bigint | null;
  previous_balance: bigint | null;
  payments_credits: bigint | null;
  purchases_other_charges: bigint | null;
  balance_transfer: bigint | null;
  cash_advances: bigint | null;
  fee_charged: bigint | null;
  interest_charged: bigint | null;
  new_balance: bigint | null;
}

const SUMMARY_LABELS: Record<keyof RobinhoodSummary, RegExp> = {
  credit_limit: /^Credit\s+Limit$/i,
  credit_available: /^Credit\s+Available$/i,
  previous_balance: /^Previous\s+Balance$/i,
  payments_credits: /^(?:[-+]\s*)?Payments\s+(?:&|and)\s+Credits$/i,
  purchases_other_charges: /^(?:[-+]\s*)?Purchases\s+(?:&|and)\s+Other\s+Charges$/i,
  balance_transfer: /^(?:[-+]\s*)?Balance\s+Transfer$/i,
  cash_advances: /^(?:[-+]\s*)?Cash\s+Advances$/i,
  fee_charged: /^(?:[-+]\s*)?FEE\s+CHARGED$/i,
  interest_charged: /^(?:[-+]\s*)?INTEREST\s+CHARGED$/i,
  new_balance: /^=?\s*New\s+Balance$/i
};

function extractAccountSummary(rows: LayoutRow[]): RobinhoodSummary {
  const out: RobinhoodSummary = {
    credit_limit: null,
    credit_available: null,
    previous_balance: null,
    payments_credits: null,
    purchases_other_charges: null,
    balance_transfer: null,
    cash_advances: null,
    fee_charged: null,
    interest_charged: null,
    new_balance: null
  };
  for (const row of rows) {
    const cells = row.items.map((i) => i.text.trim()).filter((s) => s.length > 0);
    if (cells.length < 2) continue;
    const moneyIdx = cells.findIndex((c) => /^\$?\s*[\d.,]+-?$/.test(c));
    if (moneyIdx < 1) continue;
    const label = cells.slice(0, moneyIdx).join(' ').replace(/\s+/g, ' ').trim();
    const moneyText = normalizeAmount(cells[moneyIdx]!);
    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof RobinhoodSummary>) {
      if (!SUMMARY_LABELS[key].test(label)) continue;
      try {
        const signed = parseMoney(moneyText);
        const signPreserving = key === 'previous_balance' || key === 'new_balance';
        out[key] = signPreserving ? signed : signed < 0n ? -signed : signed;
      } catch {
        /* leave null */
      }
      break;
    }
  }
  return out;
}

const MMDD_RE = /^(\d{1,2})\/(\d{1,2})$/;
const TRANSACTIONS_HDR_RE = /^TRANSACTIONS$/i;
const TOTAL_FEES_RE = /TOTAL\s+FEES\s+FOR\s+THIS\s+PERIOD/i;
const INTEREST_CHARGED_HDR_RE = /^INTEREST\s+CHARGED$/i;
const TOTAL_INTEREST_RE = /TOTAL\s+INTEREST\s+FOR\s+THIS\s+PERIOD/i;
const END_OF_TRANSACTIONS_RE =
  /Totals\s+\d{4}\s+Year-to-Date|INTEREST\s+CHARGE\s+CALCULATION|BILLING\s+RIGHTS\s+SUMMARY/i;

type Section = 'transactions' | 'interest' | null;

function yearForMMDD(mmdd: string, period: Period): string {
  const m = MMDD_RE.exec(mmdd);
  if (!m || !m[1] || !m[2]) {
    throw new ParseError(`robinhood: invalid MM/DD ${mmdd}`);
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

// Classify Robinhood transaction:
//   - "PAYMENT - THANK YOU" → payment_to_card (always trailing-minus)
//   - "INTEREST CHARGE ON ..." → interest
//   - section=interest → interest (catch-all)
//   - otherwise → purchase (Robinhood doesn't separately label the section
//     for purchases; everything between TRANSACTIONS header and the totals
//     is purchases except for the explicit Payment row)
function classifyTransaction(description: string, section: Section): TransactionType {
  if (/PAYMENT\s*-?\s*THANK\s+YOU/i.test(description)) return 'payment_to_card';
  if (section === 'interest' || /INTEREST\s+CHARGE\s+ON\b/i.test(description)) {
    return 'interest';
  }
  return 'purchase';
}

export function extractTransactions(rows: LayoutRow[], period: Period): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let section: Section = null;

  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    if (TRANSACTIONS_HDR_RE.test(text)) {
      section = 'transactions';
      continue;
    }
    if (TOTAL_FEES_RE.test(text)) continue;
    if (INTEREST_CHARGED_HDR_RE.test(text)) {
      section = 'interest';
      continue;
    }
    if (TOTAL_INTEREST_RE.test(text)) continue;
    if (END_OF_TRANSACTIONS_RE.test(text)) {
      section = null;
      continue;
    }
    if (section === null) continue;

    const firstNonEmpty = row.items.find((i) => i.text.trim() !== '');
    if (!firstNonEmpty) continue;
    if (!MMDD_RE.test(firstNonEmpty.text.trim())) continue;

    const dateText = firstNonEmpty.text.trim();

    // Find amount (rightmost money-like item at x >= 500).  Robinhood prints
    // trailing minus, e.g. "344.92-" so the regex allows an optional trailing -.
    let amountIdx = -1;
    for (let i = row.items.length - 1; i >= 0; i--) {
      const it = row.items[i]!;
      const t = it.text.trim();
      if (t === '' || it.x < 500) continue;
      if (/^[-+]?\s*\$?\s*[\d.,]+-?$/.test(t) || /^\.\d{1,2}-?$/.test(t)) {
        amountIdx = i;
        break;
      }
    }
    if (amountIdx < 0) continue;

    const rawAmount = row.items[amountIdx]!.text;
    let printedAmount: bigint;
    try {
      printedAmount = parseMoney(normalizeAmount(rawAmount));
    } catch (err) {
      throw new ParseError(
        `robinhood: cannot parse amount ${JSON.stringify(rawAmount)} on row dated ${dateText} (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }

    // Description = everything between the (post date — often a second MM/DD
    // item) and the amount.  Robinhood has TWO date columns; we skip the
    // second one if it's also MM/DD.
    const description = row.items
      .filter((it, idx) => {
        if (idx === amountIdx) return false;
        if (it === firstNonEmpty) return false;
        const t = it.text.trim();
        if (t.length === 0) return false;
        if (MMDD_RE.test(t)) return false; // second date column
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
      amount_minor: -printedAmount, // INVERT sign per contract
      currency: 'USD',
      transaction_type: classifyTransaction(description, section)
    });
  }
  return transactions;
}

function buildSummaryLines(s: RobinhoodSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null, sign: 1n | -1n = 1n) => {
    if (value === null) return;
    lines.push({ label, amount_minor: sign * value });
  };
  push('Previous Balance', s.previous_balance);
  push('Payments & Credits', s.payments_credits, -1n);
  push('Purchases & Other Charges', s.purchases_other_charges);
  push('Balance Transfer', s.balance_transfer);
  push('Cash Advances', s.cash_advances);
  push('Fee Charged', s.fee_charged);
  push('Interest Charged', s.interest_charged);
  push('New Balance', s.new_balance);
  push('Credit Limit', s.credit_limit);
  push('Credit Available', s.credit_available);
  return lines;
}

export const robinhoodCreditCardAdapter: BankAdapter = {
  name: 'layout-robinhood-credit-card',
  version: '0.1.0',
  bank_name: 'Robinhood',
  detect,
  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) throw new ParseError('robinhood: PDF has no pages');

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

    if (period === null) throw new ParseError('robinhood: could not find Statement Closing Date');
    if (summary.previous_balance === null || summary.new_balance === null) {
      throw new ParseError(
        'robinhood: could not find Previous Balance or New Balance in Account Summary'
      );
    }

    const transactions = extractTransactions(rows, period);

    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    const parser_provides: ChecksumLevel[] = ['C'];
    if (transactions.length > 0) {
      parser_provides.push('D');
      const debitFields: Array<bigint | null> = [
        summary.purchases_other_charges,
        summary.balance_transfer,
        summary.cash_advances,
        summary.fee_charged,
        summary.interest_charged
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

    return { statement, transactions, suggested_account_nickname: 'Robinhood Credit' };
  }
};
