/**
 * `@mobilesurvey/expression-engine` — the single logic core reused by routing, visibility,
 * derived computation and edit rules across the schema, runtime engine and designer.
 */
import type { Node } from './ast.js';
import { parse } from './parser.js';
import {
  evaluate,
  recordContext,
  referencedVariables,
  type EvalContext,
} from './evaluator.js';

export type { Node } from './ast.js';
export { tokenize, LexError, type Token } from './lexer.js';
export { parse, ParseError } from './parser.js';
export {
  evaluate,
  recordContext,
  referencedVariables,
  EvalError,
  FUNCTION_NAMES,
  type EvalContext,
} from './evaluator.js';

/** Result of attempting to compile expression source. */
export type CompileResult =
  | { ok: true; ast: Node }
  | { ok: false; error: string };

/** Parse without throwing — handy for live editor feedback. */
export function compile(src: string): CompileResult {
  try {
    return { ok: true, ast: parse(src) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Convenience: parse + evaluate source against a context. Empty source resolves to `true`. */
export function evaluateSource(src: string, context: EvalContext): unknown {
  if (src.trim() === '') return true;
  return evaluate(parse(src), context);
}

/** Convenience: evaluate source against a plain record, coerced to boolean (for conditions). */
export function evaluateCondition(src: string, variables: Record<string, unknown>): boolean {
  const result = evaluateSource(src, recordContext(variables));
  return Boolean(result);
}

/** Static analysis: which variables does this source reference? Returns [] on parse error. */
export function variablesUsed(src: string): string[] {
  try {
    return [...referencedVariables(parse(src))];
  } catch {
    return [];
  }
}
