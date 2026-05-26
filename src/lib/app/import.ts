// Phase 0 import orchestration.  In-memory only — no persistence yet.
// Per quickstart.md smoke test: read bytes → hash → extract → detect → parse → checksum.

import { extractPdfTextWithPositions, pdfSourceHash } from '../pdf/extract';
import { detectAdapter } from '../adapters';
import { ParseError } from '../adapters/types';
import type { ParsedStatement, ParsedTransaction } from '../adapters/types';
import { runChecksumGate, type ChecksumGateResult } from './checksum';

export type ImportStage =
  | { stage: 'reading' }
  | { stage: 'extracting' }
  | { stage: 'detecting' }
  | { stage: 'parsing'; adapter_name: string }
  | { stage: 'validating'; adapter_name: string };

export interface ImportSuccess {
  ok: true;
  adapter_name: string;
  adapter_version: string;
  bank_name: string;
  pdf_source_hash: string;
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  checksum: Extract<ChecksumGateResult, { ok: true }>;
}

export interface ImportFailure {
  ok: false;
  reason: 'no_adapter' | 'parse_error' | 'checksum_failed' | 'extract_failed';
  message: string;
  checksum?: ChecksumGateResult;
  // When parsing succeeded but the checksum gate refused, we still surface the
  // parsed transactions so the user can scan for the row(s) that look wrong.
  // Phase 0 doesn't persist anything regardless of outcome — these are shown
  // for diagnosis only, never imported into a database.
  parsed_transactions?: ParsedTransaction[];
  parsed_statement?: ParsedStatement;
  adapter_name?: string;
  adapter_version?: string;
  bank_name?: string;
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface ImportOptions {
  onProgress?: (stage: ImportStage) => void;
}

/**
 * Run the full Phase 0 import pipeline on one PDF file.
 *
 * Nothing is persisted.  Returns a discriminated union the UI can switch on.
 * Per Principle II, any checksum failure refuses the import — no partial state.
 */
export async function importStatement(
  source: File | Uint8Array | ArrayBuffer,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const onProgress = options.onProgress ?? (() => {});

  onProgress({ stage: 'reading' });
  const bytes = await toBytes(source);

  if (!hasPdfMagic(bytes)) {
    return {
      ok: false,
      reason: 'extract_failed',
      message: 'File does not appear to be a PDF (missing %PDF- header).'
    };
  }

  const sourceHash = await pdfSourceHash(bytes);

  onProgress({ stage: 'extracting' });
  let pdf;
  try {
    pdf = await extractPdfTextWithPositions(bytes);
  } catch (err) {
    return {
      ok: false,
      reason: 'extract_failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  onProgress({ stage: 'detecting' });
  const textSample =
    pdf.pages[0]?.items
      .map((i) => i.text)
      .join(' ')
      .slice(0, 4096) ?? '';
  let detection;
  try {
    detection = detectAdapter(textSample);
  } catch (err) {
    // detectAdapter throws when multiple adapters claim the same statement
    // (registry bug: detect() implementations must be mutually exclusive).
    // Surface this as a visible error rather than letting it propagate up
    // to the route handler where it would die silently.
    return {
      ok: false,
      reason: 'parse_error',
      message:
        'Multiple bank adapters claimed this statement. This is a parser bug — ' +
        (err instanceof Error ? err.message : String(err))
    };
  }
  if (detection === null) {
    return {
      ok: false,
      reason: 'no_adapter',
      message:
        'This bank is not yet supported. Please share an anonymized sample so a parser can be added.'
    };
  }

  const adapter = detection.adapter;
  onProgress({ stage: 'parsing', adapter_name: adapter.name });
  let parsed;
  try {
    parsed = await adapter.parse(pdf);
  } catch (err) {
    return {
      ok: false,
      reason: 'parse_error',
      message:
        err instanceof ParseError ? err.message : err instanceof Error ? err.message : String(err)
    };
  }

  onProgress({ stage: 'validating', adapter_name: adapter.name });
  const checksum = runChecksumGate(parsed.statement, parsed.transactions);
  if (!checksum.ok) {
    return {
      ok: false,
      reason: 'checksum_failed',
      message: checksum.reason,
      checksum,
      parsed_transactions: parsed.transactions,
      parsed_statement: parsed.statement,
      adapter_name: adapter.name,
      adapter_version: adapter.version,
      bank_name: adapter.bank_name
    };
  }

  return {
    ok: true,
    adapter_name: adapter.name,
    adapter_version: adapter.version,
    bank_name: adapter.bank_name,
    pdf_source_hash: sourceHash,
    statement: parsed.statement,
    transactions: parsed.transactions,
    checksum
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function toBytes(source: File | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF-" = 0x25 0x50 0x44 0x46 0x2D
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
