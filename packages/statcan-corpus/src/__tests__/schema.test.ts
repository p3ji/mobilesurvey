/**
 * The Supabase schema, checked against the real PostgreSQL grammar.
 *
 * `sql/schema.sql` is applied by hand in the Supabase SQL editor, so nothing else in this repo
 * ever executes it — which means a syntax error sits in a committed file until someone pastes it
 * into a browser and gets an error at the wrong moment. This suite closes that gap the only way
 * available without a database: it runs the actual Postgres parser (libpg_query, compiled to
 * wasm) over the file.
 *
 * It earned its place immediately. The first version of `corpus_search` declared
 * `returns table (… position text, length text …)`, which looks obviously fine and is not:
 * `position` and `length` are `col_name_keyword`s, legal as *table column* names but rejected as
 * *function parameter* names, which is what a RETURNS TABLE entry is. The parser caught it here.
 *
 * **What this does not check.** Parsing is grammar, not semantics: it cannot tell you that a
 * referenced column exists, that a function is really immutable, or that a GRANT names a role the
 * project has. Those need a live Postgres, which is what applying the schema is.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import PgQueryModule from 'pg-query-emscripten';

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'sql',
  'schema.sql',
);

type Pg = Awaited<ReturnType<typeof PgQueryModule>>;
type ParseResult = ReturnType<Pg['parse']>;

let pg: Pg;
let schema: string;

/** Where a parse error landed, as `line N: <the text around it>` — a cursor offset is unusable. */
function locate(sql: string, cursorpos: number): string {
  const line = sql.slice(0, cursorpos).split('\n').length;
  return `line ${line}: …${sql.slice(Math.max(0, cursorpos - 90), cursorpos + 40).replace(/\n/g, '⏎')}…`;
}

function statementKinds(result: ParseResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of result.parse_tree?.stmts ?? []) {
    const kind = Object.keys(entry.stmt)[0] ?? 'unknown';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

beforeAll(async () => {
  pg = await PgQueryModule();
  schema = readFileSync(SCHEMA_PATH, 'utf8');
});

describe('sql/schema.sql', () => {
  it('parses as PostgreSQL', () => {
    const result = pg.parse(schema);
    expect(
      result.error == null
        ? undefined
        : `${result.error.message} — ${locate(schema, result.error.cursorpos)}`,
    ).toBeUndefined();
  });

  it('declares everything the deployment step and the client depend on', () => {
    const kinds = statementKinds(pg.parse(schema));
    // Asserted as a shape rather than a total so adding an index is not a test edit, but losing
    // the table, a function, or a GRANT is.
    expect(kinds.CreateStmt).toBe(1);
    expect(kinds.CreateFunctionStmt).toBe(4);
    expect(kinds.CreateExtensionStmt).toBe(1);
    expect(kinds.AlterTableStmt).toBe(1);
    expect(kinds.GrantStmt).toBeGreaterThanOrEqual(4);
    expect(kinds.IndexStmt).toBeGreaterThanOrEqual(3);
  });

  it('parses every SQL function body, not just the CREATE that wraps it', () => {
    // The bodies are dollar-quoted string literals, so the statement-level parse above skips them
    // entirely — and `corpus_search`, the one query that matters, lives inside one.
    const bodies = [
      ...schema.matchAll(/create or replace function\s+(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g),
    ];
    expect(bodies.length).toBe(4);

    for (const [, name, body] of bodies) {
      const result = pg.parse(body!);
      expect(
        result.error == null
          ? undefined
          : `${name}: ${result.error.message} — ${locate(body!, result.error.cursorpos)}`,
      ).toBeUndefined();
    }
  });

  it('grants select to anon and never anything more', () => {
    // The browser holds the publishable key. An insert/update/delete grant here would hand every
    // visitor write access to the corpus, and RLS would not save it — the policy is `using (true)`.
    const grants = [...schema.matchAll(/grant\s+([a-z, ]+?)\s+on\s+(\S+)/gi)];
    for (const [, privileges, target] of grants) {
      const allowed = target!.startsWith('function') ? 'execute' : 'select';
      expect(privileges!.trim().toLowerCase()).toBe(allowed);
    }
    expect(schema).toMatch(/grant select on corpus_variable to anon/);
  });

  it('keeps the RETURNS TABLE columns in step with the client row type', () => {
    // `CorpusSearchRow` in metadata-registry is hand-written against these names; PostgREST returns
    // exactly what the function declares, so a rename here is a silent `undefined` in the UI.
    const returns = /returns table \(([\s\S]*?)\n\)\nlanguage sql/.exec(schema);
    expect(returns).not.toBeNull();

    const declared = [...returns![1]!.matchAll(/^\s{2}"?([a-z_]+)"?\s+\w/gm)].map((m) => m[1]!);
    expect(declared).toEqual([
      'record_id',
      'name',
      'position',
      'length',
      'concept',
      'question_text',
      'universe',
      'note',
      'codes',
      'code_count',
      'bundle',
      'path',
      'page',
      'tcode',
      'survey_group',
      'survey_acronym',
      'cycle',
      'year',
      'lang',
      'rank',
      'total_count',
    ]);
  });
});
