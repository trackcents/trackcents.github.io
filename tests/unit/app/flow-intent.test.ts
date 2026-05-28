/**
 * Tests for inferFlowIntent against REAL descriptions from the user's temp3
 * statements.  Locks in the behaviour for the "where money goes" math.
 */
import { describe, expect, test } from 'vitest';
import {
  inferFlowIntent,
  findBuiltinPattern,
  SPEND_INTENTS,
  INCOME_INTENTS,
  MOVEMENT_INTENTS,
  type FlowIntentContext
} from '../../../src/lib/app/flow-intent';

function ctx(
  over: Partial<FlowIntentContext> & Pick<FlowIntentContext, 'description' | 'amount_minor'>
): FlowIntentContext {
  const c: FlowIntentContext = {
    key: over.key ?? 'k',
    posted_date: over.posted_date ?? '2026-05-10',
    description: over.description,
    amount_minor: over.amount_minor,
    account_id: over.account_id ?? 'chase-checking-9535',
    is_credit_card_row: over.is_credit_card_row ?? false
  };
  if (over.reconciled_cc_payment_keys !== undefined)
    c.reconciled_cc_payment_keys = over.reconciled_cc_payment_keys;
  if (over.transfer_pair_keys !== undefined) c.transfer_pair_keys = over.transfer_pair_keys;
  if (over.paycheck_keys !== undefined) c.paycheck_keys = over.paycheck_keys;
  if (over.user_intent !== undefined) c.user_intent = over.user_intent;
  return c;
}

describe('inferFlowIntent — investments (must NOT count as spend)', () => {
  test('Robinhood Securities online transfer', () => {
    expect(
      inferFlowIntent(
        ctx({
          description:
            '05/10 Online Realtime Payment To Robinhood Securities Transaction#: 1058571',
          amount_minor: -5_000_00n
        })
      )
    ).toBe('investment_out');
  });

  test('Fidelity recurring contribution (with PPD ID noise)', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Fidelity 15105 P Fprs PPD ID: 9075693322',
          amount_minor: -446_41n
        })
      )
    ).toBe('investment_out');
  });
});

describe('inferFlowIntent — CC payments (must NOT count as spend)', () => {
  test('Payment To Chase Card Ending IN 1797', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: '04/04 Payment To Chase Card Ending IN 1797',
          amount_minor: -846_14n
        })
      )
    ).toBe('cc_payment');
  });

  test('Robinhood Card Payment', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Robinhood Card Payment PPD ID: 6823032815',
          amount_minor: -1_967_81n
        })
      )
    ).toBe('cc_payment');
  });

  test('Discover E-Payment', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Discover E-Payment 3562 Web ID: 2510020270',
          amount_minor: -15_07n
        })
      )
    ).toBe('cc_payment');
  });

  test('American Express ACH Pmt', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'American Express ACH Pmt M0442 Web ID: 2005032111',
          amount_minor: -35_42n
        })
      )
    ).toBe('cc_payment');
  });

  test('BofA Visa Online Pmt', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Bk of Amer Visa Online Pmt Ckf148086844POS Web ID: 9416871665',
          amount_minor: -113_52n
        })
      )
    ).toBe('cc_payment');
  });

  test('CC-side PAYMENT - THANK YOU is NOT income (it is the matched cc_payment)', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'PAYMENT - THANK YOU',
          amount_minor: 344_92n, // positive on CC side (reduces balance)
          is_credit_card_row: true
        })
      )
    ).toBe('cc_payment');
  });

  test('Reconciliation override wins regardless of description', () => {
    // A bank-side outflow that doesn't match any pattern but is reconciled
    // against a CC statement → cc_payment.
    expect(
      inferFlowIntent(
        ctx({
          description: 'OBSCURE PAYMENT METHOD WE DIDN T HARDCODE',
          amount_minor: -123_45n,
          key: 'cc-pay-1',
          reconciled_cc_payment_keys: new Set(['cc-pay-1'])
        })
      )
    ).toBe('cc_payment');
  });
});

describe('inferFlowIntent — transfers (must NOT count as spend)', () => {
  test('Kitsap CU Transfer', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Kitsap CU Transfer 630515 Web ID: 325180223',
          amount_minor: -1_000_00n
        })
      )
    ).toBe('transfer_self');
  });

  test('Transfer-pair key wins over description heuristic', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Some unusual cross-account move',
          amount_minor: -250_00n,
          key: 'xfer-1',
          transfer_pair_keys: new Set(['xfer-1', 'xfer-1-inflow'])
        })
      )
    ).toBe('transfer_self');
  });
});

