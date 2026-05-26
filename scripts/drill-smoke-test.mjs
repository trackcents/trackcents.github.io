// LOCAL-ONLY drill verification script.  Reads every real bank-statement
// PDF from OneDrive, runs each through the matching adapter, then runs the
// new FIFO drill engine.  For each bank-side payment_to_card row, prints
// what the browser's /payments/[bank_hash]/[txn_idx] page should show.
//
// Output masks the dollar magnitude of every amount with X so the script
// can be re-run safely without leaking exact balances.  Cents and structure
// are preserved so the user can spot-check.
//
// DO NOT commit this script's output.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const BANK_DIR = 'C:\\Users\\tnvmu\\OneDrive\\Documents\\Hemanth\\Bank_statements';

// ── PDF extraction (Node-compatible, legacy build) ──────────────────────────

async function extractPdf(filepath) {
  const data = new Uint8Array(readFileSync(filepath));
  const doc = await pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: true
    });
    const items = [];
    for (const raw of c.items) {
      if (typeof raw.str !== 'string') continue;
      const [a, , , , e, fy] = raw.transform;
      items.push({
        text: raw.str,
        x: e,
        y: fy,
        width: raw.width,
        height: raw.height,
        font_size: Math.abs(a)
      });
    }
    pages.push({ page_number: i, items });
  }
  await doc.destroy();
  return { bytes: data, pdf: { pages, total_pages: doc.numPages } };
}

function pdfHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function maskMoney(cents) {
  if (cents === null || cents === undefined) return 'null';
  const negative = cents < 0n;
  const absCents = negative ? -cents : cents;
  const dollars = absCents / 100n;
  const remainder = absCents % 100n;
  const masked = 'X'.repeat(dollars.toString().length);
  const cc = remainder.toString().padStart(2, '0');
  return (negative ? '-' : '') + '$' + masked + '.' + cc;
}

// ── Load adapters + drill engine ────────────────────────────────────────────

const ROOT = 'C:\\Users\\tnvmu\\Downloads\\Projects\\Hemanth\\money_management_tool';
const adapterIndex = await import(pathToFileURL(join(ROOT, 'src/lib/adapters/index.ts')).href);
const checksumMod = await import(pathToFileURL(join(ROOT, 'src/lib/app/checksum.ts')).href);
const drillMod = await import(pathToFileURL(join(ROOT, 'src/lib/app/payment-drill.ts')).href);
const { detectAdapter, listAdapters } = adapterIndex;
const { runChecksumGate } = checksumMod;

// ── Main ────────────────────────────────────────────────────────────────────

console.log('Reading PDFs from', BANK_DIR);
const all = readdirSync(BANK_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
console.log(
  'Found',
  all.length,
  'PDFs.  Registered adapters:',
  listAdapters()
    .map((a) => a.name)
    .join(', ')
);
console.log('');

const imports = [];
for (const name of all) {
  let pdfData;
  try {
    pdfData = await extractPdf(join(BANK_DIR, name));
  } catch (err) {
    console.log(`  ✗ ${name} — extract failed: ${err.message?.slice(0, 80)}`);
    continue;
  }
  const { bytes, pdf } = pdfData;
  const textSample = pdf.pages[0].items
    .map((i) => i.text)
    .join(' ')
    .slice(0, 4096);
  let detection;
  try {
    detection = detectAdapter(textSample);
  } catch (err) {
    console.log(`  ✗ ${name} — detect failed: ${err.message?.slice(0, 80)}`);
    continue;
  }
  if (!detection) {
    console.log(`  ✗ ${name} — no adapter recognized this PDF`);
    continue;
  }
  const adapter = detection.adapter;
  let parsed;
  try {
    parsed = await adapter.parse(pdf);
  } catch (err) {
    console.log(`  ✗ ${name} — parse failed: ${err.message?.slice(0, 80)}`);
    continue;
  }
  const checksum = runChecksumGate(parsed.statement, parsed.transactions);
  if (!checksum.ok) {
    console.log(`  ✗ ${name} — checksum failed: ${checksum.diagnostic?.slice(0, 80)}`);
    continue;
  }
  imports.push({
    ok: true,
    adapter_name: adapter.name,
    adapter_version: adapter.version,
    bank_name: adapter.bank_name,
    pdf_source_hash: pdfHash(bytes),
    statement: parsed.statement,
    transactions: parsed.transactions,
    checksum
  });
  console.log(
    `  ✓ ${name.padEnd(58)} → ${adapter.bank_name.padEnd(20)} ${parsed.statement.account_type.padEnd(12)} ••••${parsed.statement.account_last_4 ?? '?'} · ${String(parsed.transactions.length).padStart(2)} txns · ${parsed.statement.period_start}→${parsed.statement.period_end}`
  );
}

console.log('\n' + '═'.repeat(80));
console.log('Bank-side payment_to_card drills');
console.log('═'.repeat(80));

let drillCount = 0;
for (let bIdx = 0; bIdx < imports.length; bIdx++) {
  const bImp = imports[bIdx];
  if (bImp.statement.account_type === 'credit_card') continue;
  for (let tIdx = 0; tIdx < bImp.transactions.length; tIdx++) {
    const tx = bImp.transactions[tIdx];
    if (tx.transaction_type !== 'payment_to_card') continue;

    drillCount++;
    const drill = drillMod.getPaymentDrill(imports, bIdx, tIdx);

    console.log('');
    console.log(
      `[${drillCount}] ${bImp.bank_name} ••••${bImp.statement.account_last_4 ?? '?'}  row ${tIdx}  ${tx.posted_date}  ${maskMoney(tx.amount_minor)}`
    );
    console.log(`    descriptor:  ${tx.description}`);

    if (!drill) {
      console.log(
        `    → DRILL: NO LINK — matcher could not identify the card (likely no matching CC statement imported)`
      );
      continue;
    }

    const coveredMinor = drill.payment_amount_minor - drill.uncovered_amount_minor;
    console.log(
      `    → Card:      ${drill.card_bank_name} ••••${drill.card_last_4}  (confidence ${(drill.link.confidence_score * 100).toFixed(0)}%)`
    );
    console.log(`    → Total:     ${maskMoney(drill.payment_amount_minor)}`);
    console.log(
      `    → Covered:   ${maskMoney(coveredMinor)} across ${drill.paid_for.length} tracked purchase(s)`
    );
    if (drill.uncovered_amount_minor > 0n) {
      console.log(
        `    → Pre-track: ${maskMoney(drill.uncovered_amount_minor)} (paid older balance we don't have)`
      );
    }
    if (drill.paid_for.length > 0) {
      console.log(`    → Paid for (oldest first):`);
      for (const pf of drill.paid_for) {
        const fromImp = imports[pf.import_index];
        const orig = pf.txn.amount_minor < 0n ? -pf.txn.amount_minor : pf.txn.amount_minor;
        const partial = pf.covered_amount_minor < orig ? ' [PARTIAL]' : '';
        const desc = pf.txn.description.slice(0, 55);
        console.log(
          `        ${pf.txn.posted_date}  ${maskMoney(pf.covered_amount_minor).padStart(12)} / ${maskMoney(orig).padStart(12)}${partial}  ${desc}`
        );
        console.log(
          `                       (from ${fromImp?.bank_name} ${fromImp?.statement.period_start}→${fromImp?.statement.period_end})`
        );
      }
    }
  }
}

console.log('');
console.log('═'.repeat(80));
console.log(
  `Done. ${drillCount} bank-side payment_to_card row(s) drilled. ${imports.length}/${all.length} PDFs successfully imported.`
);
console.log('═'.repeat(80));
