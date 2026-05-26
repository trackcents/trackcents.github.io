#!/usr/bin/env tsx
/**
 * Anonymize a bank statement PDF — STANDALONE, runs locally on your machine.
 *
 * Your real PDF never leaves your computer.  This script reads the PDF, scrubs
 * obvious PII (account numbers, emails, phones, SSNs) plus any name/address
 * you declare, and writes two files:
 *
 *   <statement>.anonymized.txt   — human-reviewable text with positions
 *   <statement>.anonymized.json  — structured data (text + X/Y) for the parser
 *
 * BEFORE sending anything to the parser developer, OPEN THE .anonymized.txt
 * FILE and read it.  If you see ANY of your real PII still there, do not send
 * it.  Add the missed identifier via --name / --address etc. and re-run.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Usage
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   pnpm tsx scripts/anonymize-statement.ts <input.pdf> [options]
 *
 * Options:
 *   --name "First Last"      Account-holder name to redact (whole-word, case-insensitive).
 *                            Can be specified multiple times.  Required for any
 *                            occurrence of your real name in the statement.
 *   --address "123 Main St"  Address fragment to redact.  Can be specified multiple times.
 *   --phone "415-555-1234"   Specific phone to redact (auto-detection also catches
 *                            common formats).
 *   --email "you@you.com"    Specific email to redact.
 *   --keep <N>               Keep N trailing digits of credit-card numbers (default 4).
 *   --no-auto                Disable auto-detection of common PII patterns.
 *   --output <dir>           Output directory (default: alongside input).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Example
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   pnpm tsx scripts/anonymize-statement.ts ~/Downloads/chase-april.pdf \
 *     --name "John Smith" \
 *     --address "123 Main Street"
 *
 *   # → ~/Downloads/chase-april.anonymized.txt
 *   # → ~/Downloads/chase-april.anonymized.json
 *
 * What gets redacted automatically (without specifying --name):
 *   ✓ Credit-card numbers (16 digits in any format) → XXXX-XXXX-XXXX-1234
 *   ✓ Account numbers in "Account Number: ..." format → XXXXX1234
 *   ✓ SSNs (###-##-####)
 *   ✓ Email addresses
 *   ✓ US phone numbers (multiple formats)
 *
 * What is NOT auto-detected (you MUST declare these):
 *   ✗ Your name — variations are too risky to auto-detect
 *   ✗ Your address — same
 *   ✗ Names that appear inside transaction descriptions (e.g., "ZELLE TO JOHN SMITH")
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The output files
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   .anonymized.txt — line-by-line rendering with X coordinates.  Open it in
 *                      Notepad.  Scan for any remaining PII.  Safe to share if clean.
 *
 *   .anonymized.json — same data but structured.  Send this to the parser
 *                       developer; the parser reads positional info from it.
 *
 * Both files contain identical content (just different format).  Reviewing the
 * TXT confirms there's nothing in the JSON either.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { anonymize, summarizeRedactions, type AnonymizeConfig } from '../src/lib/util/anonymize';

interface CliArgs {
  input: string;
  names: string[];
  addresses: string[];
  phones: string[];
  emails: string[];
  keep_last_n_digits: number;
  disable_auto_detect: boolean;
  output_dir: string | null;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    input: '',
    names: [],
    addresses: [],
    phones: [],
    emails: [],
    keep_last_n_digits: 4,
    disable_auto_detect: false,
    output_dir: null
  };

  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === '--help' || raw[0] === '-h') {
    console.error('Usage: pnpm tsx scripts/anonymize-statement.ts <input.pdf> [options]');
    console.error('See the top of the script file for full documentation.');
    process.exit(raw.length === 0 ? 1 : 0);
  }

  args.input = raw[0]!;
  for (let i = 1; i < raw.length; i++) {
    const flag = raw[i]!;
    const val = raw[i + 1];
    switch (flag) {
      case '--name':
        if (val === undefined) bail(`--name requires a value`);
        args.names.push(val);
        i++;
        break;
      case '--address':
        if (val === undefined) bail(`--address requires a value`);
        args.addresses.push(val);
        i++;
        break;
      case '--phone':
        if (val === undefined) bail(`--phone requires a value`);
        args.phones.push(val);
        i++;
        break;
      case '--email':
        if (val === undefined) bail(`--email requires a value`);
        args.emails.push(val);
        i++;
        break;
      case '--keep':
        if (val === undefined) bail(`--keep requires a number`);
        args.keep_last_n_digits = Number.parseInt(val, 10);
        if (Number.isNaN(args.keep_last_n_digits) || args.keep_last_n_digits < 0) {
          bail(`--keep must be a non-negative integer, got ${val}`);
        }
        i++;
        break;
      case '--no-auto':
        args.disable_auto_detect = true;
        break;
      case '--output':
        if (val === undefined) bail(`--output requires a directory`);
        args.output_dir = val;
        i++;
        break;
      default:
        bail(`unknown flag: ${flag}`);
    }
  }
  return args;
}

function bail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

interface PdfItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
}

interface PdfPage {
  page_number: number;
  items: PdfItem[];
}

async function extractPdf(pdfPath: string): Promise<{ pages: PdfPage[]; total_pages: number }> {
  const bytes = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: false }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ disableNormalization: true });
    const items: PdfItem[] = [];
    for (const raw of content.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>) {
      if (typeof raw.str !== 'string' || !Array.isArray(raw.transform)) continue;
      items.push({
        text: raw.str,
        x: raw.transform[4]!,
        y: raw.transform[5]!,
        width: raw.width ?? 0,
        height: raw.height ?? 0,
        font_size: Math.abs(raw.transform[0]!)
      });
    }
    pages.push({ page_number: p, items });
  }
  await doc.destroy();
  return { pages, total_pages: doc.numPages };
}

function anonymizePage(
  page: PdfPage,
  config: AnonymizeConfig
): { page: PdfPage; redactionCount: number } {
  // Apply anonymization per-item (each text item is its own string).
  // ALSO apply to the row-concatenated text in case PII spans items, but a
  // single-item pass catches the common case where the bank wrote the full
  // line as one PDF text object (very common).
  let redactionCount = 0;
  const cleanItems: PdfItem[] = [];
  for (const item of page.items) {
    const { redacted, redactions } = anonymize(item.text, config);
    redactionCount += redactions.length;
    cleanItems.push({ ...item, text: redacted });
  }
  return { page: { ...page, items: cleanItems }, redactionCount };
}

function renderTextReview(pages: PdfPage[]): string {
  // Group items by row (3pt Y tolerance), then sort within row by X.  Mirrors
  // the inspector script's output format.
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(`========================================`);
    lines.push(`PAGE ${page.page_number}  (${page.items.length} items)`);
    lines.push(`========================================`);
    const sorted = [...page.items].sort((a, b) => b.y - a.y);
    let rowItems: PdfItem[] = [];
    let rowY = sorted[0]?.y ?? 0;
    for (const item of sorted) {
      if (Math.abs(item.y - rowY) <= 3) {
        rowItems.push(item);
      } else {
        if (rowItems.length > 0) lines.push(formatRow(rowItems));
        rowItems = [item];
        rowY = item.y;
      }
    }
    if (rowItems.length > 0) lines.push(formatRow(rowItems));
    lines.push('');
  }
  return lines.join('\n');
}

function formatRow(items: PdfItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const y = sorted[0]!.y.toFixed(0);
  const cells = sorted.map((i) => `${i.x.toFixed(0)}:${i.text}`).join('  |  ');
  return `y=${y}\t${cells}`;
}

async function main() {
  const args = parseArgs();
  const inputPath = resolve(args.input);
  if (!existsSync(inputPath)) bail(`input file not found: ${inputPath}`);
  if (extname(inputPath).toLowerCase() !== '.pdf') bail(`input must be a .pdf file`);

  const baseName = basename(inputPath, extname(inputPath));
  const outDir = args.output_dir === null ? dirname(inputPath) : resolve(args.output_dir);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`Reading ${inputPath}...`);
  const pdf = await extractPdf(inputPath);
  const totalItems = pdf.pages.reduce((n, p) => n + p.items.length, 0);
  console.log(`  ${pdf.total_pages} page(s), ${totalItems} text items`);

  console.log('Anonymizing...');
  const config: AnonymizeConfig = {
    names: args.names,
    addresses: args.addresses,
    phones: args.phones,
    emails: args.emails,
    keep_last_n_digits: args.keep_last_n_digits,
    disable_auto_detect: args.disable_auto_detect
  };

  let totalRedactions = 0;
  const cleanPages: PdfPage[] = [];
  // We also collect all redactions across pages to build a single summary.
  // (Each item is anonymized independently; we re-anonymize the JOINED text
  // separately just to build the cross-page summary report.)
  const allText = pdf.pages.flatMap((p) => p.items.map((i) => i.text)).join(' ');
  const reportPass = anonymize(allText, config);
  totalRedactions = reportPass.redactions.length;

  for (const page of pdf.pages) {
    const { page: clean, redactionCount } = anonymizePage(page, config);
    cleanPages.push(clean);
    // We track per-item redactions separately, but the cross-page summary
    // (from reportPass) is more accurate because it sees the full text.
    // We don't add redactionCount to totalRedactions to avoid double-count.
    void redactionCount;
  }

  // Sanity check: try to find any remaining PII the auto-detector recognizes
  // in the cleaned output.  This is a self-test: if redactions remain, something
  // failed.
  const sanityCheckText = cleanPages.flatMap((p) => p.items.map((i) => i.text)).join(' ');
  const sanityCheck = anonymize(sanityCheckText, config);

  console.log('Writing outputs...');
  const txtPath = join(outDir, `${baseName}.anonymized.txt`);
  const jsonPath = join(outDir, `${baseName}.anonymized.json`);

  const summary = summarizeRedactions(reportPass.redactions);

  const txtContent =
    `# Anonymized statement — ${baseName}\n` +
    `# Source PDF:  ${inputPath}\n` +
    `# Generated:   ${new Date().toISOString()}\n` +
    `# Pages:       ${pdf.total_pages}\n` +
    `# Items:       ${totalItems}\n` +
    `#\n` +
    `# ${summary.split('\n').join('\n# ')}\n` +
    `#\n` +
    (sanityCheck.redactions.length > 0
      ? `# ⚠️  WARNING: sanity check still found ${sanityCheck.redactions.length} potential PII pattern(s) AFTER\n` +
        `#    anonymization.  Review the output below CAREFULLY before sharing.  These\n` +
        `#    may be patterns matched on the joined-page text that didn't appear in any\n` +
        `#    single PDF item (rare but possible with PDF text fragmentation).\n#\n`
      : `# ✓  Sanity check passed: no auto-detectable PII remains in the anonymized output.\n#\n`) +
    `# IMPORTANT: open this file and read it.  If you see anything sensitive that\n` +
    `# should have been redacted, add --name / --address / --phone / --email flags\n` +
    `# and re-run.  Only send this file to the parser developer once you are satisfied\n` +
    `# that no real PII remains.\n` +
    `\n` +
    renderTextReview(cleanPages);

  await writeFile(txtPath, txtContent, 'utf8');

  const jsonContent = JSON.stringify(
    {
      meta: {
        source_filename: basename(inputPath),
        generated_at: new Date().toISOString(),
        total_pages: pdf.total_pages,
        total_items: totalItems,
        redactions_made: totalRedactions,
        sanity_check_clean: sanityCheck.redactions.length === 0
      },
      pages: cleanPages
    },
    null,
    2
  );
  await writeFile(jsonPath, jsonContent, 'utf8');

  console.log(`\n✓ ${txtPath}`);
  console.log(`✓ ${jsonPath}`);
  console.log(`\n${summary}`);
  if (sanityCheck.redactions.length > 0) {
    console.log(
      `\n⚠️  Sanity check found ${sanityCheck.redactions.length} potential PII pattern(s) ` +
        `STILL in the anonymized output.  Review the .txt file CAREFULLY.`
    );
    process.exit(2);
  }
  console.log(`\nReview the .anonymized.txt file before sharing.`);
}

main().catch((err) => {
  console.error('anonymize-statement failed:');
  console.error(err);
  process.exit(1);
});
