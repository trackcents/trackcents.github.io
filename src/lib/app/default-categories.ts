/**
 * Default category + rule seeding (REQ-B0.2).
 *
 * Real users imported 236 transactions and saw them all rendered as
 * "Uncategorized" because the app shipped with zero categories defined.  The
 * three-tier auto-categorizer had nothing to assign to.  This module fixes
 * the cold start: on first onboarding (and via Settings → Seed defaults), the
 * app creates a usable starter set of categories + rules so the user's first
 * import is mostly classified out of the box.
 *
 * Pure — no storage, no UI.  Callers persist the returned state via
 * saveCategorization().
 */

import type { Category, CategoryRule } from './categorization';

/** A stable id for each seed category so re-seeding is idempotent. */
function id(name: string): string {
  return (
    'seed-' +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

/** The default category set.  Order = display preference (most-used first). */
const SEED_CATEGORIES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Groceries', color: '#10b981' },
  // "Food" (formerly "Eating out") -- broader name covers Bhargav's
  // tiffin/biryani/chai entries AND Murali's DoorDash/Starbucks, so the
  // single label maps to both food shopping and dining-out without
  // forcing a sub-category yet (deferred to Batch C).
  { name: 'Food', color: '#f59e0b' },
  { name: 'Transport', color: '#6366f1' },
  { name: 'Gas', color: '#8b5cf6' },
  { name: 'Rent/Mortgage', color: '#ef4d63' },
  { name: 'Utilities', color: '#06b6d4' },
  { name: 'Phone & Internet', color: '#14b8a6' },
  { name: 'Insurance', color: '#84cc16' },
  { name: 'Healthcare', color: '#ec4899' },
  { name: 'Subscriptions', color: '#a855f7' },
  { name: 'Shopping', color: '#f97316' },
  { name: 'Travel', color: '#0ea5e9' },
  { name: 'Entertainment', color: '#d946ef' },
  { name: 'Education', color: '#22c55e' },
  { name: 'Gifts/Family', color: '#fb7185' },
  { name: 'Cash', color: '#64748b' },
  { name: 'Fees & interest', color: '#dc2626' },
  { name: 'Loan/Installment', color: '#7c3aed' },
  // ── Movement categories — used so the user can SEE these rows are tagged
  // even though they are excluded from "Spent" by their flow_intent. ────────
  { name: 'CC Payment', color: '#94a3b8' },
  { name: 'Transfer', color: '#94a3b8' },
  { name: 'Investment', color: '#0d9488' },
  { name: 'Refund', color: '#22c55e' },
  // ── Income side ─────────────────────────────────────────────────────────
  { name: 'Income (salary)', color: '#16a34a' },
  { name: 'Income (other)', color: '#16a34a' }
];

/**
 * Pattern → category mapping.  Used to seed CategoryRules so that
 * `applyRules()` matches at import time.  Patterns use the SAME contains-text
 * substring matching as the user's manual rules (case-insensitive).
 *
 * Patterns matching the same merchant on multiple lines (e.g. "Robinhood
 * Securities" before "Robinhood Card") — earlier rule wins in `applyRules`,
 * so put the SPECIFIC patterns first.
 */
const SEED_RULES: ReadonlyArray<{ contains: string; category: string }> = [
  // ── Investments (specific first) ────────────────────────────────────────
  // Hemanth's privacy scrub: stripped per-user account suffixes ("15105")
  // and balanced the list so no single broker stands out.  These are all
  // common US / India brokerages -- nothing identifies a person.
  { contains: 'ROBINHOOD SECURITIES', category: 'Investment' },
  { contains: 'FIDELITY', category: 'Investment' },
  { contains: 'VANGUARD', category: 'Investment' },
  { contains: 'SCHWAB', category: 'Investment' },
  { contains: 'MERRILL', category: 'Investment' },
  { contains: 'ETRADE', category: 'Investment' },
  { contains: 'E*TRADE', category: 'Investment' },
  { contains: 'TD AMERITRADE', category: 'Investment' },
  { contains: 'WEBULL', category: 'Investment' },
  { contains: 'BETTERMENT', category: 'Investment' },
  { contains: 'WEALTHFRONT', category: 'Investment' },
  { contains: 'COINBASE', category: 'Investment' },
  { contains: 'KRAKEN', category: 'Investment' },
  { contains: 'BINANCE', category: 'Investment' },
  { contains: 'ZERODHA', category: 'Investment' },
  { contains: 'GROWW', category: 'Investment' },
  { contains: 'UPSTOX', category: 'Investment' },
  { contains: 'ICICIDIRECT', category: 'Investment' },
  { contains: 'HDFC SECURITIES', category: 'Investment' },
  { contains: 'KOTAK SECURITIES', category: 'Investment' },

  // ── CC payments ─────────────────────────────────────────────────────────
  { contains: 'PAYMENT TO CHASE CARD', category: 'CC Payment' },
  { contains: 'PAYMENT TO BOFA', category: 'CC Payment' },
  { contains: 'ROBINHOOD CARD PAYMENT', category: 'CC Payment' },
  { contains: 'DISCOVER E-PAYMENT', category: 'CC Payment' },
  { contains: 'AMERICAN EXPRESS ACH PMT', category: 'CC Payment' },
  { contains: 'BK OF AMER VISA ONLINE', category: 'CC Payment' },
  { contains: 'BANK OF AMERICA PAYMENT', category: 'CC Payment' },
  { contains: 'CHASE AUTOPAY', category: 'CC Payment' },
  { contains: 'CITI AUTOPAY', category: 'CC Payment' },
  { contains: 'PAYMENT - THANK YOU', category: 'CC Payment' },

  // ── Transfers ───────────────────────────────────────────────────────────
  // Generic patterns only -- no specific credit union or bank name that
  // would identify the user (Hemanth's scrub: removed KITSAP CU TRANSFER).
  { contains: 'CU TRANSFER', category: 'Transfer' },
  { contains: 'CREDIT UNION TRANSFER', category: 'Transfer' },
  { contains: 'BANK TRANSFER', category: 'Transfer' },
  { contains: 'ONLINE BANKING TRANSFER', category: 'Transfer' },
  { contains: 'ZELLE', category: 'Transfer' },
  { contains: 'VENMO', category: 'Transfer' },
  { contains: 'CASH APP', category: 'Transfer' },
  { contains: 'WIRE TRANSFER', category: 'Transfer' },
  { contains: 'ACH TRANSFER', category: 'Transfer' },
  { contains: 'IMPS', category: 'Transfer' },
  { contains: 'NEFT', category: 'Transfer' },
  { contains: 'UPI', category: 'Transfer' },

  // ── Salary / Income ─────────────────────────────────────────────────────
  // ONLY generic salary indicators -- no specific employer name (Hemanth's
  // scrub: removed ALTERA CORPORATI which named his employer).  If a user
  // wants their employer auto-tagged, they create a rule in /categories.
  { contains: 'PAYROLL', category: 'Income (salary)' },
  { contains: 'DIRECT DEPOSIT', category: 'Income (salary)' },
  { contains: 'SALARY', category: 'Income (salary)' },
  { contains: 'PAYCHECK', category: 'Income (salary)' },
  { contains: 'PAY CHECK', category: 'Income (salary)' },
  { contains: 'WAGE', category: 'Income (salary)' },
  { contains: 'INTEREST PAID', category: 'Income (other)' },
  { contains: 'INTEREST EARNED', category: 'Income (other)' },
  { contains: 'DIVIDEND', category: 'Income (other)' },
  { contains: 'CASHBACK', category: 'Income (other)' },
  { contains: 'CASH BACK', category: 'Income (other)' },
  { contains: 'STIMULUS', category: 'Income (other)' },

  // ── Refunds ─────────────────────────────────────────────────────────────
  { contains: 'CARD PURCHASE RETURN', category: 'Refund' },

  // ── Fees & interest ─────────────────────────────────────────────────────
  { contains: 'INTEREST CHARGE', category: 'Fees & interest' },
  { contains: 'LATE FEE', category: 'Fees & interest' },
  { contains: 'OVERDRAFT FEE', category: 'Fees & interest' },
  { contains: 'FOREIGN TXN FEE', category: 'Fees & interest' },
  { contains: 'ANNUAL FEE', category: 'Fees & interest' },

  // ── Bills (recurring living expenses) ───────────────────────────────────
  // Mortgage servicers + landlord-style keywords.  Hemanth's scrub: keep
  // PENNYMAC but balance with every other major US mortgage servicer so
  // no single name stands out as "the user's".
  { contains: 'RENT', category: 'Rent/Mortgage' },
  { contains: 'MORTGAGE', category: 'Rent/Mortgage' },
  { contains: 'PENNYMAC', category: 'Rent/Mortgage' },
  { contains: 'ROCKETMTG', category: 'Rent/Mortgage' },
  { contains: 'ROCKET MORTGAGE', category: 'Rent/Mortgage' },
  { contains: 'WELLS FARGO HOME MTG', category: 'Rent/Mortgage' },
  { contains: 'CHASE MORTGAGE', category: 'Rent/Mortgage' },
  { contains: 'BANK OF AMERICA MORTGAGE', category: 'Rent/Mortgage' },
  { contains: 'LOANDEPOT', category: 'Rent/Mortgage' },
  { contains: 'MR COOPER', category: 'Rent/Mortgage' },
  { contains: 'NATIONSTAR', category: 'Rent/Mortgage' },
  { contains: 'FREEDOM MORTGAGE', category: 'Rent/Mortgage' },
  { contains: 'CALIBER HOME LOANS', category: 'Rent/Mortgage' },
  { contains: 'CARRINGTON MTG', category: 'Rent/Mortgage' },
  { contains: 'NEWREZ', category: 'Rent/Mortgage' },
  { contains: 'HDFC HOME LOAN', category: 'Rent/Mortgage' },
  { contains: 'ICICI HOME LOAN', category: 'Rent/Mortgage' },
  { contains: 'SBI HOME LOAN', category: 'Rent/Mortgage' },
  { contains: 'T-MOBILE', category: 'Phone & Internet' },
  { contains: 'VERIZON', category: 'Phone & Internet' },
  { contains: 'AT&T', category: 'Phone & Internet' },
  { contains: 'COMCAST', category: 'Phone & Internet' },
  { contains: 'XFINITY', category: 'Phone & Internet' },
  { contains: 'SPECTRUM', category: 'Phone & Internet' },
  { contains: 'JIO', category: 'Phone & Internet' },
  { contains: 'AIRTEL', category: 'Phone & Internet' },
  { contains: 'AMERICAN GEN LIF', category: 'Insurance' },
  { contains: 'GEICO', category: 'Insurance' },
  { contains: 'PROGRESSIVE', category: 'Insurance' },
  { contains: 'STATE FARM', category: 'Insurance' },
  { contains: 'ALLSTATE', category: 'Insurance' },
  { contains: 'LIC INSURANCE', category: 'Insurance' },
  { contains: 'HDFC LIFE', category: 'Insurance' },

  // ── Loan/Installment ────────────────────────────────────────────────────
  { contains: 'VW CREDIT', category: 'Loan/Installment' },
  { contains: 'AFFIRM', category: 'Loan/Installment' },
  { contains: 'KLARNA', category: 'Loan/Installment' },

  // ── Subscriptions (digital recurring) ───────────────────────────────────
  { contains: 'NETFLIX', category: 'Subscriptions' },
  { contains: 'SPOTIFY', category: 'Subscriptions' },
  { contains: 'HULU', category: 'Subscriptions' },
  { contains: 'DISNEY', category: 'Subscriptions' },
  { contains: 'AMAZON PRIME', category: 'Subscriptions' },
  { contains: 'OPENAI', category: 'Subscriptions' },
  { contains: 'CHATGPT', category: 'Subscriptions' },
  { contains: 'CLAUDE.AI', category: 'Subscriptions' },
  { contains: 'ANTHROPIC', category: 'Subscriptions' },
  { contains: 'ICLOUD', category: 'Subscriptions' },
  { contains: 'GOOGLE STORAGE', category: 'Subscriptions' },

  // ── Groceries ────────────────────────────────────────────────────────────
  { contains: 'COSTCO', category: 'Groceries' },
  { contains: 'WHOLE FOODS', category: 'Groceries' },
  { contains: 'WHOLEFOODS', category: 'Groceries' },
  { contains: 'H-E-B', category: 'Groceries' },
  { contains: 'KROGER', category: 'Groceries' },
  { contains: 'TRADER JOE', category: 'Groceries' },
  { contains: 'ALDI', category: 'Groceries' },
  { contains: 'WALMART', category: 'Groceries' },
  { contains: 'SAFEWAY', category: 'Groceries' },
  { contains: 'BIGBASKET', category: 'Groceries' },

  // ── Food (dining-out + cafes + delivery + home cooking) ────────────────
  // Merchant-name matches (most-specific first).
  { contains: 'STARBUCKS', category: 'Food' },
  { contains: 'CHAI POINT', category: 'Food' },
  { contains: 'MCDONALD', category: 'Food' },
  { contains: 'CHIPOTLE', category: 'Food' },
  { contains: 'DOORDASH', category: 'Food' },
  { contains: 'UBER EATS', category: 'Food' },
  { contains: 'SWIGGY', category: 'Food' },
  { contains: 'ZOMATO', category: 'Food' },
  { contains: 'DUNKIN', category: 'Food' },
  { contains: 'SUBWAY', category: 'Food' },
  { contains: 'TACO BELL', category: 'Food' },
  { contains: 'PANERA', category: 'Food' },
  { contains: 'CINEMARK', category: 'Entertainment' },
  { contains: 'TST*', category: 'Food' },
  // Generic food-word fallback (catches Bhargav-style manual entries like
  // "ate biryani worth 450" / "pizza with friends" / "tiffin near office").
  // Last in this section so a merchant-name match always wins first.
  { contains: 'BIRYANI', category: 'Food' },
  { contains: 'PIZZA', category: 'Food' },
  { contains: 'BURGER', category: 'Food' },
  { contains: 'TIFFIN', category: 'Food' },
  { contains: 'IDLI', category: 'Food' },
  { contains: 'DOSA', category: 'Food' },
  { contains: 'SAMOSA', category: 'Food' },
  { contains: 'KEBAB', category: 'Food' },
  { contains: 'KABAB', category: 'Food' },
  { contains: 'MOMO', category: 'Food' },
  { contains: 'NOODLES', category: 'Food' },
  { contains: 'RAMEN', category: 'Food' },
  { contains: 'SUSHI', category: 'Food' },
  { contains: 'BURRITO', category: 'Food' },
  { contains: 'PARATHA', category: 'Food' },
  { contains: 'THALI', category: 'Food' },
  { contains: 'CURRY', category: 'Food' },
  // Desserts + sweets (Hemanth: "I typed ice cream and it didn't detected").
  { contains: 'ICE CREAM', category: 'Food' },
  { contains: 'ICECREAM', category: 'Food' },
  { contains: 'GELATO', category: 'Food' },
  { contains: 'CAKE', category: 'Food' },
  { contains: 'PASTRY', category: 'Food' },
  { contains: 'DONUT', category: 'Food' },
  { contains: 'DOUGHNUT', category: 'Food' },
  { contains: 'COOKIE', category: 'Food' },
  { contains: 'CHOCOLATE', category: 'Food' },
  { contains: 'KULFI', category: 'Food' },
  { contains: 'HALWA', category: 'Food' },
  { contains: 'KHEER', category: 'Food' },
  { contains: 'RASGULLA', category: 'Food' },
  { contains: 'GULAB JAMUN', category: 'Food' },
  { contains: 'JALEBI', category: 'Food' },
  { contains: 'MITHAI', category: 'Food' },
  { contains: 'DESSERT', category: 'Food' },
  { contains: 'SWEETS', category: 'Food' },
  { contains: 'SANDWICH', category: 'Food' },
  { contains: 'WRAP', category: 'Food' },
  { contains: 'SALAD', category: 'Food' },
  { contains: 'KFC', category: 'Food' },
  { contains: 'CHAI', category: 'Food' },
  { contains: 'COFFEE', category: 'Food' },
  { contains: 'LUNCH', category: 'Food' },
  { contains: 'DINNER', category: 'Food' },
  { contains: 'BREAKFAST', category: 'Food' },
  { contains: 'BRUNCH', category: 'Food' },
  { contains: 'SNACKS', category: 'Food' },
  { contains: 'RESTAURANT', category: 'Food' },
  { contains: 'CAFE', category: 'Food' },

  // ── Transport ───────────────────────────────────────────────────────────
  // Merchant matches first (most specific), then generic ride keywords so
  // Bhargav-style manual entries ("auto to office", "cab home", "bus pass")
  // auto-categorize without a manual rule.
  { contains: 'UBER', category: 'Transport' },
  { contains: 'LYFT', category: 'Transport' },
  { contains: 'OLA CABS', category: 'Transport' },
  { contains: 'RAPIDO', category: 'Transport' },
  { contains: 'NAMMA YATRI', category: 'Transport' },
  { contains: 'IRCTC', category: 'Transport' },
  { contains: 'CAB', category: 'Transport' },
  { contains: 'TAXI', category: 'Transport' },
  { contains: 'AUTO RICKSHAW', category: 'Transport' },
  { contains: 'RICKSHAW', category: 'Transport' },
  { contains: 'METRO', category: 'Transport' },
  { contains: 'BUS', category: 'Transport' },
  { contains: 'TRAIN', category: 'Transport' },
  { contains: 'PARKING', category: 'Transport' },
  { contains: 'TOLL', category: 'Transport' },

  // ── Gas ─────────────────────────────────────────────────────────────────
  { contains: 'SHELL', category: 'Gas' },
  { contains: 'CHEVRON', category: 'Gas' },
  { contains: 'EXXON', category: 'Gas' },
  { contains: 'MOBIL', category: 'Gas' },
  { contains: 'BP GAS', category: 'Gas' },
  { contains: 'INDIAN OIL', category: 'Gas' },

  // ── Travel (flights, hotels, vacation) ──────────────────────────────────
  { contains: 'FLIGHT', category: 'Travel' },
  { contains: 'AIRPORT', category: 'Travel' },
  { contains: 'AIRLINES', category: 'Travel' },
  { contains: 'AIRWAYS', category: 'Travel' },
  { contains: 'INDIGO', category: 'Travel' },
  { contains: 'AIR INDIA', category: 'Travel' },
  { contains: 'EMIRATES', category: 'Travel' },
  { contains: 'DELTA', category: 'Travel' },
  { contains: 'UNITED AIRLINE', category: 'Travel' },
  { contains: 'BOOKING.COM', category: 'Travel' },
  { contains: 'AIRBNB', category: 'Travel' },
  { contains: 'EXPEDIA', category: 'Travel' },
  { contains: 'MAKEMYTRIP', category: 'Travel' },
  { contains: 'HOTEL', category: 'Travel' },

  // ── Shopping ────────────────────────────────────────────────────────────
  { contains: 'AMAZON.COM', category: 'Shopping' },
  { contains: 'AMAZON MKTPL', category: 'Shopping' },
  { contains: 'AMAZON.IN', category: 'Shopping' },
  { contains: 'FLIPKART', category: 'Shopping' },
  { contains: 'TARGET', category: 'Shopping' },
  { contains: 'BEST BUY', category: 'Shopping' },
  { contains: 'ROSS STORES', category: 'Shopping' },
  { contains: 'MARSHALLS', category: 'Shopping' },
  { contains: 'POPSTROKE', category: 'Entertainment' },

  // ── Cash ───────────────────────────────────────────────────────────────
  { contains: 'ATM WITHDRAWAL', category: 'Cash' },
  { contains: 'ATM CASH', category: 'Cash' }
];

/**
 * Compute the seed categories + rules.  Pure.  Categories are stable (same
 * ids on every call).  Rules reference categories by their seed id.
 *
 * @param now Provides the timestamp used for rule ids (so they survive merge).
 */
export function seedCategoriesAndRules(now: () => string = () => new Date().toISOString()): {
  categories: Category[];
  rules: CategoryRule[];
} {
  const categories: Category[] = SEED_CATEGORIES.map((c) => ({
    id: id(c.name),
    name: c.name,
    color: c.color
  }));
  const ts = now();
  let n = 0;
  const rules: CategoryRule[] = SEED_RULES.map((r) => {
    n += 1;
    return {
      id: `seed-rule-${ts}-${n}`,
      contains: r.contains,
      category_id: id(r.category)
    };
  });
  return { categories, rules };
}

/**
 * Predicate: should we auto-seed on this user's data?  YES only when the user
 * has zero categories AND zero rules.  A returning user who deleted things on
 * purpose keeps their empty state.
 */
export function shouldAutoSeed(state: {
  categories: readonly Category[];
  rules: readonly CategoryRule[];
}): boolean {
  return state.categories.length === 0 && state.rules.length === 0;
}
