/** Abstract syntax tree for the expression language. */

export type Literal =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' };

/** Reference to an instrument variable, written `$name` in source. */
export interface VarRef {
  kind: 'var';
  name: string;
}

export interface Unary {
  kind: 'unary';
  op: '-' | '!';
  operand: Node;
}

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export interface Binary {
  kind: 'binary';
  op: BinaryOp;
  left: Node;
  right: Node;
}

/** Whitelisted function call, e.g. `count($x)`, `isAnswered($y)`. */
export interface Call {
  kind: 'call';
  name: string;
  args: Node[];
}

export type Node = Literal | VarRef | Unary | Binary | Call;
