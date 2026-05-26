// Anonymization unit tests — synthetic data only.  Tests the pure function
// in src/lib/util/anonymize.ts.

import { describe, expect, test } from 'vitest';
import { anonymize, summarizeRedactions } from '../../../src/lib/util/anonymize';

describe('anonymize() — declared names', () => {
  test('redacts a single full name (case-insensitive)', () => {
    const text = 'Statement for John Smith, account ending 1234.';
    const result = anonymize(text, { names: ['John Smith'] });
    expect(result.redacted).toBe('Statement for ACCOUNT HOLDER, account ending 1234.');
    expect(result.redactions).toHaveLength(1);
    expect(result.redactions[0]!.category).toBe('name');
  });

  test('redacts the same name in multiple positions', () => {
    const text = 'JOHN SMITH paid John Smith via Zelle. Recipient: john smith.';
    const result = anonymize(text, { names: ['John Smith'] });
    expect(result.redacted).toBe(
      'ACCOUNT HOLDER paid ACCOUNT HOLDER via Zelle. Recipient: ACCOUNT HOLDER.'
    );
    expect(result.redactions).toHaveLength(3);
  });

  test('does NOT redact partial substrings of a name', () => {
    const text = 'Blacksmith Brothers Hardware Inc.';
    const result = anonymize(text, { names: ['Smith'] });
    // "Smith" within "Blacksmith" must not be redacted (whole-word matching).
    expect(result.redacted).toBe('Blacksmith Brothers Hardware Inc.');
    expect(result.redactions).toHaveLength(0);
  });

  test('redacts multiple different names', () => {
    const text = 'Authorized: John Smith and Jane Doe.';
    const result = anonymize(text, { names: ['John Smith', 'Jane Doe'] });
    expect(result.redacted).toBe('Authorized: ACCOUNT HOLDER and ACCOUNT HOLDER.');
  });
});

describe('anonymize() — declared addresses', () => {
  test('redacts a literal address', () => {
    const text = 'Address: 123 Main St, San Francisco, CA';
    const result = anonymize(text, { addresses: ['123 Main St'] });
    expect(result.redacted).toContain('ADDRESS REDACTED');
    expect(result.redacted).not.toContain('123 Main St');
  });

  test('matches address case-insensitively', () => {
    const text = '456 OAK AVENUE NW';
    const result = anonymize(text, { addresses: ['456 Oak Avenue NW'] });
    expect(result.redacted).toBe('ADDRESS REDACTED');
  });
});

describe('anonymize() — auto-detection: credit card numbers', () => {
  test('redacts a 16-digit card with dashes, keeps last 4', () => {
    const text = 'Card: 4532-1289-7766-1234';
    const result = anonymize(text);
    expect(result.redacted).toBe('Card: XXXX-XXXX-XXXX-1234');
    expect(result.redactions[0]!.category).toBe('credit_card_number');
  });

  test('redacts a 16-digit card with spaces', () => {
    const text = 'Card: 4532 1289 7766 1234';
    const result = anonymize(text);
    expect(result.redacted).toBe('Card: XXXX-XXXX-XXXX-1234');
  });

  test('redacts a 16-digit card with no separators', () => {
    const text = 'Card: 4532128977661234';
    const result = anonymize(text);
    expect(result.redacted).toBe('Card: XXXX-XXXX-XXXX-1234');
  });

  test('does NOT redact a transaction amount that happens to be 4 digits', () => {
    const text = 'Transaction amount: $1,234.56 on 2026-05-23';
    const result = anonymize(text);
    expect(result.redacted).toBe(text);
    expect(result.redactions).toHaveLength(0);
  });

  test('does NOT redact a long order/reference number (18+ digits)', () => {
    const text = 'Order number: 123456789012345678';
    const result = anonymize(text);
    // 18 digits — not a card.
    expect(result.redactions).toHaveLength(0);
  });
});

