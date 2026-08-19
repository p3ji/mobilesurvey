/**
 * Loader tests. The loader holds a service-role credential, so the tests that matter most are the
 * ones about *refusing* to run with the wrong one — a loader that silently no-ops against RLS
 * looks exactly like a successful load into an empty table.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  credentialsFromEnv,
  envWithFile,
  factKey,
  loadCorpusJsonl,
  parseEnvFile,
  upsertBatch,
} from '../load.js';
import { toCorpusRow } from '../project.js';
import type { CorpusVariable } from '../types.js';

const CREDS = { url: 'https://project.supabase.co', serviceRoleKey: 'sb_secret_test' };

const creds = (key: string) =>
  credentialsFromEnv({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key });

/** A JWT with the given payload. Only the middle segment is ever read, so the rest is filler. */
const jwt = (payload: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

function record(name: string): CorpusVariable {
  return {
    recordId: `00000000-0000-5000-8000-${name.padStart(12, '0')}`,
    name,
    position: '1',
    length: '2',
    concept: 'Concept ' + name,
    codes: [],
    source: {
      bundle: 'b.zip',
      path: 'S/doc.pdf',
      page: 1,
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'S',
      lang: 'en',
    },
  };
}

const dirs: string[] = [];
function jsonlFile(records: CorpusVariable[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'corpus-load-'));
  dirs.push(dir);
  const file = path.join(dir, 'corpus.jsonl');
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('credentialsFromEnv', () => {
  it('names both missing variables at once', () => {
    // One at a time would mean two failed runs to learn what to set.
    expect(() => credentialsFromEnv({})).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('rejects a publishable key', () => {
    // Writes with the anon key are refused by RLS *silently enough* to look like an empty corpus.
    expect(() => creds('sb_publishable_abc')).toThrow(/publishable key/);
  });

  it('rejects the scaffold placeholder before it reaches the network', () => {
    // Creating .env.local and forgetting to fill it in is the likeliest mistake of all, and a 401
    // several seconds into a load does not say which of the two values is wrong.
    expect(() => creds('PASTE_THE_SECRET_KEY_HERE')).toThrow(/still the placeholder/);
    expect(() => creds('<service-role-key>')).toThrow(/still the placeholder/);
  });

  it('rejects a legacy anon JWT by reading its role claim', () => {
    // The substring check this replaced could not catch this: {"role":"anon"} base64-encodes to
    // text containing no "anon" anywhere, so the wrong key sailed through to a silent no-op.
    expect(() => creds(jwt({ role: 'anon' }))).toThrow(/an "anon" key, not service_role/);
    expect(() => creds(jwt({ role: 'public' }))).toThrow(/a "public" key, not service_role/);
  });

  it('accepts a legacy service_role JWT', () => {
    expect(creds(jwt({ role: 'service_role' })).serviceRoleKey).toContain('.');
  });

  it('accepts a key shape it does not recognize', () => {
    // Conservative on purpose: refusing to run on a format that postdates this code would be a
    // worse failure than the mistake the guard exists to catch.
    expect(() => creds('sb_secret_something')).not.toThrow();
    expect(() => creds('not.a.jwt')).not.toThrow();
  });

  it('strips a trailing slash so the URL joins cleanly', () => {
    const creds = credentialsFromEnv({
      SUPABASE_URL: 'https://project.supabase.co//',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
    });
    expect(creds.url).toBe('https://project.supabase.co');
  });
});

describe('upsertBatch', () => {
  it('upserts on record_id, so a re-ingest updates rather than duplicating (D9)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    await upsertBatch(CREDS, [{ record_id: 'a' } as never], fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/rest/v1/corpus_variable?on_conflict=record_id');
    expect((init.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');
  });

  it('sends nothing for an empty batch', async () => {
    const fetchImpl = vi.fn();
    await upsertBatch(CREDS, [], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the server body on failure', async () => {
    // PostgREST puts the actionable part — the missing column, the failed constraint — in the
    // body. A bare "400 Bad Request" would send someone to the network tab to find it.
    const fetchImpl = vi.fn(
      async () => new Response('{"message":"column x does not exist"}', { status: 400 }),
    );
    await expect(
      upsertBatch(CREDS, [{ record_id: 'a' } as never], fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/column x does not exist/);
  });
});

describe('loadCorpusJsonl', () => {
  it('batches by size and reports cumulative progress', async () => {
    const file = jsonlFile([record('A'), record('B'), record('C'), record('D'), record('E')]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const seen: number[] = [];

    const result = await loadCorpusJsonl(file, CREDS, {
      batchSize: 2,
      onProgress: (n) => seen.push(n),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ rows: 5, batches: 3, skipped: 0 });
    expect(seen).toEqual([2, 4, 5]);
  });

  it('projects each record before sending it', async () => {
    const file = jsonlFile([record('DHHGAGE')]);
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 201 });
    });

    await loadCorpusJsonl(file, CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    // Column names, not TypeScript property names — the whole point of the projection step.
    expect(bodies[0]).toMatchObject([
      { name: 'DHHGAGE', survey_group: 'S', code_count: 0, search_text: expect.stringContaining('DHHGAGE') },
    ]);
  });

  it('skips blank lines rather than sending an empty row', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'corpus-load-'));
    dirs.push(dir);
    const file = path.join(dir, 'corpus.jsonl');
    writeFileSync(file, `${JSON.stringify(record('A'))}\n\n${JSON.stringify(record('B'))}\n\n`);

    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const result = await loadCorpusJsonl(file, CREDS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.rows).toBe(2);
  });
});

