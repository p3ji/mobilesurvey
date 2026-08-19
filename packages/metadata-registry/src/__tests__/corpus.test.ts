/**
 * Corpus source tests. Two things are load-bearing here and neither is about search quality:
 * that every entry carries its licence obligations (D8), and that a corpus row lands in the exact
 * `RegistryEntry` shape the designer's Library panel already consumes (D6).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CORPUS_ATTRIBUTION,
  CORPUS_LICENSE,
  corpusCitation,
  SupabaseCorpusSource,
  toRegistryEntry,
  type CorpusSearchRow,
} from '../corpus.js';

function row(overrides: Partial<CorpusSearchRow> = {}): CorpusSearchRow {
  return {
    record_id: '11111111-1111-5111-8111-111111111111',
    name: 'DHHGAGE',
    position: '31',
    length: '2',
    concept: 'Age of respondent',
    question_text: 'What is your age?',
    universe: 'All respondents',
    note: null,
    codes: [{ c: '1', l: '12 to 14 years', f: 1200 }],
    code_count: 1,
    bundle: 'RDC Nonconfidential Documentation (1).zip',
    path: 'CCHS_ESCC_2014/cchs_2014_T15.6_eng.pdf',
    page: 42,
    tcode: 'T15.6',
    survey_group: 'CCHS_ESCC_2014',
    survey_acronym: 'CCHS',
    cycle: '2014',
    year: 2014,
    lang: 'en',
    rank: 0.42,
    total_count: 137,
    ...overrides,
  };
}

describe('corpusCitation', () => {
  it('names the survey, the year, the document and the page', () => {
    // All four are needed: the first two identify the source, the last two make an extraction
    // error traceable to a page and therefore fixable (D8).
    expect(corpusCitation(row())).toBe('CCHS · 2014 · cchs_2014_T15.6_eng.pdf · p. 42');
  });

  it('falls back to the cycle when there is no year, and to the group when there is no acronym', () => {
    expect(corpusCitation(row({ year: null, survey_acronym: null, cycle: 'Cycle 3' }))).toBe(
      'CCHS_ESCC_2014 · Cycle 3 · cchs_2014_T15.6_eng.pdf · p. 42',
    );
  });

  it('omits an unknown date rather than printing an empty separator', () => {
    expect(corpusCitation(row({ year: null, cycle: null }))).toBe(
      'CCHS · cchs_2014_T15.6_eng.pdf · p. 42',
    );
  });
});

describe('toRegistryEntry', () => {
  it('attaches the licence and the full attribution to every entry', () => {
    const entry = toRegistryEntry(row());
    expect(entry.registry.license).toBe(CORPUS_LICENSE);
    expect(entry.registry.usageRights).toBe(CORPUS_ATTRIBUTION);
    // All three obligations in the one string a UI cannot partially satisfy.
    expect(CORPUS_ATTRIBUTION).toMatch(/Statistics Canada/);
    expect(CORPUS_ATTRIBUTION).toMatch(/does not endorse/);
    expect(CORPUS_ATTRIBUTION).toMatch(/adaptation/i);
  });

  it('calls a row with question wording a question, and one without a variable', () => {
    // Not cosmetic: offering a derived variable as a reusable *question* is a small lie a designer
    // would only discover after inserting it into an instrument.
    expect(toRegistryEntry(row()).componentType).toBe('question');
    expect(toRegistryEntry(row({ question_text: null })).componentType).toBe('variable');
  });

  it('labels French rows under the fr key so the UI does not read them as English', () => {
    const entry = toRegistryEntry(row({ lang: 'fr', concept: 'Âge du répondant' }));
    expect(entry.ddi.label).toEqual({ fr: 'Âge du répondant' });
  });

  it('falls back through concept → question → name for the label', () => {
    expect(toRegistryEntry(row({ concept: null })).ddi.label).toEqual({ en: 'What is your age?' });
    expect(toRegistryEntry(row({ concept: null, question_text: null })).ddi.label).toEqual({
      en: 'DHHGAGE',
    });
  });

  it('omits absent optionals from the corpus block instead of setting them undefined', () => {
    const entry = toRegistryEntry(row({ note: null, cycle: null, tcode: null }));
    expect(Object.keys(entry.corpus!)).not.toContain('note');
    expect(Object.keys(entry.corpus!)).not.toContain('cycle');
    expect(Object.keys(entry.corpus!)).not.toContain('tcode');
  });

  it('tolerates a null codes column', () => {
    // `codes` is `not null` in the DDL, but a projection that only works against a well-formed
    // row is a projection that throws in the one case worth surviving.
    expect(toRegistryEntry(row({ codes: null, code_count: 0 })).corpus!.codes).toEqual([]);
  });

  it('reports usageCount as 0 — nothing "uses" a fact from a document', () => {
    expect(toRegistryEntry(row()).registry.usageCount).toBe(0);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * SupabaseCorpusSource
 * ---------------------------------------------------------------------------------------------- */

function stubFetch(payload: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('SupabaseCorpusSource', () => {
  it('passes filters through as RPC arguments, with null for "no filter"', async () => {
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co/',
      anonKey: 'anon',
      fetchImpl,
    });

    await source.search('smoking', { lang: 'fr', yearMin: 2001, hasCodes: true, limit: 10 });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search');
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'smoking',
      lang_filter: 'fr',
      survey_filter: null,
      year_min: 2001,
      year_max: null,
      require_codes: true,
      max_rows: 10,
      row_offset: 0,
    });
  });

  it('does not call the server for an empty query', async () => {
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.search('   ')).toEqual({ hits: [], total: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the total from the window function, not from the page length', async () => {
    // The page holds 1 row; there are 137 matches. Reporting `hits.length` would tell the user
    // their search found one result.
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([row()]),
    });
    const result = await source.search('age');
    expect(result.total).toBe(137);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.score).toBe(0.42);
  });

  it('reports no matched terms rather than guessing them', async () => {
    // The server ranked these and does not say which terms hit; a client-side reconstruction
    // would be a guess presented to the user as an explanation.
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([row()]),
    });
    expect((await source.search('age')).hits[0]!.matched).toEqual([]);
  });

  it('surfaces the server error body', async () => {
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch({ message: 'function corpus_search does not exist' }, 404),
    });
    await expect(source.search('age')).rejects.toThrow(/corpus_search does not exist/);
  });

  it('maps stats and surveys out of their SQL column names', async () => {
    const stats = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([
        { variables: 9, surveys: 2, documents: 3, year_min: 1981, year_max: 2026, with_codes: 4, with_question: 5 },
      ]),
    });
    expect(await stats.stats()).toEqual({
      variables: 9,
      surveys: 2,
      documents: 3,
      yearMin: 1981,
      yearMax: 2026,
      withCodes: 4,
      withQuestion: 5,
    });

    const surveys = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([
        { survey_group: 'CCHS_ESCC', survey_acronym: 'CCHS', variables: 5, documents: 2, year_min: 2001, year_max: 2024 },
      ]),
    });
    expect(await surveys.surveys()).toEqual([
      { surveyGroup: 'CCHS_ESCC', surveyAcronym: 'CCHS', variables: 5, documents: 2, yearMin: 2001, yearMax: 2024 },
    ]);
  });

  it('survives an empty stats result rather than throwing on an unloaded corpus', async () => {
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([]),
    });
    expect(await source.stats()).toMatchObject({ variables: 0, yearMin: null });
  });
});
