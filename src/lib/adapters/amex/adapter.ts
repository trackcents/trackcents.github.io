// American Express Blue Cash Everyday adapter.
//
// Also handles other Amex consumer cards (Gold, Platinum, etc.) — they share
// the same statement template per Amex's "How to Read Your Credit Card
// Statement" reference doc.
//
// Statement anatomy (typical 4-8 page statement):
//   Page 1   Card banner + "Prepared for" + "Account Ending N-NNNNN" +
//            "Closing Date MM/DD/YYYY" + Payment Summary + Account Summary
//            + Credit Summary + YTD totals + Rewards Summary
//   Page 2   "Payments and Credits Summary" + "Payments Details" + transactions
//            + "New Charges Summary" + "New Charges Details" + transactions
//            + Fees + Interest Charged + Interest Calculation
//   Page 3+  Legal / IMPORTANT NOTICES
//
// Distinct from Chase CC:
//   - Date format is MM/DD/YYYY (full year), not MM/DD
//   - Account number prints as "Account Ending 2-03004" (dash, 5-digit suffix)
//   - Multi-row continuations carry merchant phone+email below each charge
//   - "Days in Billing Period: NN" prints explicitly; period_start derived
//
// Sign convention (same as Chase CC):
//   - Payment rows printed -$X.XX → invert to positive (inflow to card)
//   - New charge rows printed $X.XX → invert to negative (outflow)

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
const DETECT_BRAND =
  /\b(?:Blue\s+Cash\s+(?:Everyday|Preferred)|Amex\s+(?:Gold|Platinum|Green|Business)|American\s+Express\s+Card)\b/i;
const DETECT_FALLBACK_AMEX = /\b(?:American\s+Express|americanexpress\.com)\b/i;
const DETECT_FALLBACK_FIELDS = /Account\s+Ending\s+\d[-\s]?\d{3,6}/i;

function detect(textSample: string): boolean {
  if (DETECT_BRAND.test(textSample)) return true;
  return DETECT_FALLBACK_AMEX.test(textSample) && DETECT_FALLBACK_FIELDS.test(textSample);
}

// ── Account number / closing date / billing days ─────────────────────────────
// "Account Ending 2-03004" → last 4 chars after the dash = "3004"
const ACCOUNT_ENDING_RE = /Account\s+Ending\s+(\d)[-\s]?(\d{3,6})/i;
const CLOSING_DATE_RE = /Closing\s+Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const DAYS_IN_BILLING_RE = /Days\s+in\s+Billing\s+Period:\s+(\d{1,3})/i;
const PAYMENT_DUE_DATE_RE = /Payment\s+Due\s+Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const MIN_PAYMENT_DUE_RE =
  /Minimum\s+Payment\s+Due\s+\$?\s*((?:\d{1,3}(?:,\d{3})*|\d+)?(?:\.\d{1,2})?)/i;

interface Period {
  start: string;
  end: string;
  start_year: number;
  end_year: number;
}

function normalize(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new ParseError(`amex: cannot normalize date ${date}`);
  }
  const mm = parts[0].padStart(2, '0');
  const dd = parts[1].padStart(2, '0');
  const yyRaw = parts[2];
  const yyyy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function extractPeriod(flatText: string): Period | null {
  const m = CLOSING_DATE_RE.exec(flatText);
  if (!m || !m[1]) return null;
  const end = normalize(m[1]);
  const daysMatch = DAYS_IN_BILLING_RE.exec(flatText);
  // Default to 30 days if "Days in Billing Period" line is missing.
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
  const m = ACCOUNT_ENDING_RE.exec(flatText);
  if (!m || !m[2]) return null;
  // Amex's "2-03004" → 5-digit suffix.  Take the last 4 chars for consistency
  // with other adapters (which always store account_last_4 as exactly 4).
  return m[2].slice(-4);
}

function extractPaymentDueDate(flatText: string): string | null {
  const m = PAYMENT_DUE_DATE_RE.exec(flatText);
  if (!m || !m[1]) return null;
  try {
    return normalize(m[1]);
  } catch {
    return null;
  }
}

