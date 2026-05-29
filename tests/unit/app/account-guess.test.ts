import { describe, test, expect } from 'vitest';
import { guessAccount } from '../../../src/lib/app/account-guess';

const ACCOUNTS = ['Cash', 'HDFC UPI', 'ICICI UPI', 'Chase Checking 9535', 'Amex Card'];

describe('guessAccount — matches the user-saved account from typed text', () => {
  test('distinctive word fills the account ("...hdfc" -> HDFC UPI)', () => {
    expect(guessAccount('dum biryani 450 hdfc', ACCOUNTS)).toBe('HDFC UPI');
  });

  test('whole account name typed', () => {
    expect(guessAccount('groceries hdfc upi 1200', ACCOUNTS)).toBe('HDFC UPI');
  });

  test('a different bank word picks that account', () => {
    expect(guessAccount('coffee 80 chase', ACCOUNTS)).toBe('Chase Checking 9535');
  });

  test('Cash matches as a whole word', () => {
    expect(guessAccount('paid cash for chai 20', ACCOUNTS)).toBe('Cash');
  });

  test('case-insensitive', () => {
    expect(guessAccount('Lunch 300 HDFC', ACCOUNTS)).toBe('HDFC UPI');
  });
});

describe('guessAccount — does NOT false-positive', () => {
  test('empty description', () => {
    expect(guessAccount('', ACCOUNTS)).toBeNull();
  });

  test('no account mentioned', () => {
    expect(guessAccount('dum biryani 450', ACCOUNTS)).toBeNull();
  });

  test('generic banking word alone is ambiguous -> no guess', () => {
    // "card" / "upi" / "bank" must not silently pick one of several accounts.
    expect(guessAccount('paid by card 500', ACCOUNTS)).toBeNull();
    expect(guessAccount('sent upi 200', ACCOUNTS)).toBeNull();
  });

  test('a bare last-4 number must not match an account (it is the amount, not the card)', () => {
    // "9535" is the last-4 of Chase Checking 9535; typing a number must not
    // bind the account, or every amount would risk picking a card.
    expect(guessAccount('rent 9535', ACCOUNTS)).toBeNull();
  });

  test('"cashback" must NOT match the Cash account (word boundary)', () => {
    expect(guessAccount('cashback reward 50', ACCOUNTS)).toBeNull();
  });

  test('substring inside another word does not match ("chases" != chase only by boundary)', () => {
    // boundary is non-alphanumeric, so "purchased" must not match "chase".
    expect(guessAccount('purchased shoes 999', ['Chase Checking 9535'])).toBeNull();
  });
});

describe('guessAccount — most-specific wins', () => {
  test('longer matched token beats a shorter one', () => {
    const accts = ['Cash', 'HDFC UPI', 'HDFC Millennia Credit Card'];
    // "millennia" (9) is more specific than "hdfc" (4) -> the credit card.
    expect(guessAccount('shopping 2000 hdfc millennia', accts)).toBe('HDFC Millennia Credit Card');
  });

  test('amex distinctive word over the generic "card"', () => {
    expect(guessAccount('dinner amex 1500', ACCOUNTS)).toBe('Amex Card');
  });
});
