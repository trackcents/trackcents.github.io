// SHA-256 wrappers using the browser's Web Crypto API.
// No third-party crypto libraries — Web Crypto is built into every modern browser.

/**
 * SHA-256 of bytes or a string, returned as lowercase hex.
 */
export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return bytesToHex(new Uint8Array(buf));
}

/**
 * SHA-256 of an entire file's bytes.  Used for `pdf_source_hash` provenance
 * (FR-018).  Streams via Blob.arrayBuffer() — for typical bank statements
 * (<10 MB) this is fine without chunking.
 */
export async function fileSha256Hex(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return sha256Hex(bytes);
}

/**
 * Normalized SHA-256 of a transaction description, for use in the
 * idempotency unique index `(account_id, posted_date, amount_minor, description_hash)`.
 *
 * Normalization rules:
 *   - Uppercase
 *   - Collapse internal whitespace to single space
 *   - Strip trailing date / reference / authorization suffixes that vary
 *     across reprints of the same statement
 *
 * The goal is that the same logical transaction always produces the same
 * description_hash even if formatting differs slightly between statement
 * reissues.  Different actual transactions must still differ.
 */
export async function descriptionHash(text: string): Promise<string> {
  const normalized = text
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(
      /\s+(?:\d{2}[/-]\d{2}[/-]\d{2,4}|REF[\s#]?[A-Z0-9]+|ID[\s#]?[A-Z0-9]+|AUTH[\s#]?[A-Z0-9]+|TRACE[\s#]?[A-Z0-9]+)\s*$/i,
      ''
    )
    .trim();
  return sha256Hex(normalized);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    if (v === undefined) continue;
    s += v.toString(16).padStart(2, '0');
  }
  return s;
}
