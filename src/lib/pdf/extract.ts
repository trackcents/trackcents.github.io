// PDF.js wrapper — produces PdfTextWithPositions from a PDF blob/bytes.
//
// CRITICAL ordering point (from research.md §R1 war story):
// PDF.js's `getTextContent()` returns text items in PDF *content-stream* order,
// which is the order the PDF generator emitted glyphs — NOT visual order.
// Some bank PDFs emit all dates, then all descriptions, then all amounts in
// vertical stripes rather than row-by-row.  The defensive pattern is to ALWAYS
// cluster by Y first then sort by X, with a small tolerance for sub-pixel jitter.
// That clustering is implemented in src/lib/adapters/_layout/table.ts; this
// module returns the raw positional items and lets that layer handle layout.

// Use the LEGACY build in the browser too (not just in tests/Node). The modern
// build's ES-module worker fails to load on iOS Safari (strict worker MIME +
// tighter memory), so the same PDF that parses on Android/desktop errored on
// iPhone. The legacy build is broadly compatible and is exactly what the adapter
// tests validate against, so the browser now matches the tested code path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PdfPage, PdfTextItem, PdfTextWithPositions } from '../adapters/types';

// SvelteKit + Vite serve the worker as an asset via `?url` query.
// In tests (jsdom, no worker), we set `useWorkerFetch = false` and rely on
// the fake worker that PDF.js falls back to (slower but functional).
let workerInitialized = false;

async function ensureWorker() {
  if (workerInitialized) return;
  workerInitialized = true;
  if (typeof window !== 'undefined') {
    // Browser: load worker from the bundled URL.
    // Vite resolves the `?url` suffix at build time to the hashed asset.
    const workerSrcModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrcModule.default;
  } else {
    // Node / jsdom test environment: use the bundled fake worker.
    // Setting workerSrc to an empty string disables the worker; PDF.js runs
    // synchronously on the main thread.  Acceptable for tests; not used in prod.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }
}

export interface ExtractOptions {
  /** Password for encrypted PDFs.  If absent, encrypted PDFs throw. */
  password?: string;
}

/**
 * Extract all text items from a PDF, with X/Y positions per page.
 *
 * The returned items are in PDF content-stream order — NOT visual order.
 * Callers wanting row-by-row visual order should pass the result through
 * the layout-aware grouper in `src/lib/adapters/_layout/table.ts`.
 */
export async function extractPdfTextWithPositions(
  source: Uint8Array | ArrayBuffer | Blob,
  options: ExtractOptions = {}
): Promise<PdfTextWithPositions> {
  await ensureWorker();

  const data =
    source instanceof Blob
      ? new Uint8Array(await source.arrayBuffer())
      : source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : source;

  const loadingTask = pdfjsLib.getDocument({
    data,
    password: options.password,
    // Reduce memory churn for large PDFs.
    disableFontFace: true,
    // Don't fetch system fonts; statements use standard fonts that PDF.js handles.
    useSystemFonts: false
  });

  const pdf: PDFDocumentProxy = await loadingTask.promise;
  try {
    const pages: PdfPage[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      pages.push(await extractPage(page, i));
    }
    return { pages, total_pages: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}

async function extractPage(page: PDFPageProxy, pageNumber: number): Promise<PdfPage> {
  const content = await page.getTextContent({
    // Don't normalize whitespace — preserves the exact glyph stream so adapters
    // can recover columns by X position even when the PDF emitted multiple
    // adjacent spaces or stripped them entirely.
    includeMarkedContent: false,
    disableNormalization: true
  });

  const items: PdfTextItem[] = [];
  for (const raw of content.items) {
    // PDF.js mixes TextItem and TextMarkedContent; the latter has no `str`.
    if (!isTextItem(raw)) continue;
    // transform = [a, b, c, d, e, f] affine matrix.
    // e = x translation, f = y translation, a ≈ font size scale, d ≈ font size scale.
    const [a, , , , e, f] = raw.transform;
    items.push({
      text: raw.str,
      x: e,
      y: f,
      width: raw.width,
      height: raw.height,
      font_size: Math.abs(a)
    });
  }
  return { page_number: pageNumber, items };
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

/**
 * SHA-256 of the entire PDF (used as `pdf_source_hash` in the provenance fields).
 * Convenience wrapper that doesn't require importing util/hash separately.
 */
export async function pdfSourceHash(source: Uint8Array | ArrayBuffer | Blob): Promise<string> {
  const bytes =
    source instanceof Blob
      ? new Uint8Array(await source.arrayBuffer())
      : source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : source;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const view = new Uint8Array(digest);
  let s = '';
  for (let i = 0; i < view.length; i++) {
    const v = view[i];
    if (v === undefined) continue;
    s += v.toString(16).padStart(2, '0');
  }
  return s;
}
