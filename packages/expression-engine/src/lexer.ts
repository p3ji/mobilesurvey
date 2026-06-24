/** Tokenizer for the expression language. */

export type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'var'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class LexError extends Error {}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '!']);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c: string) => c >= '0' && c <= '9';

  while (i < n) {
    const c = src[i]!;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'lparen', value: c, pos: i++ });
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c, pos: i++ });
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: c, pos: i++ });
      continue;
    }

    // Variable reference: $name
    if (c === '$') {
      const start = i;
      i++;
      if (i >= n || !isIdentStart(src[i]!)) {
        throw new LexError(`Expected variable name after '$' at position ${start}`);
      }
      let name = '';
      while (i < n && isIdentPart(src[i]!)) name += src[i++]!;
      tokens.push({ type: 'var', value: name, pos: start });
      continue;
    }

    // String literal: single or double quoted.
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let value = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i++;
          value += src[i++];
        } else {
          value += src[i++];
        }
      }
      if (i >= n) throw new LexError(`Unterminated string starting at position ${start}`);
      i++; // closing quote
      tokens.push({ type: 'string', value, pos: start });
      continue;
    }

    // Number literal.
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      let num = '';
      while (i < n && (isDigit(src[i]!) || src[i] === '.')) num += src[i++]!;
      tokens.push({ type: 'number', value: num, pos: start });
      continue;
    }

    // Identifier / keyword (true/false/null/and/or/not + function names).
    if (isIdentStart(c)) {
      const start = i;
      let name = '';
      while (i < n && isIdentPart(src[i]!)) name += src[i++]!;
      tokens.push({ type: 'ident', value: name, pos: start });
      continue;
    }

    // Operators (two-char first).
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: 'op', value: c, pos: i++ });
      continue;
    }

    throw new LexError(`Unexpected character '${c}' at position ${i}`);
  }

  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}
