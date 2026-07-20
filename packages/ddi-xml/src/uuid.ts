/**
 * Name-based UUIDv5 (RFC 4122 §4.3) — dependency-free, synchronous.
 *
 * Why v5 and not v4: a DDI URN is a *persistent* identifier, so the same question must mint
 * the same UUID on every export. v4 is random and would need the UUID persisted alongside
 * every item in the instrument JSON; v5 is a hash of (namespace, name), so deriving it from
 * our stable internal id gives stability for free and keeps the instrument file clean.
 *
 * Why hand-rolled SHA-1: this package is zero-dependency by design and runs in the browser
 * (the designer exports client-side). Web Crypto's `subtle.digest` is async, which would
 * force `exportDdiXml` to become async and ripple through every caller. SHA-1 is ~40 lines
 * and is used here purely as the RFC-mandated digest for v5 — never as a security primitive.
 */

/** SHA-1 over raw bytes. Not for security use — RFC 4122 mandates it for UUIDv5. */
function sha1(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  // Pad: 0x80, zeros, then the 64-bit big-endian bit length, to a multiple of 64 bytes.
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      // Sum stays below 2^53 (exact in a JS number) before the >>> 0 truncation to 32 bits.
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) throw new Error(`Not a UUID: "${uuid}"`);
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 predefined namespaces. */
export const UUID_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** Name-based UUIDv5: SHA-1 of (namespace bytes ‖ name bytes), with version/variant bits set. */
export function uuidV5(name: string, namespace: string): string {
  const ns = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const bytes = sha1(input).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(bytes);
}

/** True for a well-formed UUID string (any version). */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