describe('anonymize() — auto-detection: account numbers', () => {
  test('redacts an account number declaration, keeps last 4', () => {
    const text = 'Account Number: 123456789';
    const result = anonymize(text);
    expect(result.redacted).toBe('Account Number: XXXXX6789');
  });

  test('does NOT redact a 9-digit number not in an account-declaration context', () => {
    const text = 'Reference: 987654321';
    const result = anonymize(text);
    // Not preceded by "Account" — left alone.
    expect(result.redacted).toBe(text);
  });
});

describe('anonymize() — auto-detection: SSN', () => {
  test('redacts a US SSN format', () => {
    const text = 'SSN: 123-45-6789';
    const result = anonymize(text);
    expect(result.redacted).toBe('SSN: SSN REDACTED');
  });

  test('does NOT redact a phone-shaped number (different separator pattern)', () => {
    const text = 'Call 415-555-1234'; // phone format, not SSN
    const result = anonymize(text);
    // This is caught by the phone regex (not SSN), so it gets PHONE REDACTED — that's
    // still correct redaction, just a different category.
    expect(result.redacted).toBe('Call PHONE REDACTED');
    expect(result.redactions[0]!.category).toBe('phone_auto');
  });
});

describe('anonymize() — auto-detection: emails', () => {
  test('redacts a standard email', () => {
    const text = 'Contact us at support@chase.com for help.';
    const result = anonymize(text);
    expect(result.redacted).toBe('Contact us at EMAIL REDACTED for help.');
  });

  test('redacts multiple emails', () => {
    const text = 'me@example.com and you@example.com';
    const result = anonymize(text);
    expect(result.redacted).toBe('EMAIL REDACTED and EMAIL REDACTED');
    expect(result.redactions.filter((r) => r.category === 'email_auto')).toHaveLength(2);
  });
});

describe('anonymize() — auto-detection: phones', () => {
  test('redacts (###) ###-#### format', () => {
    const text = 'Call (415) 555-1234 for service.';
    const result = anonymize(text);
    expect(result.redacted).toBe('Call PHONE REDACTED for service.');
  });

  test('redacts ###-###-#### format', () => {
    const text = 'Customer service: 1-800-432-3117';
    const result = anonymize(text);
    expect(result.redacted).toContain('PHONE REDACTED');
    expect(result.redacted).not.toContain('432-3117');
  });

  test('redacts +1 prefix format', () => {
    const text = 'International: +1 415 555 1234';
    const result = anonymize(text);
    expect(result.redacted).toContain('PHONE REDACTED');
  });
});

describe('anonymize() — financial data must be preserved', () => {
  test('preserves dollar amounts in various formats', () => {
    const text = '$1,234.56 $0.05 ($1,000.00) -$45.00 $999,999.99';
    const result = anonymize(text);
    expect(result.redacted).toBe(text);
    expect(result.redactions).toHaveLength(0);
  });

  test('preserves ISO dates', () => {
    const text = 'Posted: 2026-05-23  Period: 2026-04-01 to 2026-04-30';
    const result = anonymize(text);
    expect(result.redacted).toBe(text);
  });

  test('preserves US dates (MM/DD/YYYY)', () => {
    const text = '05/23/2026 and 12/31/2025';
    const result = anonymize(text);
    expect(result.redacted).toBe(text);
  });

  test('preserves merchant names exactly', () => {
    const text = 'AMAZON.COM AMZN.COM/BILL WA  WHOLE FOODS MKT  SHELL OIL 12345';
    const result = anonymize(text);
    expect(result.redacted).toBe(text);
  });
});

describe('anonymize() — disable_auto_detect', () => {
  test('does NOT auto-detect when flag is set', () => {
    const text = 'Card 4532-1289-7766-1234 belongs to user@example.com';
    const result = anonymize(text, { disable_auto_detect: true });
    expect(result.redacted).toBe(text);
    expect(result.redactions).toHaveLength(0);
  });

  test('still applies declared names even with auto-detect off', () => {
    const text = 'Account holder: John Smith with card 4532-1289-7766-1234';
    const result = anonymize(text, { names: ['John Smith'], disable_auto_detect: true });
    // Name redacted, card NOT redacted.
    expect(result.redacted).toBe('Account holder: ACCOUNT HOLDER with card 4532-1289-7766-1234');
  });
});

