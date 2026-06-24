/**
 * Precedence-climbing parser producing the AST in `./ast.ts`.
 *
 * Keyword aliases: `and`→`&&`, `or`→`||`, `not`→`!`. Booleans/null are keywords. Function calls
 * are an identifier immediately followed by `(`. Bare identifiers (not keywords, not calls) are a
 * parse error — variables must be written `$name`.
 */
import type { BinaryOp, Node } from './ast.js';
import { tokenize, type Token } from './lexer.js';

export class ParseError extends Error {}

// Binary operators by precedence level (lowest binds loosest).
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const KEYWORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: Token['type']): Token {
    const t = this.next();
    if (t.type !== type) {
      throw new ParseError(`Expected ${type} but found '${t.value || t.type}' at position ${t.pos}`);
    }
    return t;
  }

  /** Normalize an `op` token or keyword-as-operator into its canonical operator string. */
  private asOperator(t: Token): string | null {
    if (t.type === 'op') return t.value;
    if (t.type === 'ident' && t.value in KEYWORD_OPS) return KEYWORD_OPS[t.value]!;
    return null;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.peek().type !== 'eof') {
      const t = this.peek();
      throw new ParseError(`Unexpected '${t.value || t.type}' at position ${t.pos}`);
    }
    return node;
  }

  private parseExpression(minPrec: number): Node {
    let left = this.parseUnary();
    for (;;) {
      const op = this.asOperator(this.peek());
      if (op === null || !(op in PRECEDENCE)) break;
      const prec = PRECEDENCE[op]!;
      if (prec < minPrec) break;
      this.next(); // consume operator
      // Left-associative: parse right side with higher minimum precedence.
      const right = this.parseExpression(prec + 1);
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    const op = this.asOperator(t);
    if (op === '-' || op === '!') {
      this.next();
      return { kind: 'unary', op, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.next();
    switch (t.type) {
      case 'number': {
        const value = Number(t.value);
        if (Number.isNaN(value)) throw new ParseError(`Invalid number '${t.value}'`);
        return { kind: 'number', value };
      }
      case 'string':
        return { kind: 'string', value: t.value };
      case 'var':
        return { kind: 'var', name: t.value };
      case 'lparen': {
        const inner = this.parseExpression(0);
        this.expect('rparen');
        return inner;
      }
      case 'ident': {
        if (t.value === 'true') return { kind: 'boolean', value: true };
        if (t.value === 'false') return { kind: 'boolean', value: false };
        if (t.value === 'null') return { kind: 'null' };
        // Function call: identifier followed by '('.
        if (this.peek().type === 'lparen') {
          this.next(); // consume '('
          const args: Node[] = [];
          if (this.peek().type !== 'rparen') {
            args.push(this.parseExpression(0));
            while (this.peek().type === 'comma') {
              this.next();
              args.push(this.parseExpression(0));
            }
          }
          this.expect('rparen');
          return { kind: 'call', name: t.value, args };
        }
        throw new ParseError(
          `Unexpected identifier '${t.value}' at position ${t.pos} (use $${t.value} for a variable)`,
        );
      }
      default:
        throw new ParseError(`Unexpected token '${t.value || t.type}' at position ${t.pos}`);
    }
  }
}

export function parse(src: string): Node {
  return new Parser(tokenize(src)).parse();
}