function extractMinimumPaymentDue(flatText: string): bigint | null {
  const m = MIN_PAYMENT_DUE_RE.exec(flatText);
  if (!m || !m[1] || m[1] === '') return null;
  try {
    return parseMoney(m[1]);
  } catch {
    return null;
  }
}

// ── Account Summary box (the 6-row block on page 1) ──────────────────────────
interface AccountSummary {
  previous_balance: bigint | null;
  less_payments_credits: bigint | null; // absolute (Amex prints positive in this row)
  plus_new_charges: bigint | null;
  plus_fees: bigint | null;
  plus_interest_charged: bigint | null;
  equals_new_balance: bigint | null;
  credit_limit: bigint | null;
  available_credit: bigint | null;
}

const SUMMARY_LABELS: Record<keyof AccountSummary, RegExp> = {
  previous_balance: /^Previous\s+Balance$/i,
  less_payments_credits: /^Less\s+Payments\/?\s*Credits$/i,
  plus_new_charges: /^Plus\s+New\s+Charges$/i,
  plus_fees: /^Plus\s+Fees$/i,
  plus_interest_charged: /^Plus\s+Interest\s+Charged$/i,
  equals_new_balance: /^Equals\s+New\s+Balance$/i,
  credit_limit: /^Credit\s+Limit$/i,
  available_credit: /^Available\s+Credit$/i
};

function extractAccountSummary(rows: LayoutRow[]): AccountSummary {
  const out: AccountSummary = {
    previous_balance: null,
    less_payments_credits: null,
    plus_new_charges: null,
    plus_fees: null,
    plus_interest_charged: null,
    equals_new_balance: null,
    credit_limit: null,
    available_credit: null
  };

  for (const row of rows) {
    const cells = row.items.map((i) => i.text.trim()).filter((s) => s.length > 0);
    if (cells.length < 2) continue;
    const moneyIdx = cells.findIndex((c) => /^[-$+]?\s*\$?\s*[\d.,]/.test(c));
    if (moneyIdx < 1) continue;
    const label = cells.slice(0, moneyIdx).join(' ').replace(/\s+/g, ' ').trim();
    const moneyText = cells[moneyIdx]!.replace(/^\+\s*/, '');

    for (const key of Object.keys(SUMMARY_LABELS) as Array<keyof AccountSummary>) {
      if (!SUMMARY_LABELS[key].test(label)) continue;
      try {
        const signed = parseMoney(moneyText);
        // Preserve sign on the two balance lines; absolute for the
        // additive/subtractive rows (the "Plus"/"Less" prefixes encode the
        // direction, not the value's sign).
        const signPreserving = key === 'previous_balance' || key === 'equals_new_balance';
        out[key] = signPreserving ? signed : signed < 0n ? -signed : signed;
      } catch {
        /* leave null */
      }
      break;
    }
  }
  return out;
}

// ── Transaction extraction ───────────────────────────────────────────────────
// Two sections to parse: "Payments Details" (printed amounts are negative
// "-$X.XX") and "New Charges Details" (printed positive "$X.XX").  Section
// boundaries are explicit text headers in the document.

const MMDDYYYY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\*?$/;
const AMOUNT_LIKE_RE = /^[-+]?\s*\$?\s*\.?\d/;
const PAYMENTS_DETAILS_RE = /^Payments\s+Details$/i;
const NEW_CHARGES_DETAILS_RE = /^New\s+Charges\s+Details$/i;
const FEES_HEADER_RE = /^Fees$/i;
const INTEREST_CHARGED_HEADER_RE = /^Interest\s+Charged$/i;
const SECTION_END_RE =
  /\b(?:Fees|Interest\s+Charged|About\s+Trailing\s+Interest|Interest\s+Charge\s+Calculation|IMPORTANT\s+NOTICES|Important\s+Information)\b/i;

type Section = 'payments' | 'charges' | 'fees' | 'interest' | null;

