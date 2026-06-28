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

describe('len()', () => {
  it('returns string length', () => {
    expect(evaluateSource('len("hello")', ctx({}))).toBe(5);
    expect(evaluateSource('len("")', ctx({}))).toBe(0);
  });
  it('returns array length', () => {
    expect(evaluateSource('len($x)', ctx({ x: [1, 2, 3] }))).toBe(3);
  });
  it('returns 0 for null/undefined', () => {
    expect(evaluateSource('len($x)', ctx({}))).toBe(0);
  });
  it('converts other values to string and measures', () => {
    expect(evaluateSource('len(42)', ctx({}))).toBe(2);
  });
});

describe('contains()', () => {
  it('checks string substring', () => {
    expect(evaluateSource('contains("foobar", "oba")', ctx({}))).toBe(true);
    expect(evaluateSource('contains("foobar", "xyz")', ctx({}))).toBe(false);
  });
  it('checks array membership with loose equality', () => {
    expect(evaluateSource('contains($x, 2)', ctx({ x: [1, 2, 3] }))).toBe(true);
    expect(evaluateSource('contains($x, 9)', ctx({ x: [1, 2, 3] }))).toBe(false);
  });
  it('returns false for non-string non-array haystack', () => {
    expect(evaluateSource('contains($x, "a")', ctx({ x: 42 }))).toBe(false);
  });
});

describe('upper() / lower()', () => {
  it('upper-cases strings', () => {
    expect(evaluateSource('upper("hello")', ctx({}))).toBe('HELLO');
    expect(evaluateSource('upper($x)', ctx({ x: 'World' }))).toBe('WORLD');
  });
  it('lower-cases strings', () => {
    expect(evaluateSource('lower("HELLO")', ctx({}))).toBe('hello');
  });
  it('treats null/undefined as empty string', () => {
    expect(evaluateSource('upper($x)', ctx({}))).toBe('');
    expect(evaluateSource('lower($x)', ctx({}))).toBe('');
  });
});

describe('abs() / round() / floor() / ceil()', () => {
  it('abs returns absolute value', () => {
    expect(evaluateSource('abs(-5)', ctx({}))).toBe(5);
    expect(evaluateSource('abs(3.7)', ctx({}))).toBe(3.7);
  });
  it('round rounds to nearest integer', () => {
    expect(evaluateSource('round(2.4)', ctx({}))).toBe(2);
    expect(evaluateSource('round(2.5)', ctx({}))).toBe(3);
    expect(evaluateSource('round(-1.5)', ctx({}))).toBe(-1);
  });
  it('floor rounds down', () => {
    expect(evaluateSource('floor(2.9)', ctx({}))).toBe(2);
    expect(evaluateSource('floor(-2.1)', ctx({}))).toBe(-3);
  });
  it('ceil rounds up', () => {
    expect(evaluateSource('ceil(2.1)', ctx({}))).toBe(3);
    expect(evaluateSource('ceil(-2.9)', ctx({}))).toBe(-2);
  });
});

describe('min() / max()', () => {
  it('min returns the smallest of multiple args', () => {
    expect(evaluateSource('min(3, 1, 2)', ctx({}))).toBe(1);
    expect(evaluateSource('min($a, $b)', ctx({ a: 10, b: 4 }))).toBe(4);
  });
  it('max returns the largest of multiple args', () => {
    expect(evaluateSource('max(3, 1, 2)', ctx({}))).toBe(3);
    expect(evaluateSource('max($a, $b)', ctx({ a: 10, b: 4 }))).toBe(10);
  });
  it('min/max with a single arg act as identity', () => {
    expect(evaluateSource('min(7)', ctx({}))).toBe(7);
    expect(evaluateSource('max(7)', ctx({}))).toBe(7);
  });
});

describe('division and modulo', () => {
  it('divides integers', () => {
    expect(evaluateSource('10 / 2', ctx({}))).toBe(5);
  });
  it('produces a decimal for non-even division', () => {
    expect(evaluateSource('1 / 4', ctx({}))).toBe(0.25);
  });
  it('division by zero yields Infinity', () => {
    expect(evaluateSource('1 / 0', ctx({}))).toBe(Infinity);
  });
  it('modulo yields remainder', () => {
    expect(evaluateSource('10 % 3', ctx({}))).toBe(1);
    expect(evaluateSource('10 % 5', ctx({}))).toBe(0);
  });
  it('modulo with floats', () => {
    expect(evaluateSource('$x % 2', ctx({ x: 7 }))).toBe(1);
  });
});

describe('null literal', () => {
  it('evaluates to null', () => {
    expect(evaluateSource('null', ctx({}))).toBeNull();
  });
  it('is falsy in boolean context', () => {
    expect(evaluateCondition('null', {})).toBe(false);
  });
  it('equals undefined variable via loose equality', () => {
    expect(evaluateSource('$x == null', ctx({}))).toBe(true);
    expect(evaluateSource('$x == null', ctx({ x: 0 }))).toBe(false);
  });
  it('null != non-null', () => {
    expect(evaluateSource('null != "a"', ctx({}))).toBe(true);
  });
});

describe('nested function calls', () => {
  it('abs(round($x)) composes correctly', () => {
    expect(evaluateSource('abs(round($x))', ctx({ x: -2.6 }))).toBe(3);
  });
  it('upper(lower($x)) is identity for ASCII', () => {
    expect(evaluateSource('upper(lower("HeLLo"))', ctx({}))).toBe('HELLO');
  });
  it('len(upper($x)) measures the transformed string', () => {
    expect(evaluateSource('len(upper($x))', ctx({ x: 'hi' }))).toBe(2);
  });
  it('min(abs($a), abs($b)) finds the smaller magnitude', () => {
    expect(evaluateSource('min(abs($a), abs($b))', ctx({ a: -5, b: 3 }))).toBe(3);
  });
});
