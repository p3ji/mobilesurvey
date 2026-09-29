import { describe, it, expect } from 'vitest';
import {
  baseOfGroupedName,
  conceptOverlap,
  classifyGroupedEvidence,
  renderGroupedCollapseSql,
  resolveAgainstSupabase,
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
