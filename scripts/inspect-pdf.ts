#!/usr/bin/env tsx
// One-off helper: dump a PDF's extracted text + positional info to stdout.
// Used during adapter development to understand a bank's format.
//
// Usage:  tsx scripts/inspect-pdf.ts <path-to-pdf>
//
// IMPORTANT: Uses pdfjs-dist's `legacy` build because the modern build
// expects browser globals like DOMMatrix.  Production browser code (in
// src/lib/pdf/extract.ts) uses the modern build directly.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx scripts/inspect-pdf.ts <path-to-pdf>');
    process.exit(1);
  }
  const bytes = new Uint8Array(await readFile(resolve(arg)));
  const doc = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: false }).promise;
  console.log(`# PDF: ${arg}`);
  console.log(`# Pages: ${doc.numPages}`);
  console.log('');

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ disableNormalization: true });

    type Item = { text: string; x: number; y: number };
    const items: Item[] = [];
    for (const raw of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (typeof raw.str !== 'string' || !Array.isArray(raw.transform)) continue;
      items.push({ text: raw.str, x: raw.transform[4]!, y: raw.transform[5]! });
    }

    console.log(`========================================`);
    console.log(`PAGE ${p}  (${items.length} items)`);
    console.log(`========================================`);

    // Group by Y (3pt tolerance), then sort each row by X.
    const sorted = [...items].sort((a, b) => b.y - a.y);
    const rows: Item[][] = [];
    let current: Item[] = [];
    let currentY = sorted[0]?.y ?? 0;
    for (const it of sorted) {
      if (Math.abs(it.y - currentY) <= 3) {
        current.push(it);
      } else {
        if (current.length) rows.push(current.sort((a, b) => a.x - b.x));
        current = [it];
        currentY = it.y;
      }
    }
    if (current.length) rows.push(current.sort((a, b) => a.x - b.x));

    for (const row of rows) {
      const y = row[0]!.y.toFixed(0);
      const cells = row.map((i) => `${i.x.toFixed(0)}:${i.text}`).join('  |  ');
      console.log(`y=${y}\t${cells}`);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
