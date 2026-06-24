import { describe, it, expect } from 'vitest';
import {
  compile,
  evaluateCondition,
  evaluateSource,
  recordContext,
  variablesUsed,
} from '../index.js';

const ctx = (vars: Record<string, unknown>) => recordContext(vars);

describe('parsing', () => {
  it('reports a clear error for bare identifiers (must use $)', () => {
    const r = compile('foo > 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\$foo/);
  });

  it('rejects unterminated strings', () => {
    expect(compile("'oops").ok).toBe(false);
  });

  it('accepts valid expressions', () => {
    expect(compile('$a > 1 && ($b == "x" || not $c)').ok).toBe(true);
  });
});

describe('operator precedence & arithmetic', () => {
  it('honours multiplication over addition', () => {
    expect(evaluateSource('2 + 3 * 4', ctx({}))).toBe(14);
  });
  it('honours parentheses', () => {
    expect(evaluateSource('(2 + 3) * 4', ctx({}))).toBe(20);
  });
  it('comparison binds looser than arithmetic', () => {
    expect(evaluateSource('1 + 1 == 2', ctx({}))).toBe(true);
  });
  it('logical and/or short-circuit with correct precedence', () => {
    expect(evaluateSource('true || false && false', ctx({}))).toBe(true);
  });
  it('keyword operators alias symbols', () => {
    expect(evaluateSource('$a > 1 and $a < 10', ctx({ a: 5 }))).toBe(true);
    expect(evaluateSource('not ($a == 1)', ctx({ a: 2 }))).toBe(true);
  });
});

describe('variables & coercion', () => {
  it('resolves variable references', () => {
    expect(evaluateSource('$hhSize > 5', ctx({ hhSize: 7 }))).toBe(true);
    expect(evaluateSource('$hhSize > 5', ctx({ hhSize: 3 }))).toBe(false);
  });
  it('treats unanswered numerics as NaN -> comparisons false', () => {
    expect(evaluateSource('$age > 110', ctx({}))).toBe(false);
  });
  it('compares codes as strings', () => {
    expect(evaluateSource('$rel == "spouse"', ctx({ rel: 'spouse' }))).toBe(true);
  });
  it('concatenates strings with +', () => {
    expect(evaluateSource('"a" + "b"', ctx({}))).toBe('ab');
  });
});

describe('functions', () => {
  it('count over arrays and scalars', () => {
    expect(evaluateSource('count($x)', ctx({ x: [1, 2, 3] }))).toBe(3);
    expect(evaluateSource('count($x)', ctx({ x: 'one' }))).toBe(1);
    expect(evaluateSource('count($x)', ctx({}))).toBe(0);
  });
  it('sum over arrays', () => {
    expect(evaluateSource('sum($x)', ctx({ x: [10, 20, 30] }))).toBe(60);
  });
  it('isAnswered distinguishes blank from filled', () => {
    expect(evaluateSource('isAnswered($x)', ctx({ x: '' }))).toBe(false);
    expect(evaluateSource('isAnswered($x)', ctx({ x: 0 }))).toBe(true);
  });
  it('matches with a regex pattern', () => {
    expect(evaluateSource('matches($x, "^A")', ctx({ x: 'Apple' }))).toBe(true);
  });
  it('rejects unknown functions at evaluation', () => {
    expect(() => evaluateSource('danger()', ctx({}))).toThrow();
  });
});

describe('safety', () => {
  it('cannot reach host globals — identifiers are not resolvable names', () => {
    // `constructor`, `globalThis` etc. are only parseable as function calls or $vars;
    // a bare reference is a parse error, and unknown calls throw.
    expect(compile('globalThis').ok).toBe(false);
    expect(() => evaluateSource('constructor()', ctx({}))).toThrow();
  });
});

describe('static analysis', () => {
  it('collects referenced variables', () => {
    expect(variablesUsed('$a + $b * count($c)').sort()).toEqual(['a', 'b', 'c']);
  });
  it('evaluateCondition coerces to boolean and treats empty as true', () => {
    expect(evaluateCondition('', {})).toBe(true);
    expect(evaluateCondition('$x', { x: 1 })).toBe(true);
    expect(evaluateCondition('$x', { x: 0 })).toBe(false);
  });
});
