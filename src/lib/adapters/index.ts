// Side-effect imports — every bank adapter registers itself at module load.
// Adding a new bank means: create src/lib/adapters/<bank>/, write adapter.ts,
// then add one registration line here.
//
// This file is the public entry point for parsing.  Anything outside src/lib/adapters/
// that needs parsing imports from here (or from detector/types directly).

import { registerAdapter } from './detector';
import { chaseCreditCardAdapter } from './chase-credit-card/adapter';
import { chaseCheckingAdapter } from './chase-checking/adapter';
import { amexAdapter } from './amex/adapter';
import { bofaCreditCardAdapter } from './bofa-credit-card/adapter';
import { discoverCreditCardAdapter } from './discover-credit-card/adapter';
import { robinhoodCreditCardAdapter } from './robinhood-credit-card/adapter';

export * from './types';
export { detectAdapter, listAdapters, registerAdapter } from './detector';

// Register all known adapters.  Order does not matter; detection picks
// whichever adapter's detect() returns true.
registerAdapter(chaseCreditCardAdapter);
registerAdapter(chaseCheckingAdapter);
registerAdapter(amexAdapter);
registerAdapter(bofaCreditCardAdapter);
registerAdapter(discoverCreditCardAdapter);
registerAdapter(robinhoodCreditCardAdapter);
