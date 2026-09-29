import { describe, it, expect } from 'vitest';
import {
  baseOfGroupedName,
  conceptOverlap,
  classifyGroupedEvidence,
  renderGroupedCollapseSql,
  resolveAgainstSupabase,
  groupedEdgeId,
  edgeToRow,
  existingLogicalPairs,
  importGroupedEdges,
  TIER_CONFIDENCE,
  type ResolvedGroupedEdge,
} from '../grouped.js';

describe('baseOfGroupedName', () => {
  it('strips the trailing G', () => {
    expect(baseOfGroupedName('AGEG')).toBe('AGE');
    expect(baseOfGroupedName('NPRCODEG')).toBe('NPRCODE');
    expect(baseOfGroupedName('H12BG')).toBe('H12B');
  });

  it('rejects names that are not G-suffix candidates', () => {
    expect(baseOfGroupedName('AGE')).toBeNull();
    expect(baseOfGroupedName('G')).toBeNull(); // too short: base would be empty
    expect(baseOfGroupedName('AG')).toBeNull();
    expect(baseOfGroupedName('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(baseOfGroupedName('ageg ')).toBe('AGE');
  });
});

describe('conceptOverlap', () => {
  it('measures shared tokens over the smaller set', () => {
    // "Person's age group as of December 31" vs "Age as of December 31 of reference year"
    expect(conceptOverlap("Person's age group as of December 31", 'Age as of December 31 of reference year')).toBeGreaterThan(0.5);
  });

  it('returns 0 when either side is empty', () => {
    expect(conceptOverlap('', 'Age as of December 31')).toBe(0);
    expect(conceptOverlap('Age group', '')).toBe(0);
  });

  it('is low for unrelated concepts', () => {
    expect(conceptOverlap('Sex at birth', 'Highest level of education attained')).toBeLessThan(0.5);
  });
});

describe('classifyGroupedEvidence', () => {
  const base = { targetConcept: '', targetNote: '', baseName: 'AGE', overlap: 0 };

  it('tier A: explicit grouped marker in the concept wins over everything', () => {
    expect(classifyGroupedEvidence({ ...base, targetConcept: 'NHS Province/territory of residence code - Grouped' })).toBe('A');
    expect(classifyGroupedEvidence({ ...base, targetConcept: 'Age (G)' })).toBe('A');
    expect(classifyGroupedEvidence({ ...base, targetConcept: "Variable d'âge groupée" })).toBe('A');
  });

  it('tier B: note cites the base variable verbatim', () => {
    expect(
      classifyGroupedEvidence({ ...base, targetNote: 'Derived based on AGE - age of child as of October 31.' }),
    ).toBe('B');
    // case-insensitive mention
    expect(classifyGroupedEvidence({ ...base, targetNote: 'derived from age, rounded down' })).toBe('B');
  });

  it('tier C: lexical gate needs overlap >= 0.5 AND a grouping word in the target text', () => {
    const concepts = { targetConcept: "Person's age group as of December 31", baseName: 'AGE' };
    expect(classifyGroupedEvidence({ ...base, ...concepts, overlap: 0.7 })).toBe('C');
    // grouping word present but overlap too low -> withheld
    expect(classifyGroupedEvidence({ ...base, targetConcept: 'Age group', overlap: 0.3 })).toBeNull();
    // high overlap but no grouping vocabulary (e.g. a "gap" variable) -> withheld
    expect(
      classifyGroupedEvidence({ ...base, targetConcept: 'Low-income gap based on LICO-AT', overlap: 0.9 }),
    ).toBeNull();
  });

  it('withholds pairs with no evidence at all', () => {
    expect(classifyGroupedEvidence(base)).toBe(null);
  });
});

describe('resolveAgainstSupabase', () => {
  const pair = {
    surveyGroup: 'CIS_ECR_2018',
    cycle: '2018',
    docPath: 'CIS_ECR_2018/cis_2018_terr_f1_T15_2_v4.pdf',
    targetName: 'AGEG',
    baseName: 'AGE',
    tier: 'A' as const,
    confidence: 0.98,
    evidence: 'Concept: Age - Grouped',
    page: 7,
  };

  it('resolves both sides to live record IDs and prefers the matching cycle', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const name = /name=ilike\.([^&]*)/.exec(String(url))?.[1];
      if (name === decodeURIComponent('AGEG')) {
        return new Response(JSON.stringify([
          { record_id: 't-2017', cycle: '2017' },
          { record_id: 't-2018', cycle: '2018' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([{ record_id: 's-2018', cycle: '2018' }]), { status: 200 });
    }) as typeof fetch;

    const { edges, unresolved } = await resolveAgainstSupabase([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);
    expect(unresolved).toBe(0);
    expect(edges[0]?.targetRecordId).toBe('t-2018'); // cycle match preferred over first row
    expect(edges[0]?.sourceRecordId).toBe('s-2018');
    // one lookup per (survey, doc, name) — cached, not repeated
    expect(calls.length).toBe(2);
  });

  it('drops pairs whose target or base is absent from the live table', async () => {
    const fetchImpl = (async (url: string) => {
      const name = /name=ilike\.([^&]*)/.exec(String(url))?.[1];
      return new Response(
        JSON.stringify(name === decodeURIComponent('AGEG') ? [{ record_id: 't-1', cycle: null }] : []),
        { status: 200 },
      );
    }) as typeof fetch;

    const { edges, unresolved } = await resolveAgainstSupabase([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);
    expect(edges).toHaveLength(0);
    expect(unresolved).toBe(1);
  });

  it('falls back to the first live row when cycles are null (rebased surveys)', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ record_id: 'any-1', cycle: null }]), { status: 200 })) as typeof fetch;

    const { edges, unresolved } = await resolveAgainstSupabase(
      [{ ...pair, cycle: '' }],
      { url: 'https://x.supabase.co', serviceRoleKey: 'k' },
      fetchImpl,
    );
    expect(unresolved).toBe(0);
    expect(edges[0]?.targetRecordId).toBe('any-1');
  });

  it('fails loudly on HTTP errors instead of emitting dangling IDs', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    await expect(
      resolveAgainstSupabase([pair], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl),
    ).rejects.toThrow(/Live lookup failed/);
  });
});

