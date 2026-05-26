// Discover IT credit card adapter.
//
// Layout (per the user's anonymized April / March 2026 statements):
//   - "DISCOVER IT" banner + "CARD ENDING IN NNNN"
//   - Account Summary on page 1: Previous Balance, Payments and Credits,
//     Purchases, Balance Transfers, Cash Advances, Fees Charged, Interest
//     Charged, New Balance, plus credit-line metadata
//   - "Open to Close Date: MM/DD/YYYY - MM/DD/YYYY" prints both endpoints
//   - Transactions on page 3+:
//       "TRANS. DATE | PAYMENTS AND CREDITS | AMOUNT" header
//       Date at x≈38, description at x≈80, category at x≈257, amount at x≈369-385
//       Amounts: "-$X.XX" for payments, "$X.XX" for purchases (standard sign)
//   - Sections: PAYMENTS AND CREDITS, PURCHASES, "Fees and Interest Charged"

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

// CRITICAL: "Discover" appears in OTHER banks' statements as a transaction
// descriptor (e.g., Chase Checking has "Discover E-Payment 3562" rows).
// And "CARD ENDING IN NNNN" also appears in those banks' statements when
// they describe a payment to a Discover or Chase card.  So we require
// markers ONLY present on Discover's own statement template:
//   - "DISCOVER IT" (the specific Discover-Card brand banner)
//   - "Discover.com" (their URL — only on their own statements)
//   - "Cashback Bonus" (Discover's exclusive rewards program name)
// Any ONE of these is unique enough.  Plain "Discover" or "Card Ending In"
// alone is not — both appear in other banks' transaction descriptions.
const DETECT_DISCOVER_IT = /\bDISCOVER\s+IT\b/i;
const DETECT_DISCOVER_URL = /\bDiscover\.com\b/i;
const DETECT_CASHBACK_BONUS = /\bCashback\s+Bonus\b/i;

function detect(textSample: string): boolean {
  return (
    DETECT_DISCOVER_IT.test(textSample) ||
    DETECT_DISCOVER_URL.test(textSample) ||
    DETECT_CASHBACK_BONUS.test(textSample)
  );
}

const CARD_ENDING_RE = /CARD\s+ENDING\s+(?:IN\s+)?(\d{3,5})/i;
const PERIOD_RE =
  /(?:OPEN\s+TO\s+CLOSE\s+DATE:?\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const PAYMENT_DUE_RE = /Payment\s+Due\s+Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const MIN_PAYMENT_RE =
  /Minimum\s+Payment\s+Due\s+\$?\s*((?:\d{1,3}(?:,\d{3})*|\d+)?(?:\.\d{1,2})?)/i;

function normalizeUS(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3) throw new ParseError(`discover: bad date ${date}`);
  const yy = parts[2]!.length === 2 ? `20${parts[2]}` : parts[2]!;
  return `${yy}-${parts[0]!.padStart(2, '0')}-${parts[1]!.padStart(2, '0')}`;
}

interface Period {
  start: string;
  end: string;
  start_year: number;
  end_year: number;
}

function extractPeriod(flatText: string): Period | null {
  const m = PERIOD_RE.exec(flatText);
  if (!m || !m[1] || !m[2]) return null;
  const start = normalizeUS(m[1]);
  const end = normalizeUS(m[2]);
  return {
    start,
    end,
    start_year: parseInt(start.slice(0, 4), 10),
    end_year: parseInt(end.slice(0, 4), 10)
  };
}

function extractAccountLast4(flatText: string): string | null {
  const m = CARD_ENDING_RE.exec(flatText);
  if (!m || !m[1]) return null;
  return m[1].slice(-4).padStart(4, '0');
}

