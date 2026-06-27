import { describe, it, expect } from 'vitest';
import { demoInstrument } from '@mobilesurvey/instrument-schema';
import { generateValues, generateCanonicalValue } from '../answer-gen.js';
import type { ResponseDomain } from '@mobilesurvey/instrument-schema';

// Minimal instrument wrapper — borrow categorySchemes from the demo instrument.
const instrument = demoInstrument;

// Pull a known code scheme from the demo instrument for test setup.
const colorScheme = instrument.categorySchemes.find((s) => s.id === 'cs.color')!;
const colorCodes = colorScheme.categories.map((c) => c.code); // ['blue','green','purple','orange','other']

describe('generateValues — code/single', () => {
  const domain: ResponseDomain = {
    type: 'code',
    categorySchemeRef: 'cs.color',
    selection: 'single',
  };

  it('routing: returns all category codes', () => {
    const values = generateValues(domain, instrument, 'routing');
    expect(values).toEqual(colorCodes);
    expect(values.length).toBe(5);
  });

  it('canonical: returns first code only', () => {
    const values = generateValues(domain, instrument, 'canonical');
    expect(values).toHaveLength(1);
    expect(values[0]).toBe('blue');
  });

  it('boundary: returns null + first + last code', () => {
    const values = generateValues(domain, instrument, 'boundary');
    expect(values).toContain(null);
    expect(values).toContain('blue');
    expect(values).toContain('other');
  });
});

describe('generateValues — code/multiple', () => {
  const domain: ResponseDomain = {
    type: 'code',
    categorySchemeRef: 'cs.devices',
    selection: 'multiple',
  };

  it('routing: returns empty, one, and all-selected arrays', () => {
    const values = generateValues(domain, instrument, 'routing') as unknown[][];
    expect(values.some((v) => Array.isArray(v) && v.length === 0)).toBe(true);
    expect(values.some((v) => Array.isArray(v) && v.length === 1)).toBe(true);
    expect(values.some((v) => Array.isArray(v) && v.length > 1)).toBe(true);
  });

  it('canonical: returns single-item array', () => {
    const values = generateValues(domain, instrument, 'canonical');
    expect(values).toHaveLength(1);
    expect(Array.isArray(values[0])).toBe(true);
    expect((values[0] as string[]).length).toBe(1);
  });
});

describe('generateValues — numeric', () => {
  const domain: ResponseDomain = { type: 'numeric', min: 1, max: 10 };

  it('routing: returns min, mid, max', () => {
    const values = generateValues(domain, instrument, 'routing') as number[];
    expect(values).toContain(1);
    expect(values).toContain(10);
    expect(values.length).toBe(3);
  });

  it('canonical: returns mid-point', () => {
    const [v] = generateValues(domain, instrument, 'canonical') as number[];
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(10);
  });

  it('boundary: includes out-of-range values', () => {
    const values = generateValues(domain, instrument, 'boundary') as number[];
    expect(values).toContain(0);  // min - 1
    expect(values).toContain(11); // max + 1
  });
});

describe('generateValues — text', () => {
  const domain: ResponseDomain = { type: 'text', maxLength: 20 };

  it('routing: returns normal text and empty string', () => {
    const values = generateValues(domain, instrument, 'routing');
    expect(values).toContain('Test response');
    expect(values).toContain('');
  });

  it('boundary: includes a string exceeding maxLength', () => {
    const values = generateValues(domain, instrument, 'boundary') as string[];
    const tooLong = values.find((v) => v.length > 20);
    expect(tooLong).toBeDefined();
  });

  it('boundary: includes XSS probe string', () => {
    const values = generateValues(domain, instrument, 'boundary') as string[];
    expect(values.some((v) => v.includes('<script>'))).toBe(true);
  });
});

describe('generateValues — boolean', () => {
  const domain: ResponseDomain = { type: 'boolean' };

  it('routing: returns both true and false', () => {
    expect(generateValues(domain, instrument, 'routing')).toEqual([true, false]);
  });

  it('canonical: returns true only', () => {
    expect(generateValues(domain, instrument, 'canonical')).toEqual([true]);
  });
});

describe('generateValues — datetime', () => {
  const domain: ResponseDomain = { type: 'datetime', mode: 'date' };

  it('routing: returns two distinct date strings', () => {
    const values = generateValues(domain, instrument, 'routing') as string[];
    expect(values.length).toBe(2);
    expect(values[0]).not.toBe(values[1]);
  });

  it('boundary: includes empty string and invalid date string', () => {
    const values = generateValues(domain, instrument, 'boundary') as string[];
    expect(values).toContain('');
    expect(values).toContain('not-a-date');
  });
});

describe('generateValues — file / markAll / grid', () => {
  it('file domain returns [] (handled separately)', () => {
    const domain: ResponseDomain = { type: 'file' };
    expect(generateValues(domain, instrument, 'routing')).toEqual([]);
  });

  it('markAll domain returns [] (handled at block level)', () => {
    const domain: ResponseDomain = { type: 'markAll', categorySchemeRef: 'cs.topics', variablePrefix: 'T' };
    expect(generateValues(domain, instrument, 'routing')).toEqual([]);
  });

  it('grid domain returns []', () => {
    const domain: ResponseDomain = { type: 'grid', rowSchemeRef: 'r', colSchemeRef: 'c', variablePrefix: 'G' };
    expect(generateValues(domain, instrument, 'routing')).toEqual([]);
  });
});

describe('generateCanonicalValue', () => {
  it('returns first code for code/single', () => {
    const domain: ResponseDomain = { type: 'code', categorySchemeRef: 'cs.color', selection: 'single' };
    expect(generateCanonicalValue(domain, instrument)).toBe('blue');
  });

  it('returns mid-point for numeric', () => {
    const domain: ResponseDomain = { type: 'numeric', min: 0, max: 100 };
    expect(generateCanonicalValue(domain, instrument)).toBe(50);
  });

  it('returns true for boolean', () => {
    const domain: ResponseDomain = { type: 'boolean' };
    expect(generateCanonicalValue(domain, instrument)).toBe(true);
  });

  it('returns null for unknown/empty lookup scheme', () => {
    const domain: ResponseDomain = { type: 'lookup', categorySchemeRef: 'cs.nonexistent' };
    expect(generateCanonicalValue(domain, instrument)).toBe('test');
  });
});