describe('renderGroupedCollapseSql', () => {
  const edge: ResolvedGroupedEdge = {
    surveyGroup: 'CIS_ECR_2022',
    cycle: '2022',
    docPath: 'cis_2022_T15_2_f1_v2.pdf',
    targetName: 'AGEG',
    baseName: 'AGE',
    tier: 'C',
    confidence: TIER_CONFIDENCE.C,
    evidence: "Target concept: Person's age group as of December 31; base concept: Age as of December 31",
    targetRecordId: '11111111-2222-4333-8444-555555555555',
    sourceRecordId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    page: 7,
  };

  it('emits one value per column (15) and is idempotent-safe', () => {
    const sql = renderGroupedCollapseSql([edge]);
    expect(sql).toContain("on conflict (target_record_id, (upper(btrim(source_var_name)))) do nothing;");
    expect(sql).toContain("'verified'");
    expect(sql).toContain("'collapse'");
    expect(sql).toContain("'deterministic_g_suffix_rule'");
    // every row must carry exactly 15 values: strip the outer tuple, then count depth-0 commas
    const valueLine = sql.split('\n').find((l) => l.startsWith("('11111111"))!;
    const inner = valueLine.slice(1, -2); // drop leading '(' and trailing '),'
    let inQuote = false;
    let depth = 0;
    let topCommas = 0;
    for (const ch of inner) {
      if (ch === "'") inQuote = !inQuote;
      else if (!inQuote && ch === '(') depth++;
      else if (!inQuote && ch === ')') depth--;
      else if (ch === ',' && !inQuote && depth === 0) topCommas++;
    }
    expect(topCommas).toBe(14); // 15 values -> 14 separators
  });

  it('escapes single quotes in evidence text', () => {
    const quoted: ResolvedGroupedEdge = { ...edge, evidence: "Person's age group" };
    const sql = renderGroupedCollapseSql([quoted]);
    expect(sql).toContain("Person''s age group");
  });

  it('chunks inserts at 500 rows', () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ ...edge, targetName: `V${i}G`, baseName: `V${i}` }));
    const sql = renderGroupedCollapseSql(many);
    expect(sql.match(/insert into corpus_derivation_edge/g)?.length).toBe(3);
  });
});