describe('anonymize() — keep_last_n_digits', () => {
  test('keeps last 4 by default', () => {
    const text = '4532-1289-7766-1234';
    const result = anonymize(text);
    expect(result.redacted).toBe('XXXX-XXXX-XXXX-1234');
  });

  test('keeps 0 (fully redacts) when configured', () => {
    const text = '4532-1289-7766-1234';
    const result = anonymize(text, { keep_last_n_digits: 0 });
    expect(result.redacted).toBe('CARD NUMBER REDACTED');
  });

  // Regression: the ACCOUNT-number path (distinct from the CC path) must also
  // honour keep_last_n_digits: 0 without LEAKING the number. Before the clamp fix,
  // `num.slice(-0)` returned the whole number → "XXXXXXXXX123456789" (privacy leak).
  test('account number with keep_last_n_digits: 0 fully masks (no digits leak)', () => {
    const result = anonymize('Account Number: 123456789', { keep_last_n_digits: 0 });
    expect(result.redacted).toBe('Account Number: XXXXXXXXX');
    // The original digits must NOT survive anywhere in the output.
    expect(result.redacted).not.toMatch(/123456789/);
  });

  test('account number with keep_last_n_digits larger than its length does not crash', () => {
    // Before the clamp, 'X'.repeat(9 - 20) threw RangeError. Now it keeps all digits.
    const result = anonymize('Account Number: 123456789', { keep_last_n_digits: 20 });
    expect(result.redactions).toHaveLength(1);
    expect(result.redactions[0]!.category).toBe('account_number');
  });
});

describe('anonymize() — full realistic statement excerpt', () => {
  test('redacts every PII in a realistic Chase-style header', () => {
    const text = [
      'JOHN SMITH',
      '123 Main Street',
      'San Francisco, CA 94102',
      '',
      'Account Number: XXXX XXXX XXXX 1234',
      'Customer Service: 1-800-432-3117',
      'Email: support@chase.com',
      '',
      'AMAZON.COM AMZN.COM/BILL WA  $42.99  05/15/2026',
      'WHOLE FOODS MKT 10231  $87.23  05/16/2026',
      'Beginning Balance: $1,270.00',
      'Ending Balance: $1,245.00'
    ].join('\n');

    const result = anonymize(text, {
      names: ['John Smith'],
      addresses: ['123 Main Street']
    });

    // No PII left.
    expect(result.redacted).not.toMatch(/John\s+Smith/i);
    expect(result.redacted).not.toMatch(/123\s+Main\s+Street/i);
    expect(result.redacted).not.toMatch(/1-800-432-3117/);
    expect(result.redacted).not.toMatch(/support@chase\.com/);

    // Financial data preserved.
    expect(result.redacted).toContain('AMAZON.COM AMZN.COM/BILL WA');
    expect(result.redacted).toContain('WHOLE FOODS MKT 10231');
    expect(result.redacted).toContain('$42.99');
    expect(result.redacted).toContain('$87.23');
    expect(result.redacted).toContain('05/15/2026');
    expect(result.redacted).toContain('Beginning Balance: $1,270.00');
    expect(result.redacted).toContain('Ending Balance: $1,245.00');
    expect(result.redacted).toContain('ACCOUNT HOLDER');
    expect(result.redacted).toContain('ADDRESS REDACTED');
    expect(result.redacted).toContain('PHONE REDACTED');
    expect(result.redacted).toContain('EMAIL REDACTED');
  });
});

describe('summarizeRedactions()', () => {
  test('groups by category and counts', () => {
    const text = 'John Smith called 415-555-1234 and 555-555-5555. Email: x@y.com';
    const result = anonymize(text, { names: ['John Smith'] });
    const summary = summarizeRedactions(result.redactions);
    expect(summary).toMatch(/name\s+1/);
    expect(summary).toMatch(/phone_auto\s+2/);
    expect(summary).toMatch(/email_auto\s+1/);
  });

  test('warns when no redactions found', () => {
    const summary = summarizeRedactions([]);
    expect(summary).toMatch(/No redactions/i);
    expect(summary).toMatch(/Review the output carefully/i);
  });
});
