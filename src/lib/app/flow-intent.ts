/**
 * Flow-intent classifier (REQ-B0.1) — the root fix.
 *
 * The original "Spent this month" computation summed every outflow, which
 * counted CC payments, investment transfers, and inter-account moves as
 * "spending."  The user's real Chase May statement showed -$14,356 of outflows
 * but ~$8,400 of that was CC payments + investments + transfers — all of which
 * are accounted for elsewhere (CC purchases live on the CC side; investments
 * are savings, not spend; transfers between own accounts net to zero).
 *
 * This module classifies every transaction into a `flow_intent` so the Spent /
 * Income / Transfer projections each draw from the right subset.  The
 * classification is DETERMINISTIC and STRUCTURE-based (description + context),
 * never amount-based (constitution Principle IX restated by feedback memo
 * `feedback_no_amount_based_classification`).
 *
 * Inference precedence (highest wins):
 *   1. Reconciliation: if the orchestrator has linked this bank-side outflow
 *      to a credit-card statement → `cc_payment`.
 *   2. Transfer-detector pair: this transaction is one leg of a paired
 *      outflow↔inflow across two of the user's own accounts → `transfer_self`.
 *   3. Built-in patterns (this file) — the seed rules from REQ-B0.2.
 *   4. User-defined rules (carries `flow_intent` if the user set one).
 *   5. Sign-of-amount default: outflow → `purchase`, inflow → `gift_in`.
 *
 * `cleanDescription` is applied before pattern matching so ACH metadata
 * (PPD ID:..., Web ID:..., MM/DD prefix) does not confuse the regex.
 */

import { cleanDescription } from '../util/description-clean';

export type FlowIntent =
  | 'purchase' // real spend — counts toward Spent
  | 'bill_pay' // recurring living expense (rent, utility, phone) — counts toward Spent
  | 'loan_payment' // auto loan / Affirm / student loan — counts toward Spent
  | 'cc_payment' // bank → CC payment — EXCLUDED from Spent (purchases live on CC side)
  | 'transfer_self' // money moved between user's own accounts — EXCLUDED from Spent
  | 'investment_out' // brokerage / IRA / retirement contribution — EXCLUDED from Spent
  | 'salary' // recurring paycheck — counts toward Income
  | 'refund' // merchant credit reversing a purchase — reduces Spent
  | 'interest_earned' // bank interest or dividend — counts toward Income
  | 'interest_charged' // CC interest charge — counts toward Spent (it's money lost)
  | 'fees' // overdraft / late / foreign-txn fee — counts toward Spent
  | 'gift_in' // unmatched inflow (Zelle from a person) — counts toward Income
  | 'cash_in' // ATM deposit, check deposit — counts toward Income with flag
  | 'cash_out' // ATM withdrawal — counts toward Spent
  | 'unknown'; // not yet classified — counts toward Spent by DEFAULT with a "review" flag

/** Flow intents the user-visible "Spent" calculation must INCLUDE. */
export const SPEND_INTENTS: ReadonlySet<FlowIntent> = new Set<FlowIntent>([
  'purchase',
  'bill_pay',
  'loan_payment',
  'interest_charged',
  'fees',
  'cash_out',
  'unknown'
]);

/** Flow intents that count toward Income. */
export const INCOME_INTENTS: ReadonlySet<FlowIntent> = new Set<FlowIntent>([
  'salary',
  'interest_earned',
  'gift_in',
  'cash_in'
]);

/** Flow intents that are MONEY MOVEMENT — neither spend nor income. */
export const MOVEMENT_INTENTS: ReadonlySet<FlowIntent> = new Set<FlowIntent>([
  'cc_payment',
  'transfer_self',
  'investment_out'
]);

/** Refunds are special — they reduce a category's Spent total. */
export const REFUND_INTENTS: ReadonlySet<FlowIntent> = new Set<FlowIntent>(['refund']);

/**
 * Built-in pattern map.  Patterns are case-insensitive regexes applied to the
 * CLEANED description (Web ID / PPD ID stripped).  Tested against real
 * Chase / BofA / Amex / Robinhood descriptions from temp3.
 *
 * Order = priority.  First match wins.  More-specific patterns appear before
 * more-general ones (e.g. "Robinhood Securities" before "Robinhood").
 */
interface BuiltinPattern {
  /** Regex tested against cleanDescription(raw).  Case-insensitive. */
  re: RegExp;
  /** The intent this pattern asserts. */
  intent: FlowIntent;
  /** Only applies when amount sign matches this direction (or undefined = any). */
  direction?: 'out' | 'in';
  /** Short human label — used by the categorization layer when seeding rules. */
  label: string;
}

