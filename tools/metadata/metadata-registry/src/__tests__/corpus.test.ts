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
  isHarmonizedContent,
  isProcessVariable,
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
  it('preserves semantic candidate order and scores after unordered hydration', async () => {
    const first = row({ record_id: '11111111-1111-5111-8111-111111111111', name: 'BEST' });
    const second = row({ record_id: '22222222-2222-5222-8222-222222222222', name: 'NEXT' });
    const fetchImpl = stubFetch([second, first]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    const hits = await source.fetchRecords([
      { recordId: first.record_id, score: 0.83 },
      { recordId: second.record_id, score: 0.71 },
      { recordId: '33333333-3333-5333-8333-333333333333', score: 0.6 },
    ]);
    expect(hits.map((hit) => [hit.entry.corpus?.variableName, hit.score])).toEqual([
      ['BEST', 0.83], ['NEXT', 0.71],
    ]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_get_variables');
    expect(JSON.parse(init.body as string).p_record_ids).toEqual([
      first.record_id, second.record_id, '33333333-3333-5333-8333-333333333333',
    ]);
  });

  it('uses the two-term fallback only for plain multiword zero-hit queries', async () => {
    const fetchImpl = stubFetch([row({ name: 'HRLYEARN', concept: 'Usual hourly earnings', total_count: 12 })]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    const result = await source.searchRelaxed('hourly wage usual earnings', { role: 'collected', limit: 25 });
    expect(result.hits[0]?.entry.corpus?.variableName).toBe('HRLYEARN');
    expect(result.total).toBe(12);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search_relaxed');
    expect(JSON.parse(init.body as string)).toMatchObject({
      q: 'hourly wage usual earnings', role_filter: 'collected', max_rows: 25,
    });
    expect(await source.searchRelaxed('GEO_PRV')).toEqual({ hits: [], total: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps AI phrase results in one deduplicated, pageable subject-aware search', async () => {
    const fetchImpl = stubFetch([row({ total_count: 3, name: 'DSH_10F', concept: 'Harassment - Online' })]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    const result = await source.searchAi(['online harassment', 'digital safety'], {
      subject: 'Crime and justice', limit: 25, offset: 25,
    });
    expect(result.total).toBe(3);
    expect(result.hits.map((hit) => hit.entry.corpus?.variableName)).toEqual(['DSH_10F']);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search_ai');
    expect(JSON.parse(init.body as string)).toMatchObject({
      search_terms: ['online harassment', 'digital safety'],
      subject_filter: 'Crime and justice',
      max_rows: 25,
      row_offset: 25,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps verified graph targets for both derived variables and their inputs', async () => {
    const fetchImpl = stubFetch([
      { root_record_id: 'dv-1', record_id: 'dv-1', name: 'BMI', label: 'Body mass index',
        survey_acronym: 'CCHS', cycle: '2019', year: 2019, input_count: 2 },
      { root_record_id: 'height-1', record_id: 'dv-1', name: 'BMI', label: 'Body mass index',
        survey_acronym: 'CCHS', cycle: '2019', year: 2019, input_count: 2 },
      { root_record_id: 'height-1', record_id: 'dv-2', name: 'BMR', label: 'Basal metabolic rate',
        survey_acronym: 'CCHS', cycle: '2019', year: 2019, input_count: 3 },
    ]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    const connected = await source.variableGraphTargets(['dv-1', 'height-1']);
    expect(connected.get('dv-1')?.[0]?.recordId).toBe('dv-1');
    expect(connected.get('height-1')?.map((target) => target.name)).toEqual(['BMI', 'BMR']);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_get_variable_graph_targets');
    expect(JSON.parse(init.body as string)).toEqual({ p_record_ids: ['dv-1', 'height-1'] });
    expect(await source.variableGraphTargets([])).toEqual(new Map());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves a variable to its exact concept without relying on a text search', async () => {
    const memberships = stubFetch([{ record_id: 'record-1', conceptual_variable_id: 'cv-1' }]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl: memberships });
    expect(await source.clustersOf(['record-1', 'record-2'])).toEqual(new Map([['record-1', 'cv-1']]));
    const [rpcUrl, rpcInit] = (memberships as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(rpcUrl).toBe('https://p.supabase.co/rest/v1/rpc/corpus_cluster_of');
    expect(JSON.parse(rpcInit.body as string)).toEqual({ record_ids: ['record-1', 'record-2'] });
    expect(await source.clustersOf([])).toEqual(new Map());
    expect(memberships).toHaveBeenCalledTimes(1);

    const lookup = stubFetch([{
      conceptual_variable_id: 'cv-1', concept_id: 'c-1', label: 'Smoking status',
      universe: 'Adults', occurrences: 8, surveys: 2, representations: 2,
      years: 4, year_min: 2001, year_max: 2023,
    }]);
    const lookupSource = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl: lookup });
    expect(await lookupSource.conceptualVariable('cv-1')).toMatchObject({
      conceptualVariableId: 'cv-1', conceptId: 'c-1', label: 'Smoking status', years: 4,
    });
    const [getUrl, getInit] = (lookup as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(getUrl).toContain('/rest/v1/corpus_conceptual_variable?');
    expect(new URL(getUrl).searchParams.get('conceptual_variable_id')).toBe('eq.cv-1');
    expect(getInit.method).toBeUndefined();
  });

  it('pages linked targets using the database total and edge count', async () => {
    const fetchImpl = stubFetch([{
      record_id: 'target-1', name: 'BMI', label: 'Body mass index',
      survey_acronym: 'CCHS', cycle: '2019', year: 2019,
      input_count: 3, total_count: 340, edge_count: 1183,
    }]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.lineageTargets(' bmi ', 20, 40)).toEqual({
      targets: [{ recordId: 'target-1', name: 'BMI', label: 'Body mass index',
        surveyAcronym: 'CCHS', cycle: '2019', year: 2019, inputCount: 3 }],
      total: 340,
      edges: 1183,
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_list_lineage_targets');
    expect(JSON.parse(init.body as string)).toEqual({ p_query: 'bmi', p_limit: 20, p_offset: 40 });
  });

  it('maps recursive lineage with depth and source labels', async () => {
    const fetchImpl = stubFetch([{
      edge_id: 'edge-1', target_record_id: 'target-1', target_name: 'BMI',
      source_record_id: 'source-1', source_var_name: 'HEIGHT', source_label: 'Height in metres',
      data_authority: 'ai_inferred', derivation_type: 'formula',
      ai_expression_summary: 'BMI = kg / m²', statcan_verbatim_note: 'Based on height and weight.', depth: 2,
    }]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.lineageGraph('target-1')).toEqual([{
      edgeId: 'edge-1', targetRecordId: 'target-1', targetName: 'BMI',
      sourceRecordId: 'source-1', sourceVarName: 'HEIGHT', sourceLabel: 'Height in metres',
      dataAuthority: 'ai_inferred', derivationType: 'formula',
      expressionSummary: 'BMI = kg / m²', statcanNote: 'Based on height and weight.', depth: 2,
    }]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_get_lineage_graph');
    expect(JSON.parse(init.body as string)).toEqual({ p_root_record_id: 'target-1', p_max_depth: 4 });
  });

  it('loads published direct inputs for a results page in one RPC', async () => {
    const fetchImpl = stubFetch([{
      edge_id: 'edge-1', target_record_id: 'target-1', source_record_id: 'source-1',
      source_var_name: 'HEIGHT', data_authority: 'ai_inferred', derivation_type: 'formula',
      ai_expression_summary: 'BMI from height and weight', statcan_verbatim_note: 'Derived from HEIGHT.',
    }]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.directInputs(['target-1', 'target-2'])).toEqual([{
      edgeId: 'edge-1', targetRecordId: 'target-1', sourceRecordId: 'source-1',
      sourceVarName: 'HEIGHT', dataAuthority: 'ai_inferred', derivationType: 'formula',
      expressionSummary: 'BMI from height and weight', statcanNote: 'Derived from HEIGHT.',
    }]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_get_direct_inputs');
    expect(JSON.parse(init.body as string)).toEqual({ p_target_record_ids: ['target-1', 'target-2'] });
    expect(await source.directInputs([])).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search_sorted');
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'smoking',
      lang_filter: 'fr',
      survey_filter: null,
      year_min: 2001,
      year_max: null,
      require_codes: true,
      max_rows: 10,
      row_offset: 0,
      subject_filter: null,
      role_filter: null,
      hide_process: false,
      sort_mode: 'relevance',
    });
  });

  it('passes role and hideProcess filters to RPC before pagination', async () => {
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co/',
      anonKey: 'anon',
      fetchImpl,
    });

    await source.search('mental health', { role: 'derived', hideProcess: true, limit: 25 });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search_sorted');
    expect(JSON.parse(init.body as string)).toMatchObject({
      q: 'mental health',
      role_filter: 'derived',
      hide_process: true,
      sort_mode: 'relevance',
      max_rows: 25,
    });
  });

  it('does not call the server for an empty query', async () => {
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.search('   ')).toEqual({ hits: [], total: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requests database-wide newest-first ordering before pagination', async () => {
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    await source.search('education', { sort: 'recent', limit: 25, offset: 25 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_search_sorted');
    expect(JSON.parse(init.body as string)).toMatchObject({ q: 'education', sort_mode: 'recent', max_rows: 25, row_offset: 25 });
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

  it('maps the published-link progress RPC for the About page', async () => {
    const fetchImpl = stubFetch([{ verified_links: 6080, linked_programs: 21 }]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.aboutProgress()).toEqual({ verifiedLinks: 6080, linkedPrograms: 21 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/corpus_about_progress');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('falls back to the readable edge table while the progress RPC is absent', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rpc/')) return new Response('missing', { status: 404 });
      return new Response(JSON.stringify([
        { survey_group: 'CCHS_ESCC_2019' },
        { survey_group: 'CIUS_2022' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Range': '0-1/2' },
      });
    }) as unknown as typeof fetch;
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    expect(await source.aboutProgress()).toEqual({ verifiedLinks: 2, linkedPrograms: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('survives an empty stats result rather than throwing on an unloaded corpus', async () => {
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([]),
    });
    expect(await source.stats()).toMatchObject({ variables: 0, yearMin: null });
  });

  describe('recentBySubject', () => {
    it('targets domain keywords and suppresses negative terms for Housing', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('corpus_survey_subject')) {
          return new Response(JSON.stringify([{ survey_group: 'CHS_ECL' }]), { status: 200 });
        }
        if (url.includes('corpus_survey_counts')) {
          return new Response(JSON.stringify([{ survey_group: 'CHS_ECL', year_max: 2022 }]), { status: 200 });
        }
        if (url.includes('corpus_variable')) {
          return new Response(
            JSON.stringify([
              row({ record_id: 'r1', name: 'DCT_05', concept: 'Tenure', question_text: 'Is this dwelling owned?' }),
              row({ record_id: 'r2', name: 'EDDVH3', concept: 'Highest level of education in household', question_text: null }),
            ]),
            { status: 200 },
          );
        }
        return new Response('[]', { status: 200 });
      }) as unknown as typeof fetch;

      const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
      const hits = await source.recentBySubject('Housing', 5);

      expect(hits.length).toBe(1);
      expect((hits[0]!.entry.payload as CorpusSearchRow).name).toBe('DCT_05');
    });

    it('returns empty array when no surveys are assigned to the subject', async () => {
      const fetchImpl = stubFetch([]);
      const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
      const hits = await source.recentBySubject('Nonexistent Subject', 5);
      expect(hits).toEqual([]);
    });
  });
});

describe('subject facet', () => {
  it('passes a chosen subject through to the search', () => {
    // Subject is a property of a survey, not of a record, so the filter is resolved server-side
    // against the mapping table rather than by narrowing what the client already has.
    const fetchImpl = stubFetch([]);
    const source = new SupabaseCorpusSource({ url: 'https://p.supabase.co', anonKey: 'a', fetchImpl });
    return source.search('smoking', { subject: 'Health' }).then(() => {
      const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(JSON.parse(init.body as string).subject_filter).toBe('Health');
    });
  });

  it('maps the facet out of its SQL column names', async () => {
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([{ subject: 'Health', variables: 37852, surveys: 22, confirmed: 0 }]),
    });
    expect(await source.subjects()).toEqual([
      { subject: 'Health', variables: 37852, surveys: 22, confirmed: 0 },
    ]);
  });

  it('reports what the facet cannot reach', async () => {
    // A facet list that silently omitted a third of the corpus would read as a complete index.
    const source = new SupabaseCorpusSource({
      url: 'https://p.supabase.co',
      anonKey: 'a',
      fetchImpl: stubFetch([
        { variables: 58719, surveys: 91, total_variables: 194507, total_surveys: 186 },
      ]),
    });
    expect(await source.unclassified()).toEqual({
      variables: 58719,
      surveys: 91,
      totalVariables: 194507,
      totalSurveys: 186,
    });
  });
});

describe('isHarmonizedContent', () => {
  it('detects age and date of birth variables', () => {
    expect(isHarmonizedContent({ name: 'AGE_01C', concept: 'Day of birth' })).toBe(true);
    expect(isHarmonizedContent({ name: 'DHHGAGE', concept: 'Age of respondent' })).toBe(true);
    expect(isHarmonizedContent({ name: 'DOB_Y', concept: 'Year of birth' })).toBe(true);
    expect(isHarmonizedContent({ name: 'AGE', concept: 'Age' })).toBe(true);
  });

  it('detects sex and gender variables', () => {
    expect(isHarmonizedContent({ name: 'SEX', concept: 'Sex at birth' })).toBe(true);
    expect(isHarmonizedContent({ name: 'DHH_SEX', concept: 'Sex of respondent' })).toBe(true);
    expect(isHarmonizedContent({ name: 'GENDER_1', concept: 'Gender' })).toBe(true);
  });

  it('detects marital status variables', () => {
    expect(isHarmonizedContent({ name: 'MS_01', concept: 'Marital status' })).toBe(true);
    expect(isHarmonizedContent({ name: 'MARSTAT', concept: 'Legal marital status' })).toBe(true);
  });

  it('detects geography and language variables', () => {
    expect(isHarmonizedContent({ name: 'GEO_PRV', concept: 'Province of residence' })).toBe(true);
    expect(isHarmonizedContent({ name: 'LAN_01', concept: 'Mother tongue' })).toBe(true);
  });

  it('does not classify substantive domain variables as harmonized content', () => {
    expect(isHarmonizedContent({ name: 'FSC_15', concept: 'Food security - worried food would run out' })).toBe(false);
    expect(isHarmonizedContent({ name: 'SMK_01', concept: 'Smoked cigarettes in past 30 days' })).toBe(false);
    expect(isHarmonizedContent({ name: 'ONL_SHOP', concept: 'Online shopping frequency' })).toBe(false);
    expect(isHarmonizedContent({ name: 'AGR_01', concept: 'Gross farm revenue' })).toBe(false);
  });
});

describe('isProcessVariable', () => {
  it('detects imputation flags by name and concept', () => {
    expect(isProcessVariable({ name: 'I150004', concept: 'Imputation flag' })).toBe(true);
    expect(isProcessVariable({ name: 'I010001', concept: 'Imputation flag' })).toBe(true);
    expect(isProcessVariable({ name: 'I200901', concept: null })).toBe(true);
    expect(isProcessVariable({ name: 'FLAG_IMP', concept: 'Imputation' })).toBe(true);
    expect(isProcessVariable({ name: 'C01_F', concept: 'Flag' })).toBe(true);
    expect(isProcessVariable({ name: 'VAL_01', concept: "Indicateur d'imputation" })).toBe(true);
  });

  it('detects sampling and bootstrap weights', () => {
    expect(isProcessVariable({ name: 'WTS_M', concept: 'Sampling weight' })).toBe(true);
    expect(isProcessVariable({ name: 'BSW_001', concept: 'Bootstrap replicate weight' })).toBe(true);
    expect(isProcessVariable({ name: 'WTBS_01', concept: 'Poids réplique' })).toBe(true);
    expect(isProcessVariable({ name: 'WTPM', concept: null })).toBe(true);
    expect(isProcessVariable({ name: 'FINALWT', concept: null })).toBe(true);
  });

  it('detects identifiers and collection paradata', () => {
    expect(isProcessVariable({ name: 'SAMPLEID', concept: 'Sample identifier' })).toBe(true);
    expect(isProcessVariable({ name: 'ADM_STATUS', concept: 'Interview status' })).toBe(true);
    expect(isProcessVariable({ name: 'ADM_040', survey_group: 'CCHS_ESCC' })).toBe(true);
    expect(isProcessVariable({ name: 'DOHWT', concept: 'Inclusion flag' })).toBe(true);
    expect(isProcessVariable({ name: 'FLAGRR', concept: 'Imputation flag for INC' })).toBe(true);
    expect(isProcessVariable({ name: 'PVTI01', question_text: 'Imputation Flag - Standard Score for PPVT-R' })).toBe(true);
    expect(isProcessVariable({ name: 'IMP100R', question_text: 'Flag indicating whether or not the value of SEX is imputed.' })).toBe(true);
    expect(isProcessVariable({ name: 'I101', concept: null })).toBe(true);
  });

  it('does not classify substantive survey questions as process variables', () => {
    expect(isProcessVariable({ name: 'C500104', concept: 'Q50' })).toBe(false);
    expect(isProcessVariable({ name: 'C010005', concept: 'Q1' })).toBe(false);
    expect(isProcessVariable({ name: 'ONL_SHOP', concept: 'Online shopping' })).toBe(false);
    expect(isProcessVariable({ name: 'FSC_15', concept: 'Food security' })).toBe(false);
    expect(isProcessVariable({ name: 'ADM_005A', concept: 'Physical aids - Use - Cane', survey_group: 'CSD_ECI_2017' })).toBe(false);
    expect(isProcessVariable({ name: 'MET_05', concept: 'Used or tried amphetamines or methamphetamine - ever' })).toBe(false);
    expect(isProcessVariable({ name: 'IMP_10', concept: 'In what year PMK first came to Canada to live' })).toBe(false);
    expect(isProcessVariable({ name: 'IMP_01B', concept: 'Place of birth of person - In Canada' })).toBe(false);
  });
});
