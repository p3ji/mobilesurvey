import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENCY, mapId, mintUrn, sanitizeAgency, sanitizeVersion, unmapId } from '../urn.js';

describe('mapId / unmapId', () => {
  it('maps every dot to @ (the 3.3 XSD post-dot character class is defective)', () => {
    expect(mapId('c.experience')).toBe('c@experience');
    expect(mapId('q.cen.age')).toBe('q@cen@age');
    expect(mapId('edit.funds.balance')).toBe('edit@funds@balance');
  });

  it('leaves dotless ids unchanged', () => {
    expect(mapId('fsep')).toBe('fsep');
    expect(mapId('census-short-form')).toBe('census-short-form');
    expect(mapId('seq_root_then')).toBe('seq_root_then');
  });

  it('is bijective: unmapId inverts mapId for dot-only inputs', () => {
    for (const id of ['c.experience', 'q.cen.age', 'cs.color.cl', 'fsep', 'a.b.c.d.e']) {
      expect(unmapId(mapId(id))).toBe(id);
    }
  });

  it('rejects ids containing the @ escape character', () => {
    expect(() => mapId('already@escaped')).toThrow(/reserved/);
  });

  it('replaces other illegal characters with _ (lossy fallback)', () => {
    expect(mapId('has space')).toBe('has_space');
    expect(mapId('bang!sep')).toBe('bang_sep');
  });

  it('throws on an empty id rather than minting garbage', () => {
    expect(() => mapId('')).toThrow();
  });
});

describe('sanitizeAgency', () => {
  it('passes through pattern-valid agencies', () => {
    expect(sanitizeAgency('io.github.p3ji')).toBe('io.github.p3ji');
    expect(sanitizeAgency('ca.statcan')).toBe('ca.statcan');
    expect(sanitizeAgency('mobilesurvey')).toBe('mobilesurvey');
  });

  it('falls back to the placeholder for invalid or missing agencies', () => {
    expect(sanitizeAgency(undefined)).toBe(DEFAULT_AGENCY);
    expect(sanitizeAgency('')).toBe(DEFAULT_AGENCY);
    expect(sanitizeAgency('has space')).toBe(DEFAULT_AGENCY);
    expect(sanitizeAgency('trailing.')).toBe(DEFAULT_AGENCY);
  });

  it('never falls back to a registered agency', () => {
    expect(DEFAULT_AGENCY).not.toBe('ca.statcan');
  });
});

describe('sanitizeVersion', () => {
  it('passes through dot-separated integers', () => {
    expect(sanitizeVersion('1.0.0')).toBe('1.0.0');
    expect(sanitizeVersion('42')).toBe('42');
  });

  it("falls back to '1' for anything else", () => {
    expect(sanitizeVersion(undefined)).toBe('1');
    expect(sanitizeVersion('v2')).toBe('1');
    expect(sanitizeVersion('1.0-beta')).toBe('1');
  });
});

describe('mintUrn', () => {
  it('mints a canonical DDI URN', () => {
    expect(mintUrn('io.github.p3ji', mapId('cs.color'), '1.0.0')).toBe('urn:ddi:io.github.p3ji:cs@color:1.0.0');
  });

  it('refuses non-canonical components rather than emitting a bad URN', () => {
    expect(() => mintUrn('bad agency', 'id', '1')).toThrow(/non-canonical/);
    expect(() => mintUrn('a.b', 'has.dot', '1')).toThrow(/non-canonical/); // mapped ids are dotless
    expect(() => mintUrn('a.b', 'id', 'v1')).toThrow(/non-canonical/);
  });
});
