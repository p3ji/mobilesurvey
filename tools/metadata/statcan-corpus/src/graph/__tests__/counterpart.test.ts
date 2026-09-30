import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDocType,
  subpopulationSignature,
  scanCounterpartPairs,
  resolveCounterpartPairs,
  dedupeResolvedCounterpartEdges,
  renderCounterpartSql,
  counterpartEdgeId,
  counterpartEdgeToRow,
  existingCounterpartPairs,
  importCounterpartEdges,
  COUNTERPART_CONFIDENCE,
  type CounterpartPair,
  type ResolvedCounterpartEdge,
} from '../counterpart.js';

describe('classifyDocType', () => {
  it('classifies master/RDC codebooks by filename markers', () => {
    expect(classifyDocType('CIS_ECR_2022/CIS 2022 - no freqs_E.pdf')).toBe('master');
    expect(classifyDocType('LISA_ELIA_2012/LISACdbk nofreqcounts_E.pdf')).toBe('master');
    expect(classifyDocType('CNICS_ECVNE_2011/CNICS2011_NoCounts_CdBk_E.pdf')).toBe('master');
    expect(classifyDocType('GSS_ESG_12-32/15/GSS-15 ANALYTICAL_NoFreqs.pdf')).toBe('master');
  });

  it('classifies PUMF data dictionaries by T-code or filename', () => {
    expect(classifyDocType('CIS_ECR_2022/cis_2022_T15_2_f1_v2.pdf')).toBe('pumf');
    expect(classifyDocType('LISA_ELIA_2012/LISA_2012_F1_T15.2_v2.pdf', 'T15.2')).toBe('pumf');
    // T-code wins even when the filename looks analytical:
    expect(classifyDocType('GSS_ESG_12-32/17/SDDS5024_GSS_ESG_C17_ANALM_T15.2_D1_eng.pdf', 'T15.2')).toBe('pumf');
  });

  it('classifies everything else as analytical', () => {
    expect(classifyDocType('CCHS_ESCC/CCHS_ESCC_2019/CCHS 2019 Data Dictionary (rounded frequencies).pdf')).toBe(
      'analytical',
    );
    expect(classifyDocType('IMDB_BDIM/2023/IMDB_imm_dictionary_appen_2023.pdf')).toBe('analytical');
  });

  it('lets master markers win over PUMF markers', () => {
    // A hypothetical "master T15.2" file is still a master codebook.
    expect(classifyDocType('X/master_T15_2_v1.pdf')).toBe('master');
  });
});

describe('subpopulationSignature', () => {
  it('detects plus and disability subpopulations from filename tokens', () => {
    expect(subpopulationSignature('CIS_ECR_2022/cis_2022_T15_2_f1_v2.pdf')).toEqual({ plus: false, dis: false });
    expect(subpopulationSignature('CIS_ECR_2022/cis_2022_plus_T15_2_f1_v2.pdf')).toEqual({ plus: true, dis: false });
    expect(subpopulationSignature('CIS_ECR_2022/cis_2022_d_T15_2_f1_v2.pdf')).toEqual({ plus: false, dis: true });
    expect(subpopulationSignature('CIS_ECR_2022/Disability CIS 2022 - no freqs_E.pdf')).toEqual({ plus: false, dis: true });
    expect(subpopulationSignature('CIS_ECR_2022/CIS-Plus 2022 - no freqs_E.pdf')).toEqual({ plus: true, dis: false });
    expect(subpopulationSignature('CIS_ECR_2022/Disability CIS-Plus 2022 - no freqs_E.pdf')).toEqual({
      plus: true,
      dis: true,
    });
  });
});