function extractPaymentDueDate(flatText: string): string | null {
  const m = PAYMENT_DUE_RE.exec(flatText);
  if (!m || !m[1]) return null;
  try {
    return normalizeUS(m[1]);
  } catch {
    return null;
  }
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

interface DiscoverSummary {
  previous_balance: bigint | null;
  payments_and_credits: bigint | null; // absolute
  purchases: bigint | null;
  balance_transfers: bigint | null;
  cash_advances: bigint | null;
  fees_charged: bigint | null;
  interest_charged: bigint | null;
  new_balance: bigint | null;
  credit_line: bigint | null;
  credit_line_available: bigint | null;
}

const SUMMARY_LABELS: Record<keyof DiscoverSummary, RegExp> = {
  previous_balance: /^Previous\s+Balance$/i,
  payments_and_credits: /^Payments\s+and\s+Credits$/i,
  purchases: /^Purchases$/i,
  balance_transfers: /^Balance\s+Transfers$/i,
  cash_advances: /^Cash\s+Advances$/i,
  fees_charged: /^Fees\s+Charged$/i,
  interest_charged: /^Interest\s+Charged$/i,
  new_balance: /^New\s+Balance:?$/i,
  credit_line: /^Credit\s+Line$/i,
  credit_line_available: /^Credit\s+Line\s+Available$/i
};

function extractAccountSummary(rows: LayoutRow[]): DiscoverSummary {
  const out: DiscoverSummary = {
    previous_balance: null,
    payments_and_credits: null,
    purchases: null,
    balance_transfers: null,
    cash_advances: null,
    fees_charged: null,
    interest_charged: null,
    new_balance: null,
    credit_line: null,
    credit_line_available: null
  };
  for (const row of rows) {
    const cells = row.items.map((i) => i.text.trim()).filter((s) => s.length > 0);
    if (cells.length < 2) continue;
    const moneyIdx = cells.findIndex((c) => /^[-+]?\$?\s*[\d.,]/.test(c));
    if (moneyIdx < 1) continue;
    const label = cells.slice(0, moneyIdx).join(' ').replace(/\s+/g, ' ').trim();
    const moneyText = cells[moneyIdx]!.replace(/\s+/g, '');
    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof DiscoverSummary>) {
      if (!SUMMARY_LABELS[key].test(label)) continue;
      try {
        const cleaned = moneyText.replace(/^\+\s*/, '');
        const signed = parseMoney(cleaned);
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
// NB: Discover's section headers appear EMBEDDED in a column-header row
// (e.g., "TRANS. DATE PAYMENTS AND CREDITS AMOUNT"), not on their own line.
// We accept any row that CONTAINS the section's name.
const PAYMENTS_HDR_RE = /\bPAYMENTS\s+AND\s+CREDITS\b/i;
const PURCHASES_HDR_RE = /\bPURCHASES\b(?!\s+AND)/i; // exclude "PURCHASES AND CREDITS"
const FEES_INTEREST_HDR_RE = /^Fees\s+and\s+Interest\s+Charged$/i;
const TOTAL_FEES_RE = /^TOTAL\s+FEES\s+FOR\s+THIS\s+PERIOD$/i;
const TOTAL_INTEREST_RE = /^TOTAL\s+INTEREST\s+FOR\s+THIS\s+PERIOD$/i;
const END_OF_SECTION_RE = /Interest\s+Charge\s+Calculation|Information\s+For\s+You/i;

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
    throw new ParseError(`discover: invalid MM/DD ${mmdd}`);
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

  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    if (PAYMENTS_HDR_RE.test(text)) {
      section = 'payments';
      continue;
    }
    if (PURCHASES_HDR_RE.test(text)) {
      section = 'purchases';
      continue;
    }
    if (FEES_INTEREST_HDR_RE.test(text)) {
      // The "Fees and Interest Charged" section is summary-only on Discover —
      // no per-line transactions, just totals.
      section = null;
      continue;
    }
    if (TOTAL_FEES_RE.test(text) || TOTAL_INTEREST_RE.test(text)) continue;
    if (END_OF_SECTION_RE.test(text)) {
      section = null;
      continue;
    }
    if (section === null) continue;

    const firstNonEmpty = row.items.find((i) => i.text.trim() !== '');
    if (!firstNonEmpty) continue;
    if (!MMDD_RE.test(firstNonEmpty.text.trim())) continue;

    const dateText = firstNonEmpty.text.trim();

    // Find amount (rightmost money-like at x >= 350).
    let amountIdx = -1;
    for (let i = row.items.length - 1; i >= 0; i--) {
      const it = row.items[i]!;
      const t = it.text.trim();
      if (t === '' || it.x < 350) continue;
      if (/^[-+]?\s*\$?\s*\.?\d/.test(t)) {
        amountIdx = i;
        break;
      }
    }
    if (amountIdx < 0) continue;

    let printedAmount: bigint;
    try {
      printedAmount = parseMoney(row.items[amountIdx]!.text);
    } catch (err) {
      throw new ParseError(
        `discover: cannot parse amount ${JSON.stringify(
          row.items[amountIdx]!.text
        )} on row dated ${dateText} (${err instanceof Error ? err.message : String(err)})`
      );
    }

    const description = row.items
      .filter((it, idx) => {
        if (it === firstNonEmpty) return false;
        if (idx === amountIdx) return false;
        return it.text.trim().length > 0;
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
      transaction_type: txnTypeForRow(section)
    });
  }
  return transactions;
}

function buildSummaryLines(s: DiscoverSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null, sign: 1n | -1n = 1n) => {
    if (value === null) return;
    lines.push({ label, amount_minor: sign * value });
  };
  push('Previous Balance', s.previous_balance);
  push('Payments and Credits', s.payments_and_credits, -1n);
  push('Purchases', s.purchases);
  push('Balance Transfers', s.balance_transfers);
  push('Cash Advances', s.cash_advances);
  push('Fees Charged', s.fees_charged);
  push('Interest Charged', s.interest_charged);
  push('New Balance', s.new_balance);
  push('Credit Line', s.credit_line);
  push('Credit Line Available', s.credit_line_available);
  return lines;
}

export const discoverCreditCardAdapter: BankAdapter = {
  name: 'layout-discover-credit-card',
  version: '0.1.0',
  bank_name: 'Discover',
  detect,
  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) throw new ParseError('discover: PDF has no pages');

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

    if (period === null) throw new ParseError('discover: could not find statement period');
    if (summary.previous_balance === null || summary.new_balance === null) {
      throw new ParseError(
        'discover: could not find Previous Balance or New Balance in Account Summary'
      );
    }

    const transactions = extractTransactions(rows, period);

    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    const parser_provides: ChecksumLevel[] = ['C'];
    if (transactions.length > 0) {
      parser_provides.push('D');
      const debitFields: Array<bigint | null> = [
        summary.purchases,
        summary.balance_transfers,
        summary.cash_advances,
        summary.fees_charged,
        summary.interest_charged
      ];
      if (debitFields.every((f) => f !== null) && summary.payments_and_credits !== null) {
        total_debits_minor = debitFields.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
        total_credits_minor = summary.payments_and_credits;
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

    return { statement, transactions, suggested_account_nickname: 'Discover' };
  }
};
