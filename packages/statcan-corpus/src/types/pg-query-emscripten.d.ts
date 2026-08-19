/**
 * Minimal ambient types for `pg-query-emscripten`, which ships no declarations.
 *
 * Only what `schema.test.ts` uses is declared. The parse tree is left as `unknown` rather than
 * modelled: it is libpg_query's full Postgres AST, the test reads one key off each node, and a
 * hand-written approximation of that shape would be a maintenance burden pretending to be safety.
 */
declare module 'pg-query-emscripten' {
  interface PgParseError {
    message: string;
    cursorpos: number;
    funcname?: string;
    filename?: string;
    lineno?: number;
  }

  interface PgParseResult {
    /** `null` on success, not `undefined`. */
    error?: PgParseError | null;
    parse_tree?: { stmts?: Array<{ stmt: Record<string, unknown> }> };
  }

  interface PgQuery {
    parse(sql: string): PgParseResult;
  }

  /** The module default is a factory returning a promise for the initialized wasm module. */
  const init: () => Promise<PgQuery>;
  export default init;
}
