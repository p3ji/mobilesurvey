import { describe, it, expect } from 'vitest';
import { isRtl } from '../dir.js';

describe('isRtl', () => {
  it('is true for right-to-left language codes', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('he')).toBe(true);
    expect(isRtl('fa')).toBe(true);
    expect(isRtl('ur')).toBe(true);
  });

  it('is false for left-to-right language codes', () => {
    expect(isRtl('en')).toBe(false);
    expect(isRtl('fr')).toBe(false);
  });
});
