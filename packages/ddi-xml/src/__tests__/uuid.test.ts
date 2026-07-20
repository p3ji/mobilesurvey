import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { isUuid, UUID_NAMESPACE_DNS, UUID_NAMESPACE_URL, uuidV5 } from '../uuid.js';

describe('UUIDv5 (hand-rolled, zero-dep)', () => {
  it('matches published RFC 4122 v5 vectors', () => {
    // Widely published reference values (e.g. Python's uuid.uuid5 docs).
    expect(uuidV5('python.org', UUID_NAMESPACE_DNS)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(uuidV5('example.com', UUID_NAMESPACE_DNS)).toBe('cfbff0d1-9375-5685-968c-48ce8b15ae17');
  });

  it('sets the version and variant nibbles', () => {
    const u = uuidV5('anything', UUID_NAMESPACE_URL);
    expect(isUuid(u)).toBe(true);
    expect(u[14]).toBe('5'); // version 5
    expect(['8', '9', 'a', 'b']).toContain(u[19]); // RFC 4122 variant
  });

  it('is deterministic and namespace-sensitive', () => {
    expect(uuidV5('q.demoLoc', UUID_NAMESPACE_URL)).toBe(uuidV5('q.demoLoc', UUID_NAMESPACE_URL));
    expect(uuidV5('q.demoLoc', UUID_NAMESPACE_URL)).not.toBe(uuidV5('q.demoLoc', UUID_NAMESPACE_DNS));
    expect(uuidV5('a', UUID_NAMESPACE_URL)).not.toBe(uuidV5('b', UUID_NAMESPACE_URL));
  });

  it('agrees with node:crypto SHA-1 across message lengths (padding edge cases)', () => {
    // Cross-check the internal digest via uuidV5 against an independent SHA-1: same
    // (namespace ‖ name) bytes must produce the same first 16 bytes, modulo the
    // version/variant nibbles that uuidV5 overwrites.
    const nsHex = UUID_NAMESPACE_DNS.replace(/-/g, '');
    for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 200]) {
      const name = 'x'.repeat(len);
      const input = Buffer.concat([Buffer.from(nsHex, 'hex'), Buffer.from(name, 'utf8')]);
      const expected = createHash('sha1').update(input).digest();
      expected[6] = (expected[6]! & 0x0f) | 0x50;
      expected[8] = (expected[8]! & 0x3f) | 0x80;
      const hex = expected.subarray(0, 16).toString('hex');
      const want = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      expect(uuidV5(name, UUID_NAMESPACE_DNS), `length ${len}`).toBe(want);
    }
  });

  it('handles non-ASCII names as UTF-8', () => {
    const nsHex = UUID_NAMESPACE_URL.replace(/-/g, '');
    const name = 'café — 日本語';
    const input = Buffer.concat([Buffer.from(nsHex, 'hex'), Buffer.from(name, 'utf8')]);
    const expected = createHash('sha1').update(input).digest();
    expected[6] = (expected[6]! & 0x0f) | 0x50;
    expected[8] = (expected[8]! & 0x3f) | 0x80;
    const hex = expected.subarray(0, 16).toString('hex');
    expect(uuidV5(name, UUID_NAMESPACE_URL)).toBe(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
    );
  });
});