const BUILTIN_PATTERNS: ReadonlyArray<BuiltinPattern> = [
  // ── INVESTMENTS (specific first) ─────────────────────────────────────────
  {
    re: /\bROBINHOOD\s+SECURITIES\b/i,
    intent: 'investment_out',
    direction: 'out',
    label: 'Investment'
  },
  {
    re: /\bONLINE\s+REALTIME\s+PAYMENT\s+TO\s+ROBINHOOD\s+SECURITIES\b/i,
    intent: 'investment_out',
    direction: 'out',
    label: 'Investment'
  },
  {
    re: /\bFIDELITY\s+\d+\s+P?\s*FPRS?\b/i,
    intent: 'investment_out',
    direction: 'out',
    label: 'Investment'
  },
  { re: /\bVANGUARD\b/i, intent: 'investment_out', direction: 'out', label: 'Investment' },
  {
    re: /\b(SCHWAB|COINBASE|INTERACTIVE\s*BROKERS)\b/i,
    intent: 'investment_out',
    direction: 'out',
    label: 'Investment'
  },

  // ── CC PAYMENTS (the user is paying down a CC from their bank) ──────────
  // These appear on the BANK side; the corresponding charges live on the CC side.
  {
    re: /\bPAYMENT\s+TO\s+CHASE\s+CARD\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bPAYMENT\s+TO\s+BOFA\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bROBINHOOD\s+CARD\s+PAYMENT\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bDISCOVER\s+E-?PAYMENT\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bAMERICAN\s+EXPRESS\s+ACH\s+PMT\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bBK?\s+OF\s+AMER(?:ICA)?\s+VISA\s+ONLINE\s+P(?:AY)?MT\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\bBANK\s+OF\s+AMERICA\s+PAYMENT\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  {
    re: /\b(CHASE|CITI|CAPITAL\s*ONE)\s+AUTOPAY\b/i,
    intent: 'cc_payment',
    direction: 'out',
    label: 'CC Payment'
  },
  // The "PAYMENT - THANK YOU" line on a CC statement is the SAME money received
  // by the CC side.  Treat as cc_payment so we don't count it as income.
  {
    re: /\bPAYMENT\s*-?\s*THANK\s*YOU\b/i,
    intent: 'cc_payment',
    direction: 'in',
    label: 'CC Payment (received)'
  },

  // ── TRANSFERS (cross-account moves the user makes themselves) ────────────
  {
    re: /\bKITSAP\s+CU\s+TRANSFER\b/i,
    intent: 'transfer_self',
    label: 'Transfer'
  },
  {
    re: /\b(TRANSFER|XFER)\b.*\b(TO|FROM)\b/i,
    intent: 'transfer_self',
    label: 'Transfer'
  },
  {
    re: /\bONLINE\s+BANKING\s+TRANSFER\b/i,
    intent: 'transfer_self',
    label: 'Transfer'
  },

  // ── SALARY (recurring paycheck) ──────────────────────────────────────────
  // The actual recurrence is confirmed by the paycheck-detector; this pattern
  // labels obvious payroll descriptors so they don't fall through to gift_in.
  {
    re: /\b(PAYROLL|SALARY)\b/i,
    intent: 'salary',
    direction: 'in',
    label: 'Income (salary)'
  },
  {
    re: /\bALTERA\s+CORPORATI?\s+PAYROLL\b/i,
    intent: 'salary',
    direction: 'in',
    label: 'Income (salary)'
  },
  { re: /\bINFOSYS\b/i, intent: 'salary', direction: 'in', label: 'Income (salary)' },

  // ── INTEREST / FEES ──────────────────────────────────────────────────────
  {
    re: /\bINTEREST\s+CHARGE(\s+ON\s+(PURCHASES|CASH\s+ADVANCES))?\b/i,
    intent: 'interest_charged',
    direction: 'out',
    label: 'Fees & interest'
  },
  {
    re: /\bINTEREST\s+(EARNED|PAID)\b/i,
    intent: 'interest_earned',
    direction: 'in',
    label: 'Interest earned'
  },
  { re: /\bDIVIDEND\b/i, intent: 'interest_earned', direction: 'in', label: 'Interest earned' },
  {
    re: /\b(LATE\s+FEE|OVERDRAFT\s+FEE|FOREIGN\s+TXN\s+FEE|ANNUAL\s+FEE)\b/i,
    intent: 'fees',
    direction: 'out',
    label: 'Fees & interest'
  },

  // ── LOAN PAYMENTS ────────────────────────────────────────────────────────
  // The auto loan principal+interest IS spending (money leaves your life),
  // even though it pays down debt.  Distinguished from CC payments because
  // the CC purchases are accounted for separately; the loan principal is not.
  { re: /\bVW\s+CREDIT\b/i, intent: 'loan_payment', direction: 'out', label: 'Loan/Installment' },
  { re: /\bAFFIRM\.?COM\b/i, intent: 'loan_payment', direction: 'out', label: 'Loan/Installment' },
  { re: /\bKLARNA\b/i, intent: 'loan_payment', direction: 'out', label: 'Loan/Installment' },
  { re: /\bPENNYMAC\b/i, intent: 'bill_pay', direction: 'out', label: 'Rent/Mortgage' },
  { re: /\bROCKETMTG\b/i, intent: 'bill_pay', direction: 'out', label: 'Rent/Mortgage' },

  // ── BILLS (rent, utility, phone, insurance, subscriptions) ──────────────
  { re: /\bRENT\b/i, intent: 'bill_pay', direction: 'out', label: 'Rent/Mortgage' },
  {
    re: /\b(AT\s*&?\s*T|VERIZON|T-?MOBILE|COMCAST|XFINITY|SPECTRUM|JIO|AIRTEL)\b/i,
    intent: 'bill_pay',
    direction: 'out',
    label: 'Phone & Internet'
  },
  {
    re: /\b(GEICO|PROGRESSIVE|STATE\s+FARM|ALLSTATE|AMERICAN\s+GEN\s+LIF|LIC|HDFC\s+LIFE)\b/i,
    intent: 'bill_pay',
    direction: 'out',
    label: 'Insurance'
  },
  {
    re: /\b(NETFLIX|SPOTIFY|HULU|DISNEY|AMAZON\s+PRIME|OPENAI|CHATGPT|CLAUDE|ANTHROPIC|ICLOUD|GOOGLE\s+STORAGE)\b/i,
    intent: 'bill_pay',
    direction: 'out',
    label: 'Subscriptions'
  },

  // ── REFUNDS / RETURNS ────────────────────────────────────────────────────
  {
    re: /\bCARD\s+PURCHASE\s+RETURN\b/i,
    intent: 'refund',
    direction: 'in',
    label: 'Refund'
  },
  { re: /\bRETURN\b.*\bCREDIT\b/i, intent: 'refund', direction: 'in', label: 'Refund' },

  // ── CASH ATM / CHECK DEPOSITS ────────────────────────────────────────────
  {
    re: /\b(ATM\s+WITHDRAWAL|ATM\s+CASH)\b/i,
    intent: 'cash_out',
    direction: 'out',
    label: 'Cash'
  },
  {
    re: /\b(CHECK\s+DEPOSIT|REMOTE\s+DEPOSIT|MOBILE\s+DEPOSIT)\b/i,
    intent: 'cash_in',
    direction: 'in',
    label: 'Cash'
  }
];

export interface FlowIntentContext {
  /** Stable key — `<pdf_source_hash>#<txIndex>`. */
  key: string;
  /** ISO YYYY-MM-DD. */
  posted_date: string;
  /** Raw description from the parser (`ParsedTransaction.description`). */
  description: string;
  /** Signed integer cents — negative = outflow. */
  amount_minor: bigint;
  /** Stable bank+account+last4 identifier (so transfer pairs can distinguish accounts). */
  account_id: string;
  /** Is this an account_type === 'credit_card' transaction? (purchases on CC stay 'purchase'). */
  is_credit_card_row: boolean;
  /** Set of transaction keys the orchestrator has identified as a CC payment via reconciliation. */
  reconciled_cc_payment_keys?: ReadonlySet<string>;
  /** Set of transaction keys belonging to a detected transfer-pair (either leg). */
  transfer_pair_keys?: ReadonlySet<string>;
  /** Set of transaction keys belonging to a detected paycheck (recurring salary). */
  paycheck_keys?: ReadonlySet<string>;
  /** User-overridden intent (from a category rule or explicit annotation). */
  user_intent?: FlowIntent;
}

/** Identify a built-in pattern hit for a description.  Exported for the rule seeder. */
export function findBuiltinPattern(
  description: string,
  direction: 'in' | 'out'
): { intent: FlowIntent; label: string } | null {
  const cleaned = cleanDescription(description);
  if (cleaned === '') return null;
  for (const p of BUILTIN_PATTERNS) {
    if (p.direction !== undefined && p.direction !== direction) continue;
    if (p.re.test(cleaned)) {
      return { intent: p.intent, label: p.label };
    }
  }
  return null;
}

/**
 * Build a key→flow_intent map for an entire set of imports, applying
 * transfer-detection and paycheck-detection upstream so the inference has
 * full context.  Pure; deterministic.  This is the canonical "classify every
 * row" entry point used by Home / Budget / Dashboard projections.
 *
 * Caller passes pre-computed sets so we don't duplicate detector work:
 *   - `reconciledCcPayments`: keys identified as bank→CC payments by the
 *     reconciliation engine.
 *   - `transferPairKeys`: keys that appear in any TransferPair (either leg).
 *   - `paycheckKeys`: keys identified as recurring salary by the paycheck
 *     detector.
 *
 * Returns a Map keyed by the same `<pdf_source_hash>#<txIndex>` used by
 * categorization-glue and annotations.
 */
export function inferAllFlowIntents(
  rows: ReadonlyArray<{
    key: string;
    posted_date: string;
    description: string;
    amount_minor: bigint;
    account_id: string;
    is_credit_card_row: boolean;
    user_intent?: FlowIntent;
  }>,
  context: {
    reconciledCcPayments?: ReadonlySet<string>;
    transferPairKeys?: ReadonlySet<string>;
    paycheckKeys?: ReadonlySet<string>;
  } = {}
): Map<string, FlowIntent> {
  const out = new Map<string, FlowIntent>();
  const { reconciledCcPayments, transferPairKeys, paycheckKeys } = context;
  for (const r of rows) {
    const fic: FlowIntentContext = {
      key: r.key,
      posted_date: r.posted_date,
      description: r.description,
      amount_minor: r.amount_minor,
      account_id: r.account_id,
      is_credit_card_row: r.is_credit_card_row
    };
    if (reconciledCcPayments !== undefined) fic.reconciled_cc_payment_keys = reconciledCcPayments;
    if (transferPairKeys !== undefined) fic.transfer_pair_keys = transferPairKeys;
    if (paycheckKeys !== undefined) fic.paycheck_keys = paycheckKeys;
    if (r.user_intent !== undefined) fic.user_intent = r.user_intent;
    out.set(r.key, inferFlowIntent(fic));
  }
  return out;
}

/**
 * Infer the flow_intent for a single transaction given context.  Pure;
 * deterministic; uses ONLY structure and context, never amount magnitude.
 *
 * Precedence (highest first):
 *   1. User override (`user_intent`).
 *   2. Reconciliation (`reconciled_cc_payment_keys`).
 *   3. Transfer-detector pair (`transfer_pair_keys`).
 *   4. Paycheck-detector (`paycheck_keys`) — inflows only.
 *   5. Built-in pattern hit (this file).
 *   6. Sign-of-amount default.
 */
export function inferFlowIntent(ctx: FlowIntentContext): FlowIntent {
  // 1. User override — always wins.
  if (ctx.user_intent !== undefined) return ctx.user_intent;

  // 2. Reconciliation says this is a CC payment.
  if (ctx.reconciled_cc_payment_keys?.has(ctx.key)) return 'cc_payment';

  // 3. Transfer-detector paired this with an opposite-leg in another own account.
  if (ctx.transfer_pair_keys?.has(ctx.key)) return 'transfer_self';

  // 4. Paycheck detector identified this as a recurring salary deposit.
  if (ctx.amount_minor > 0n && ctx.paycheck_keys?.has(ctx.key)) return 'salary';

  // 5. Built-in pattern.
  const direction: 'in' | 'out' = ctx.amount_minor >= 0n ? 'in' : 'out';
  const hit = findBuiltinPattern(ctx.description, direction);
  if (hit !== null) {
    // For CC accounts: a CC's PAYMENT - THANK YOU line is the same money the
    // bank-side reconciliation already classified; we tag it as cc_payment on
    // the CC side too so we don't count it as income.  Purchases on a CC stay
    // 'purchase' regardless of `is_credit_card_row`.
    return hit.intent;
  }

  // 6. Default by sign.
  if (ctx.amount_minor < 0n) return ctx.is_credit_card_row ? 'purchase' : 'unknown';
  return 'gift_in';
}