function txnTypeForRow(section: Section, description: string): TransactionType {
  switch (section) {
    case 'payments':
      // All rows here are credits to the card.  Amex labels payments as
      // "MOBILE PAYMENT - THANK YOU" / "ONLINE PAYMENT - THANK YOU" /
      // "AUTOPAY PAYMENT - THANK YOU".  Treat all as payment_to_card unless
      // the description explicitly says "REFUND" / "CREDIT" (merchant-side
      // credits Amex bundles into this section in rare cases).
      if (/\bREFUND\b/i.test(description) || /\bMERCHANT\s+CREDIT\b/i.test(description)) {
        return 'refund';
      }
      return 'payment_to_card';
    case 'charges':
      // Foreign-transaction fees and other non-purchase rows could appear
      // here too, but Amex generally puts them in the Fees section.
      return 'purchase';
    case 'fees':
      return 'fee';
    case 'interest':
      return 'interest';
    default:
      return 'other';
  }
}

function normalizeMMDDYYYY(mm: string, dd: string, yy: string): string {
  const mmPad = mm.padStart(2, '0');
  const ddPad = dd.padStart(2, '0');
  const yyyy = yy.length === 2 ? `20${yy}` : yy;
  return `${yyyy}-${mmPad}-${ddPad}`;
}