describe('scanCounterpartPairs', () => {
  const writeCorpus = (lines: string[]) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'counterpart-test-'));
    const p = path.join(tmpDir, `counterpart_${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };

  const rec = (name: string, path: string, cycle: string | null, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      name,
      codes: [],
      recordId: '00000000-0000-4000-8000-' + name.toLowerCase().padEnd(12, '0'),
      source: { bundle: 'b.zip', path, page: 1, surveyGroup: 'TEST_SURVEY', cycle, year: 2020, lang: 'en', ...extra },
    });

  it('links same-name variables between a PUMF doc and its master codebook in one cycle', async () => {
    const p = writeCorpus([
      rec('AGE', 'TEST_SURVEY/test_T15_2_v1.pdf', '2020'),
      rec('INCOME', 'TEST_SURVEY/test_T15_2_v1.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/Test master codebook no freqs_E.pdf', '2020'),
      // INCOME is absent from the master doc -> no edge for it.
    ]);
    const { pairs, withheldAmbiguousNames } = await scanCounterpartPairs(p);
    expect(withheldAmbiguousNames).toBe(0);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      surveyGroup: 'TEST_SURVEY',
      cycle: '2020',
      name: 'AGE',
      targetDocPath: 'TEST_SURVEY/test_T15_2_v1.pdf',
      sourceDocPath: 'TEST_SURVEY/Test master codebook no freqs_E.pdf',
      matchKind: 'exact',
    });
    expect(pairs[0]?.confidence).toBe(COUNTERPART_CONFIDENCE.exact);
  });

  it('matches subpopulation PUMF docs to their subpopulation master, falling back to the base master', async () => {
    const p = writeCorpus([
      rec('X1', 'TEST_SURVEY/base_T15_2_v1.pdf', '2020'),
      rec('X2', 'TEST_SURVEY/plus_T15_2_v1.pdf', '2020'),
      rec('X3', 'TEST_SURVEY/disability_T15_2_v1.pdf', '2020'),
      rec('X1', 'TEST_SURVEY/base master no freqs_E.pdf', '2020'),
      rec('X2', 'TEST_SURVEY/plus master no freqs_E.pdf', '2020'),
      // No disability master exists -> X3 falls back to the base master.
      rec('X3', 'TEST_SURVEY/base master no freqs_E.pdf', '2020'),
    ]);
    const { pairs } = await scanCounterpartPairs(p);
    const byName = new Map(pairs.map((x) => [x.name, x]));
    expect(byName.get('X1')?.sourceDocPath).toBe('TEST_SURVEY/base master no freqs_E.pdf');
    expect(byName.get('X2')?.matchKind).toBe('exact');
    expect(byName.get('X3')?.matchKind).toBe('fallback');
    expect(byName.get('X3')?.confidence).toBe(COUNTERPART_CONFIDENCE.fallback);
  });

  it('withholds names present in more than one master doc', async () => {
    const p = writeCorpus([
      rec('AGE', 'TEST_SURVEY/test_T15_2_v1.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/master A no freqs_E.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/plus master no freqs_E.pdf', '2020'),
    ]);
    const { pairs, withheldAmbiguousNames } = await scanCounterpartPairs(p);
    expect(pairs).toHaveLength(0);
    expect(withheldAmbiguousNames).toBeGreaterThan(0);
  });

  it('emits one edge per PUMF document sharing the name (distinct targets)', async () => {
    const p = writeCorpus([
      rec('AGE', 'TEST_SURVEY/doc1_T15_2_v1.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/doc2_T15_2_v1.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/master no freqs_E.pdf', '2020'),
    ]);
    const { pairs } = await scanCounterpartPairs(p);
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map((x) => x.targetDocPath)).size).toBe(2);
  });

  it('ignores rebased records without a cycle and FR occurrences', async () => {
    const p = writeCorpus([
      rec('AGE', 'TEST_SURVEY/test_T15_2_v1.pdf', null),
      rec('AGE', 'TEST_SURVEY/master no freqs_E.pdf', null),
      JSON.stringify({
        name: 'AGE_FR',
        codes: [],
        recordId: '00000000-0000-4000-8000-000000000001',
        source: { bundle: 'b.zip', path: 'TEST_SURVEY/test_T15_2_v1.pdf', page: 1, surveyGroup: 'TEST_SURVEY', cycle: '2020', year: 2020, lang: 'fr' },
      }),
    ]);
    const { pairs } = await scanCounterpartPairs(p);
    expect(pairs).toHaveLength(0);
  });

  it('does not link across cycles or survey groups', async () => {
    const p = writeCorpus([
      rec('AGE', 'TEST_SURVEY/test_T15_2_v1.pdf', '2020'),
      rec('AGE', 'TEST_SURVEY/master no freqs_E.pdf', '2021'), // different cycle
    ]);
    const { pairs } = await scanCounterpartPairs(p);
    expect(pairs).toHaveLength(0);
  });
});

describe('resolveCounterpartPairs', () => {
  const pair: CounterpartPair = {
    surveyGroup: 'TEST_SURVEY',
    cycle: '2020',
    targetDocPath: 'TEST_SURVEY/test_T15_2_v1.pdf',
    sourceDocPath: 'TEST_SURVEY/master no freqs_E.pdf',
    name: 'AGE',
    matchKind: 'exact',
    confidence: 0.95,
    evidence: 'e',
  };

  it('resolves both sides by (survey_group, path, name) and prefers the matching cycle row', async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.includes(encodeURIComponent('test_T15_2_v1.pdf'))) {
        return new Response(JSON.stringify([{ record_id: 't-1', cycle: null }, { record_id: 't-2', cycle: '2020' }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ record_id: 's-1', cycle: '2020' }]), { status: 200 });
    }) as typeof fetch;

    const { edges, unresolved } = await resolveCounterpartPairs([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);
    expect(unresolved).toBe(0);
    expect(edges[0]).toMatchObject({ targetRecordId: 't-2', sourceRecordId: 's-1' }); // cycle-matching row preferred
  });

  it('drops pairs whose either side is absent from live (no dangling IDs)', async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.includes(encodeURIComponent('test_T15_2_v1.pdf'))) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify([{ record_id: 's-1', cycle: '2020' }]), { status: 200 });
    }) as typeof fetch;

    const { edges, unresolved } = await resolveCounterpartPairs([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);
    expect(edges).toHaveLength(0);
    expect(unresolved).toBe(1);
  });

  it('fails loudly on HTTP errors', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(resolveCounterpartPairs([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl)).rejects.toThrow(
      /live lookup failed/i,
    );
  });
});

describe('dedupeResolvedCounterpartEdges', () => {
  const base = (name: string, targetRecordId: string): ResolvedCounterpartEdge => ({
    surveyGroup: 'TEST_SURVEY',
    cycle: '2020',
    targetDocPath: 'TEST_SURVEY/doc_T15_2_v1.pdf',
    sourceDocPath: 'TEST_SURVEY/master no freqs_E.pdf',
    name,
    matchKind: 'exact',
    confidence: 0.95,
    evidence: 'e',
    targetRecordId,
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
  });

  it('collapses pairs that resolve to the same unique-index key (live factKey dedupe)', () => {
    const { edges, collapsedDuplicates } = dedupeResolvedCounterpartEdges([
      base('AGE', 't-1'), // from PUMF doc A
      base('age ', 't-1'), // identical live row reached via PUMF doc B (name case/padding normalized)
      base('SEG', 't-1'), // different name -> kept
      base('AGE', 't-2'), // different target record -> kept
    ]);
    expect(collapsedDuplicates).toBe(1);
    expect(edges.map((e) => `${e.targetRecordId}|${e.name}`)).toEqual(['t-1|AGE', 't-1|SEG', 't-2|AGE']);
  });

  it('keeps all edges when keys are distinct', () => {
    const { edges, collapsedDuplicates } = dedupeResolvedCounterpartEdges([base('A', 't-1'), base('B', 't-2')]);
    expect(collapsedDuplicates).toBe(0);
    expect(edges).toHaveLength(2);
  });
});

describe('renderCounterpartSql', () => {
  const edge: ResolvedCounterpartEdge = {
    ...({} as CounterpartPair),
    surveyGroup: 'TEST_SURVEY',
    cycle: '2020',
    targetDocPath: 'TEST_SURVEY/test_T15_2_v1.pdf',
    sourceDocPath: 'TEST_SURVEY/master no freqs_E.pdf',
    name: "AGE'S", // quote in the name must be escaped
    matchKind: 'exact',
    confidence: 0.95,
    evidence: 'Same variable name',
    targetRecordId: '11111111-1111-4111-8111-111111111111',
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
  };

  it('renders an idempotent migration with the counterpart derivation type', () => {
    const sql = renderCounterpartSql([edge]);
    expect(sql).toContain("insert into corpus_derivation_edge");
    expect(sql).toContain("'counterpart'"); // derivation_type
    expect(sql).toContain("'deterministic_cross_doc_rule'"); // extraction_method
    expect(sql).toContain("'verified'"); // review_status
    expect(sql).toContain("AGE''S"); // SQL-escaped name
    expect(sql).toContain('on conflict (target_record_id, (upper(btrim(source_var_name)))) do nothing');
    expect(sql.startsWith('-- Deterministic cross-document')).toBe(true);
  });

  it('chunks inserts at 500 rows', () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ ...edge, name: `V${i}` }));
    const sql = renderCounterpartSql(many);
    expect(sql.match(/insert into corpus_derivation_edge/g)?.length).toBe(3);
  });
});

describe('counterpartEdgeId / counterpartEdgeToRow', () => {
  const edge: ResolvedCounterpartEdge = {
    surveyGroup: 'TEST_SURVEY',
    cycle: '2020',
    targetDocPath: 'TEST_SURVEY/test_T15_2_v1.pdf',
    sourceDocPath: 'TEST_SURVEY/master no freqs_E.pdf',
    name: 'AGE',
    matchKind: 'exact',
    confidence: 0.95,
    evidence: 'e',
    targetRecordId: '11111111-1111-4111-8111-111111111111',
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
  };

  it('is deterministic and stable across calls', () => {
    expect(counterpartEdgeId(edge)).toBe(counterpartEdgeId({ ...edge }));
    expect(counterpartEdgeId(edge)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('differs from the grouped-collapse id for the same record pair (different derivation type)', () => {
    // The namespace string includes 'counterpart' vs 'grouped-collapse', so ids must not collide.
    expect(counterpartEdgeId(edge)).not.toBe(
      counterpartEdgeId({ ...edge, targetRecordId: edge.sourceRecordId, sourceRecordId: edge.targetRecordId }),
    );
  });

  it('maps to a REST row mirroring the SQL export', () => {
    const row = counterpartEdgeToRow(edge);
    expect(row).toMatchObject({
      edge_id: counterpartEdgeId(edge),
      target_record_id: '11111111-1111-4111-8111-111111111111',
      source_record_id: '22222222-2222-4222-8222-222222222222',
      source_var_name: 'AGE',
      derivation_type: 'counterpart',
      review_status: 'verified',
      extraction_method: 'deterministic_cross_doc_rule',
    });
    expect(row.statcan_citation).toMatchObject({ doc: edge.targetDocPath, counterpart_doc: edge.sourceDocPath });
  });
});

describe('existingCounterpartPairs', () => {
  it('chunks target ids by 500 and normalizes source names to the unique-index key', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify([
          { target_record_id: 't-1', source_var_name: ' age ' }, // lowercase + padded -> AGE
          { target_record_id: 't-2', source_var_name: 'DAGEYRS' },
        ]),
        { status: 200 },
      );
    }) as typeof fetch;

    const ids = Array.from({ length: 601 }, (_, i) => `t-${i}`);
    const set = await existingCounterpartPairs(ids, { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);

    expect(calls.length).toBe(2); // 500 + 101
    expect(set.has('t-1|AGE')).toBe(true);
    expect(set.has('t-2|DAGEYRS')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('fails loudly on HTTP errors', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(existingCounterpartPairs(['t-1'], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl)).rejects.toThrow(
      /prefilter failed/i,
    );
  });
});

describe('importCounterpartEdges', () => {
  const edge: ResolvedCounterpartEdge = {
    surveyGroup: 'TEST_SURVEY',
    cycle: '2020',
    targetDocPath: 'TEST_SURVEY/test_T15_2_v1.pdf',
    sourceDocPath: 'TEST_SURVEY/master no freqs_E.pdf',
    name: 'AGE',
    matchKind: 'exact',
    confidence: 0.95,
    evidence: 'e',
    targetRecordId: '11111111-1111-4111-8111-111111111111',
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
  };

  it('upserts in batches of 250 with on_conflict=edge_id and merge-duplicates', async () => {
    const calls: Array<{ url: string; body: unknown[] }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const many = Array.from({ length: 600 }, (_, i) => ({ ...edge, name: `V${i}` }));
    const { written } = await importCounterpartEdges(many, { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);

    expect(written).toBe(600);
    expect(calls.length).toBe(3); // 250 + 250 + 100
    for (const c of calls) {
      expect(c.url).toContain('/rest/v1/corpus_derivation_edge?on_conflict=edge_id');
    }
    expect((calls[0]?.body[0] as Record<string, unknown>).edge_id).toBe(counterpartEdgeId(many[0]!));
  });

  it('skips logical pairs already live (other unique index) and reports them', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const skipExisting = new Set([`${edge.targetRecordId}|AGE`]);
    const other = { ...edge, name: 'SEG' };
    const { written, skippedExisting } = await importCounterpartEdges(
      [edge, other],
      { url: 'https://x.supabase.co', serviceRoleKey: 'k' },
      fetchImpl,
      skipExisting,
    );

    expect(written).toBe(1);
    expect(skippedExisting).toBe(1);
    expect(calls.length).toBe(1); // one batch, only the non-colliding row
  });

  it('fails loudly on HTTP errors', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(importCounterpartEdges([edge], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl)).rejects.toThrow(
      /counterpart import failed/i,
    );
  });
});
