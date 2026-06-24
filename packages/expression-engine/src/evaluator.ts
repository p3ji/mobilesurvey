/**
 * Tree-walking evaluator. No `eval`/`Function`/host access — only the AST and a whitelisted
 * function table are reachable, so author-authored expressions cannot touch globals.
 */
import type { Node } from './ast.js';

export class EvalError extends Error {}

/** Resolves variable references (`$name`) to runtime values. */
export interface EvalContext {
  resolve(name: string): unknown;
}

/** Build an `EvalContext` from a plain record (missing keys resolve to `undefined`). */
export function recordContext(record: Record<string, unknown>): EvalContext {
  return { resolve: (name) => record[name] };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined || v === '' || v === 0) return false;
  if (typeof v === 'number') return !Number.isNaN(v) && v !== 0;
  return true;
}

function looseEqual(a: unknown, b: unknown): boolean {
  const an = a === undefined ? null : a;
  const bn = b === undefined ? null : b;
  if (an === null || bn === null) return an === bn;
  if (typeof an === 'number' || typeof bn === 'number') return toNumber(an) === toNumber(bn);
  if (typeof an === 'boolean' || typeof bn === 'boolean') return toBool(an) === toBool(bn);
  return String(an) === String(bn);
}

type Fn = (args: unknown[]) => unknown;

const FUNCTIONS: Record<string, Fn> = {
  count: (args) => {
    const x = args[0];
    if (Array.isArray(x)) return x.length;
    return x === null || x === undefined || x === '' ? 0 : 1;
  },
  sum: (args) => {
    const x = args[0];
    const arr = Array.isArray(x) ? x : args;
    return arr.reduce<number>((acc, v) => acc + (Number.isNaN(toNumber(v)) ? 0 : toNumber(v)), 0);
  },
  isAnswered: (args) => {
    const x = args[0];
    return x !== null && x !== undefined && x !== '';
  },
  len: (args) => {
    const x = args[0];
    if (typeof x === 'string' || Array.isArray(x)) return x.length;
    return x === null || x === undefined ? 0 : String(x).length;
  },
  contains: (args) => {
    const [haystack, needle] = args;
    if (Array.isArray(haystack)) return haystack.some((v) => looseEqual(v, needle));
    if (typeof haystack === 'string') return haystack.includes(String(needle ?? ''));
    return false;
  },
  matches: (args) => {
    const [str, pattern] = args;
    try {
      return new RegExp(String(pattern ?? '')).test(String(str ?? ''));
    } catch {
      return false;
    }
  },
  upper: (args) => String(args[0] ?? '').toUpperCase(),
  lower: (args) => String(args[0] ?? '').toLowerCase(),
  abs: (args) => Math.abs(toNumber(args[0])),
  round: (args) => Math.round(toNumber(args[0])),
  floor: (args) => Math.floor(toNumber(args[0])),
  ceil: (args) => Math.ceil(toNumber(args[0])),
  min: (args) => Math.min(...args.map(toNumber)),
  max: (args) => Math.max(...args.map(toNumber)),
};

/** Names of the whitelisted functions (useful for editor autocompletion). */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export function evaluate(node: Node, context: EvalContext): unknown {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    case 'var':
      return context.resolve(node.name);
    case 'unary': {
      const v = evaluate(node.operand, context);
      return node.op === '-' ? -toNumber(v) : !toBool(v);
    }
    case 'binary': {
      // Short-circuit logical operators.
      if (node.op === '&&') return toBool(evaluate(node.left, context)) && toBool(evaluate(node.right, context));
      if (node.op === '||') return toBool(evaluate(node.left, context)) || toBool(evaluate(node.right, context));

      const l = evaluate(node.left, context);
      const r = evaluate(node.right, context);
      switch (node.op) {
        case '+': {
          // String concatenation when either operand is a (non-numeric) string.
          if (typeof l === 'string' || typeof r === 'string') {
            const ln = toNumber(l);
            const rn = toNumber(r);
            if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln + rn;
            return String(l ?? '') + String(r ?? '');
          }
          return toNumber(l) + toNumber(r);
        }
        case '-':
          return toNumber(l) - toNumber(r);
        case '*':
          return toNumber(l) * toNumber(r);
        case '/':
          return toNumber(l) / toNumber(r);
        case '%':
          return toNumber(l) % toNumber(r);
        case '==':
          return looseEqual(l, r);
        case '!=':
          return !looseEqual(l, r);
        case '<':
          return toNumber(l) < toNumber(r);
        case '<=':
          return toNumber(l) <= toNumber(r);
        case '>':
          return toNumber(l) > toNumber(r);
        case '>=':
          return toNumber(l) >= toNumber(r);
        default:
          throw new EvalError(`Unknown operator ${node.op}`);
      }
    }
    case 'call': {
      // Own-property guard: prevents inherited members (e.g. `constructor`, `toString`) from
      // being reachable as "functions" through the prototype chain.
      const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, node.name)
        ? FUNCTIONS[node.name]
        : undefined;
      if (!fn) throw new EvalError(`Unknown function '${node.name}'`);
      const args = node.args.map((a) => evaluate(a, context));
      return fn(args);
    }
    default:
      throw new EvalError('Unknown node');
  }
}

/** Collect the distinct variable names referenced anywhere in an AST (for dependency tracking). */
export function referencedVariables(node: Node, acc: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case 'var':
      acc.add(node.name);
      break;
    case 'unary':
      referencedVariables(node.operand, acc);
      break;
    case 'binary':
      referencedVariables(node.left, acc);
      referencedVariables(node.right, acc);
      break;
    case 'call':
      node.args.forEach((a) => referencedVariables(a, acc));
      break;
    default:
      break;
  }
  return acc;
}