export function extractTransactions(rows: LayoutRow[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let section: Section = null;

  for (const row of rows) {
    const text = rowText(row).trim();
    if (text === '') continue;

    // Section transitions.
    if (PAYMENTS_DETAILS_RE.test(text)) {
      section = 'payments';
      continue;
    }
    if (NEW_CHARGES_DETAILS_RE.test(text)) {
      section = 'charges';
      continue;
    }
    if (FEES_HEADER_RE.test(text)) {
      section = 'fees';
      continue;
    }
    if (INTEREST_CHARGED_HEADER_RE.test(text)) {
      // Only switch to "interest" mode if we haven't already passed the
      // "About Trailing Interest" / "Interest Charge Calculation" boilerplate.
      section = 'interest';
      continue;
    }
    if (SECTION_END_RE.test(text) && section !== null) {
      // Reached legal / calculation boilerplate; stop parsing.
      if (
        /IMPORTANT\s+NOTICES|Important\s+Information|Interest\s+Charge\s+Calculation/i.test(text)
      ) {
        section = null;
        continue;
      }
    }
    if (section === null) continue;

    // Header rows ("Date | Description | Amount") and summary rows ("Total
    // Payments and Credits") are skipped — they don't have a leading date.
    const firstItem = row.items.find((i) => i.text.trim() !== '');
    if (!firstItem) continue;
    const dateMatch = MMDDYYYY_RE.exec(firstItem.text.trim());
    if (!dateMatch) {
      // Could be a multi-row continuation (phone/email line under merchant).
      // Append to the previous transaction's description.
      if (
        transactions.length > 0 &&
        firstItem.x >= 95 &&
        firstItem.x <= 130 &&
        /^[\w*]/.test(firstItem.text.trim())
      ) {
        const last = transactions[transactions.length - 1]!;
        const continuationText = row.items
          .map((it) => it.text.trim())
          .filter((s) => s.length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Only treat as continuation if it doesn't itself contain an amount.
        const hasAmount = row.items.some(
          (it) => it.x >= 500 && AMOUNT_LIKE_RE.test(it.text.trim())
        );
        if (!hasAmount && continuationText.length > 0) {
          last.description = `${last.description} (${continuationText})`;
          last.raw_text = `${last.raw_text}\n${rowText(row, '\t')}`;
        }
      }
      continue;
    }

    // It's a transaction row.
    const dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
    const postedDate = normalizeMMDDYYYY(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!);

    // Find the amount (rightmost money-shaped item at x >= 500).
    let amountItem: { it: { text: string; x: number }; idx: number } | null = null;
    for (let i = row.items.length - 1; i >= 0; i--) {
      const it = row.items[i]!;
      const t = it.text.trim();
      if (t === '' || it.x < 500) continue;
      if (AMOUNT_LIKE_RE.test(t)) {
        amountItem = { it, idx: i };
        break;
      }
    }
    if (amountItem === null) continue; // Header-ish row without amount

    let printedAmount: bigint;
    try {
      printedAmount = parseMoney(amountItem.it.text);
    } catch (err) {
      throw new ParseError(
        `amex: cannot parse amount ${JSON.stringify(amountItem.it.text)} on row dated ${dateText} (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }

    const description = row.items
      .filter((it) => it !== firstItem && it !== amountItem!.it && it.text.trim() !== '')
      .sort((a, b) => a.x - b.x)
      .map((it) => it.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    transactions.push({
      posted_date: postedDate,
      description,
      raw_text: rowText(row, '\t'),
      // INVERT sign per ParsedTransaction contract.
      amount_minor: -printedAmount,
      currency: 'USD',
      transaction_type: txnTypeForRow(section, description)
    });
  }
  return transactions;
}

// ── summary_lines for the UI ─────────────────────────────────────────────────
function buildSummaryLines(s: AccountSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, value: bigint | null, sign: 1n | -1n = 1n) => {
    if (value === null) return;
    lines.push({ label, amount_minor: sign * value });
  };
  push('Previous Balance', s.previous_balance);
  push('Less Payments/Credits', s.less_payments_credits, -1n);
  push('Plus New Charges', s.plus_new_charges);
  push('Plus Fees', s.plus_fees);
  push('Plus Interest Charged', s.plus_interest_charged);
  push('Equals New Balance', s.equals_new_balance);
  push('Credit Limit', s.credit_limit);
  push('Available Credit', s.available_credit);
  return lines;
}

// ── Adapter export ───────────────────────────────────────────────────────────
export const amexAdapter: BankAdapter = {
  name: 'layout-amex',
  version: '0.1.0',
  bank_name: 'American Express',
  detect,
  async parse(pdf: PdfTextWithPositions): Promise<ParseResult> {
    if (pdf.pages.length === 0) throw new ParseError('amex: PDF has no pages');

    const rows = groupAllRows(pdf.pages, 3);
    const flatText = pdf.pages
      .flatMap((p) => p.items.map((i) => i.text))
      .join(' ')
      .replace(/\s+/g, ' ');

    const summary = extractAccountSummary(rows);
    const period = extractPeriod(flatText);
    const last4 = extractAccountLast4(flatText);
    const paymentDueDate = extractPaymentDueDate(flatText);
    const minPaymentDue = extractMinimumPaymentDue(flatText);

    if (period === null) {
      throw new ParseError('amex: could not find Closing Date');
    }
    if (summary.previous_balance === null || summary.equals_new_balance === null) {
      throw new ParseError(
        'amex: could not find Previous Balance or Equals New Balance in Account Summary'
      );
    }

    const transactions = extractTransactions(rows);

    // Checksum levels — Amex prints enough for Level B + C.
    let total_debits_minor: bigint | null = null;
    let total_credits_minor: bigint | null = null;
    const parser_provides: ChecksumLevel[] = ['C'];

    if (transactions.length > 0) {
      parser_provides.push('D');
      const debitFields: Array<bigint | null> = [
        summary.plus_new_charges,
        summary.plus_fees,
        summary.plus_interest_charged
      ];
      if (debitFields.every((f) => f !== null) && summary.less_payments_credits !== null) {
        total_debits_minor = debitFields.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
        total_credits_minor = summary.less_payments_credits;
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
      statement_balance_minor: summary.equals_new_balance,
      printed_transaction_count: transactions.length > 0 ? transactions.length : null,
      summary_lines: buildSummaryLines(summary),
      payment_due_date: paymentDueDate,
      statement_date: period.end,
      minimum_payment_due_minor: minPaymentDue,
      parser_provides
    };

    return { statement, transactions, suggested_account_nickname: 'Amex Blue Cash' };
  }
};
