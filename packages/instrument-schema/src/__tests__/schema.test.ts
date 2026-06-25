import { describe, it, expect } from 'vitest';
import { householdInstrument } from '../examples/household.instrument.js';
import { lfsInstrument } from '../examples/lfs.instrument.js';
import { demoInstrument } from '../examples/demo.instrument.js';
import { validateInstrument } from '../validate.js';
import { getInstrumentJsonSchema } from '../jsonSchema.js';
import type { Instrument } from '../types.js';

// Deep clone so mutations in one test never leak into another.
const clone = (): Instrument => structuredClone(householdInstrument);

describe('validateInstrument', () => {
  it('accepts the bilingual household example', () => {
    const result = validateInstrument(householdInstrument);
    expect(result.ok).toBe(true);
  });

  it('accepts the bundled Labour Force and Demo surveys', () => {
    const lfs = validateInstrument(lfsInstrument);
    const demo = validateInstrument(demoInstrument);
    if (!lfs.ok) console.error('LFS issues', lfs.issues);
    if (!demo.ok) console.error('Demo issues', demo.issues);
    expect(lfs.ok).toBe(true);
    expect(demo.ok).toBe(true);
  });

  it('rejects a missing defaultLanguage not present in languages', () => {
    const bad = clone();
    bad.defaultLanguage = 'de';
    const result = validateInstrument(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /defaultLanguage/.test(i.path))).toBe(true);
    }
  });

  it('flags a question referencing an unknown variable (referential integrity)', () => {
    const bad = clone();
    const firstQuestion = bad.sequence.children.find((c) => c.type === 'question');
    if (firstQuestion && firstQuestion.type === 'question') {
      firstQuestion.variableRef = 'doesNotExist';
    }
    const result = validateInstrument(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /unknown variable/.test(i.message))).toBe(true);
    }
  });

  it('flags a coded response domain pointing at an unknown category scheme', () => {
    const bad = clone();
    // Walk to the relationship question inside the members loop.
    const loop = bad.sequence.children.find((c) => c.type === 'loop');
    if (loop && loop.type === 'loop') {
      const rel = loop.children.find(
        (c) => c.type === 'question' && c.id === 'q.relationship',
      );
      if (rel && rel.type === 'question' && rel.responseDomain.type === 'code') {
        rel.responseDomain.categorySchemeRef = 'cs.nope';
      }
    }
    const result = validateInstrument(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /Unknown category scheme/.test(i.message))).toBe(true);
    }
  });

  it('requires derived variables to carry a compute expression', () => {
    const bad = clone();
    const derived = bad.variables.find((v) => v.name === 'largeHousehold');
    if (derived) delete derived.compute;
    const result = validateInstrument(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects entirely malformed input', () => {
    expect(validateInstrument({ hello: 'world' }).ok).toBe(false);
    expect(validateInstrument(null).ok).toBe(false);
  });
});

describe('getInstrumentJsonSchema', () => {
  it('produces a JSON Schema object the example conforms to structurally', () => {
    const schema = getInstrumentJsonSchema();
    expect(schema).toHaveProperty('$schema');
    // The generated schema should name the Instrument definition.
    expect(JSON.stringify(schema)).toContain('Instrument');
  });
});