describe('inferFlowIntent — income classification', () => {
  test('Altera Corporati Payroll → salary', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Altera Corporati Payroll PPD ID: 9111111101',
          amount_minor: 3_797_04n
        })
      )
    ).toBe('salary');
  });

  test('Paycheck-detector key forces salary even on generic description', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'DIRECT DEP',
          amount_minor: 3_465_99n,
          key: 'pay-1',
          paycheck_keys: new Set(['pay-1'])
        })
      )
    ).toBe('salary');
  });

  test('Zelle from a person with no recurring cadence → gift_in', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Zelle Payment From N V Muralidhar Tirupati 2934889966',
          amount_minor: 1_900_00n
        })
      )
    ).toBe('gift_in');
  });

  test('Interest earned', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'INTEREST PAID',
          amount_minor: 12n
        })
      )
    ).toBe('interest_earned');
  });
});

describe('inferFlowIntent — bills + loans (count as spend)', () => {
  test('T-Mobile bill', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'T-Mobile Pcs Svc 9398708 Web ID: 0000450304',
          amount_minor: -179_92n
        })
      )
    ).toBe('bill_pay');
  });

  test('American Gen Lif Ins (insurance)', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'American Gen Lif Ins_Paymt PPD ID: 4250598210',
          amount_minor: -52_14n
        })
      )
    ).toBe('bill_pay');
  });

  test('VW Credit auto loan', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Vw Credit, Tel. Web Debit Pwbs8157638769 Web ID: 1382362409',
          amount_minor: -552_00n
        })
      )
    ).toBe('loan_payment');
  });

  test('Pennymac mortgage', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'Pennymac Cash 8212879623-0011 Web ID: 1262049351',
          amount_minor: -2_741_56n
        })
      )
    ).toBe('bill_pay');
  });

  test('Anthropic subscription → bill_pay', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM CA',
          amount_minor: -21_32n,
          is_credit_card_row: true
        })
      )
    ).toBe('bill_pay');
  });
});

describe('inferFlowIntent — real purchases stay purchases', () => {
  test('Costco purchase on CC', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'WWW COSTCO COM',
          amount_minor: -108_15n,
          is_credit_card_row: true
        })
      )
    ).toBe('purchase');
  });

  test('Restaurant purchase on CC', () => {
    expect(
      inferFlowIntent(
        ctx({
          description: 'TST* NEW SITARA INDIAN RE AUSTIN TX',
          amount_minor: -195_82n,
          is_credit_card_row: true
        })
      )
    ).toBe('purchase');
  });

  test('Bank-side mystery outflow → unknown (not purchase) on non-CC', () => {
    // A non-CC bank outflow that matches nothing should fall through to
    // "unknown" (still counts as spend by default with a review flag, but
    // distinct from "real purchase").
    expect(
      inferFlowIntent(
        ctx({
          description: 'UNRECOGNIZED ACH WITHDRAWAL',
          amount_minor: -50_00n,
          is_credit_card_row: false
        })
      )
    ).toBe('unknown');
  });
});

describe('classification sets — every intent is in exactly one bucket', () => {
  test('SPEND ∩ INCOME ∩ MOVEMENT = ∅', () => {
    const allSpend = [...SPEND_INTENTS];
    for (const intent of allSpend) {
      expect(INCOME_INTENTS.has(intent)).toBe(false);
      expect(MOVEMENT_INTENTS.has(intent)).toBe(false);
    }
    for (const intent of INCOME_INTENTS) {
      expect(MOVEMENT_INTENTS.has(intent)).toBe(false);
    }
  });
});

describe('findBuiltinPattern — used by the rule seeder', () => {
  test('returns label for category seeding', () => {
    expect(findBuiltinPattern('Robinhood Securities', 'out')).toEqual({
      intent: 'investment_out',
      label: 'Investment'
    });
    expect(findBuiltinPattern('CLAUDE.AI SUBSCRIPTION', 'out')).toEqual({
      intent: 'bill_pay',
      label: 'Subscriptions'
    });
  });

  test('returns null for unmatched', () => {
    expect(findBuiltinPattern('XYZ RANDOM STRING', 'out')).toBeNull();
  });
});