describe('groupedEdgeId / edgeToRow', () => {
  const edge: ResolvedGroupedEdge = {
    surveyGroup: 'CIS_ECR_2022',
    cycle: '2022',
    docPath: 'cis_2022_T15_2_f1_v2.pdf',
    targetName: 'AGEG',
    baseName: 'AGE',
    tier: 'C',
    confidence: TIER_CONFIDENCE.C,
    evidence: "Target concept: Person's age group as of December 31; base concept: Age as of December 31",
    targetRecordId: '11111111-2222-4333-8444-555555555555',
    sourceRecordId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    page: 7,
  };

  it('is deterministic and a valid v5 UUID', () => {
    const id = groupedEdgeId(edge);
    expect(id).toBe(groupedEdgeId({ ...edge })); // same facts -> same id (idempotent re-import)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs when any defining fact changes', () => {
    const base = groupedEdgeId(edge);
    expect(groupedEdgeId({ ...edge, sourceRecordId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).not.toBe(base);
    expect(groupedEdgeId({ ...edge, baseName: 'AGE2' })).not.toBe(base);
  });

  it('maps every SQL column to a REST row', () => {
    const row = edgeToRow(edge) as Record<string, unknown>;
    expect(row.edge_id).toBe(groupedEdgeId(edge));
    expect(row.target_record_id).toBe(edge.targetRecordId);
    expect(row.source_record_id).toBe(edge.sourceRecordId);
    expect(row.source_var_name).toBe('AGE');
    expect(row.derivation_type).toBe('collapse');
    expect(row.review_status).toBe('verified');
    expect(row.confidence).toBe(0.9);
    expect(row.extraction_method).toBe('deterministic_g_suffix_rule');
    expect((row.statcan_citation as Record<string, unknown>).doc).toBe(edge.docPath);
  });
});

describe('existingLogicalPairs', () => {
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
    const set = await existingLogicalPairs(ids, { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);

    expect(calls.length).toBe(2); // 500 + 101
    expect(set.has('t-1|AGE')).toBe(true);
    expect(set.has('t-2|DAGEYRS')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('fails loudly on HTTP errors', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(existingLogicalPairs(['t-1'], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl)).rejects.toThrow(
      /prefilter failed/i,
    );
  });
});

describe('importGroupedEdges', () => {
  const edge: ResolvedGroupedEdge = {
    surveyGroup: 'CIS_ECR_2022',
    cycle: '2022',
    docPath: 'cis_2022_T15_2_f1_v2.pdf',
    targetName: 'AGEG',
    baseName: 'AGE',
    tier: 'C',
    confidence: 0.9,
    evidence: 'e',
    targetRecordId: '11111111-2222-4333-8444-555555555555',
    sourceRecordId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    page: 7,
  };

  it('upserts in batches of 250 with on_conflict=edge_id and merge-duplicates', async () => {
    const calls: Array<{ url: string; body: unknown[] }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const many = Array.from({ length: 600 }, (_, i) => ({ ...edge, targetName: `V${i}G`, baseName: `V${i}` }));
    const { written } = await importGroupedEdges(many, { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl);

    expect(written).toBe(600);
    expect(calls.length).toBe(3); // 250 + 250 + 100
    for (const c of calls) {
      expect(c.url).toContain('/rest/v1/corpus_derivation_edge?on_conflict=edge_id');
    }
    expect((calls[0]?.body[0] as Record<string, unknown>).edge_id).toBe(groupedEdgeId(many[0]!));
  });

  it('skips logical pairs already live (other unique index) and reports them', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    // AGE edge is already live under a random id -> must be filtered out before the POST.
    const skipExisting = new Set([`${edge.targetRecordId}|AGE`]);
    const other = { ...edge, targetName: 'SEGG', baseName: 'SEG' };
    const { written, skippedExisting } = await importGroupedEdges(
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
    const fetchImpl = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    await expect(
      importGroupedEdges([edge], { url: 'https://x.supabase.co', serviceRoleKey: 'k' }, fetchImpl),
    ).rejects.toThrow(/Edge import failed/);
  });
});