describe('dedupe', () => {
  it('is off by default — an occurrence is a fact about a document (D3)', async () => {
    const twice = [record('A'), record('A')];
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const result = await loadCorpusJsonl(jsonlFile(twice), CREDS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ rows: 2, skipped: 0 });
  });

  it('keeps one row per distinct fact when asked', async () => {
    const a = record('A');
    // Same fact, different document — which is what the delivery's repeated dictionaries look like.
    const repeat = { ...a, recordId: 'other-id', source: { ...a.source, path: 'S/reissue.pdf' } };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await loadCorpusJsonl(jsonlFile([a, repeat, record('B')]), CREDS, {
      dedupe: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ rows: 2, skipped: 1 });
  });

  it('does not collapse records that differ in what they say', async () => {
    const a = record('A');
    const changed = { ...a, recordId: 'x', questionText: 'A different wording' };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await loadCorpusJsonl(jsonlFile([a, changed]), CREDS, {
      dedupe: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ rows: 2, skipped: 0 });
  });
});

describe('factKey', () => {
  it('ignores which document stated the fact', () => {
    const a = toCorpusRow(record('A'));
    expect(factKey({ ...a, path: 'other.pdf', page: 99, bundle: 'z.zip' })).toBe(factKey(a));
  });

  it('keeps frequencies out of the key, so two cycles of one question stay distinct facts', () => {
    // Identical categories with different counts are different findings, and the counts are the
    // only thing separating them — but they belong to different *cycles*, which the year already
    // separates. Including frequencies would make a rounding change look like a new variable.
    const base = toCorpusRow(record('A'));
    const withCodes = { ...base, code_count: 1, codes: [{ c: '1', l: 'Yes', f: 10 }] };
    const otherFreq = { ...base, code_count: 1, codes: [{ c: '1', l: 'Yes', f: 20 }] };
    expect(factKey(withCodes)).toBe(factKey(otherFreq));
  });

  it('separates records whose category labels differ', () => {
    const base = toCorpusRow(record('A'));
    const yes = { ...base, code_count: 1, codes: [{ c: '1', l: 'Yes' }] };
    const oui = { ...base, code_count: 1, codes: [{ c: '1', l: 'Oui' }] };
    expect(factKey(yes)).not.toBe(factKey(oui));
  });
});

describe('limit', () => {
  it('stops after N rows so a real table can be measured before a full load', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const file = jsonlFile(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(record));

    const result = await loadCorpusJsonl(file, CREDS, {
      batchSize: 2,
      limit: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.rows).toBe(4);
  });

  it('loads everything when no limit is given', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const result = await loadCorpusJsonl(jsonlFile(['A', 'B', 'C'].map(record)), CREDS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.rows).toBe(3);
  });
});

describe('parseEnvFile', () => {
  it('skips comments and blanks, and splits on the first = only', () => {
    // A JWT contains no "=", but a base64 secret can end in padding — splitting on every "=" would
    // truncate the key and produce an authentication failure that looks like a wrong key.
    const env = parseEnvFile('# comment\n\nA=1\nKEY=abc=def==\n  B = two \n');
    expect(env).toEqual({ A: '1', KEY: 'abc=def==', B: 'two' });
  });

  it('strips one pair of surrounding quotes, because pasted keys sometimes arrive wrapped', () => {
    expect(parseEnvFile('K="quoted"\nJ=\'single\'\nL=un"quoted"')).toEqual({
      K: 'quoted',
      J: 'single',
      L: 'un"quoted"',
    });
  });

  it('ignores a line with no assignment rather than inventing an empty key', () => {
    expect(parseEnvFile('nonsense\n=novalue\n')).toEqual({});
  });
});

describe('envWithFile', () => {
  it('lets a real environment variable win over the file', () => {
    // So `SUPABASE_URL=… pnpm corpus:load` can redirect a load without anyone having to remember
    // that a file on disk is also in play.
    const dir = mkdtempSync(path.join(tmpdir(), 'corpus-env-'));
    dirs.push(dir);
    const file = path.join(dir, '.env.local');
    writeFileSync(file, 'SUPABASE_URL=https://from-file.supabase.co\nOTHER=file\n');

    const merged = envWithFile(file, { SUPABASE_URL: 'https://from-shell.supabase.co' });
    expect(merged.SUPABASE_URL).toBe('https://from-shell.supabase.co');
    expect(merged.OTHER).toBe('file');
  });

  it('returns the environment untouched when there is no file', () => {
    const env = { A: '1' };
    expect(envWithFile(path.join(tmpdir(), 'definitely-absent-corpus-env'), env)).toBe(env);
  });
});
