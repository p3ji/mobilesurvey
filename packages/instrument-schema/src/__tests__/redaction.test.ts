import { describe, it, expect } from 'vitest';
import { redactResponses, piiVariableNames, PII_PLACEHOLDER } from '../redaction.js';
import { blankInstrument } from '../blank.js';
import type { Instrument, Variable } from '../types.js';

function makeInstrument(vars: Pick<Variable, 'name' | 'isPII'>[]): Instrument {
  const base = blankInstrument('Test');
  return {
    ...base,
    variables: vars.map((v) => ({
      id: `var.${v.name}`,
      name: v.name,
      kind: 'collected',
      label: { en: v.name },
      representation: 'text',
      isPII: v.isPII,
    })),
  };
}

describe('redactResponses()', () => {
  it('passes through unchanged when no PII variables', () => {
    const inst = makeInstrument([{ name: 'age', isPII: false }]);
    const responses = { 'age@': 42 };
    expect(redactResponses(responses, inst)).toEqual({ 'age@': 42 });
  });

  it('replaces PII variable values with placeholder', () => {
    const inst = makeInstrument([
      { name: 'name', isPII: true },
      { name: 'age', isPII: false },
    ]);
    const responses = { 'name@': 'Alice Smith', 'age@': 30 };
    const result = redactResponses(responses, inst);
    expect(result['name@']).toBe(PII_PLACEHOLDER);
    expect(result['age@']).toBe(30);
  });

  it('redacts roster keys (varName@loopName.index)', () => {
    const inst = makeInstrument([
      { name: 'memberName', isPII: true },
      { name: 'memberAge', isPII: false },
    ]);
    const responses = {
      'memberName@m.1': 'Bob',
      'memberName@m.2': 'Carol',
      'memberAge@m.1': 35,
    };
    const result = redactResponses(responses, inst);
    expect(result['memberName@m.1']).toBe(PII_PLACEHOLDER);
    expect(result['memberName@m.2']).toBe(PII_PLACEHOLDER);
    expect(result['memberAge@m.1']).toBe(35);
  });

  it('does not mutate the original responses object', () => {
    const inst = makeInstrument([{ name: 'email', isPII: true }]);
    const responses = { 'email@': 'test@example.com' };
    redactResponses(responses, inst);
    expect(responses['email@']).toBe('test@example.com');
  });

  it('keys without @ separator are matched by name', () => {
    const inst = makeInstrument([{ name: 'phone', isPII: true }]);
    const responses = { phone: '555-0100' };
    const result = redactResponses(responses, inst);
    expect(result['phone']).toBe(PII_PLACEHOLDER);
  });

  it('passes through keys not in any variable', () => {
    const inst = makeInstrument([{ name: 'age', isPII: false }]);
    const responses = { 'unknown@': 'x', 'age@': 25 };
    const result = redactResponses(responses, inst);
    expect(result['unknown@']).toBe('x');
    expect(result['age@']).toBe(25);
  });
});

describe('piiVariableNames()', () => {
  it('returns only PII-tagged variable names', () => {
    const inst = makeInstrument([
      { name: 'name', isPII: true },
      { name: 'email', isPII: true },
      { name: 'age', isPII: false },
    ]);
    const names = piiVariableNames(inst);
    expect(names.has('name')).toBe(true);
    expect(names.has('email')).toBe(true);
    expect(names.has('age')).toBe(false);
    expect(names.size).toBe(2);
  });

  it('returns empty set when no PII variables', () => {
    const inst = makeInstrument([{ name: 'score', isPII: false }]);
    expect(piiVariableNames(inst).size).toBe(0);
  });
});
