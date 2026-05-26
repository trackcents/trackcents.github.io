// ULID — sortable, globally-unique identifier.
// 26 characters in Crockford base32: 10 chars of millisecond timestamp + 16 chars random.
// Lexicographically sortable by creation time.
// Spec: https://github.com/ulid/spec

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a new ULID.  ~26 chars, e.g. "01HJX9R8K6Z3KQNXFP1A0M2V4Y".
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

function encodeTime(ms: number): string {
  if (ms < 0 || ms > 0xffff_ffff_ffff) {
    throw new Error(`ulid: timestamp out of 48-bit range: ${ms}`);
  }
  let t = BigInt(ms);
  let out = '';
  for (let i = 0; i < 10; i++) {
    const c = CROCKFORD[Number(t % 32n)];
    if (c === undefined) throw new Error('ulid: unreachable');
    out = c + out;
    t = t / 32n;
  }
  return out;
}

function encodeRandom(): string {
  const random = new Uint8Array(10); // 80 bits = 16 base32 chars
  crypto.getRandomValues(random);
  let bits = 0n;
  for (let i = 0; i < 10; i++) {
    const v = random[i];
    if (v === undefined) throw new Error('ulid: unreachable');
    bits = (bits << 8n) | BigInt(v);
  }
  let out = '';
  for (let i = 0; i < 16; i++) {
    const c = CROCKFORD[Number(bits & 31n)];
    if (c === undefined) throw new Error('ulid: unreachable');
    out = c + out;
    bits = bits >> 5n;
  }
  return out;
}
