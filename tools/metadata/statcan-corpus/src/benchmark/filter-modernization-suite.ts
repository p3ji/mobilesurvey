import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load environment credentials from available .env files
for (const envPath of [
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../.env'),
]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]!]) {
      process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '');
    }
  }
}

const supabaseUrl = (process.env.VITE_CORPUS_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const supabaseKey = process.env.VITE_CORPUS_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const qdrantUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT)?.replace(/\/+$/, '');
const qdrantKey = process.env.QDRANT_API_KEY;
const qdrantCollection = process.env.QDRANT_COLLECTION || 'modularsurvey';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL and anon key are required.');
}

export interface TestCase {
  id: string;
  category: string;
  hypothesis: string;
  query: string;
  filters: {
    survey?: string;
    role?: 'all' | 'collected' | 'derived' | 'administrative' | 'process';
    hideProcess?: boolean;
    hideHarmonized?: boolean;
    lang?: 'en' | 'fr' | 'all';
    sort?: 'relevance' | 'recent';
  };
  expectedCriteria: {
    maxLatencyMs: number;
    minTotal: number;
    maxTotal?: number;
    expectedVariables?: string[];
    forbiddenVariables?: string[];
    expectedSurveyPrefix?: string;
    expectSemanticHits?: boolean;
    demographicOverrideAllowed?: boolean;
  };
}

export interface TestResult {
  testId: string;
  category: string;
  query: string;
  passed: boolean;
  latencyMs: number;
  lexicalTotal: number;
  lexicalTopHit?: { name: string; concept: string; role: string; survey: string };
  semanticCount: number;
  semanticTopHit?: { name: string; concept: string; score: number };
  failures: string[];
}

export const TEST_BATTERY: TestCase[] = [
  // --- Hypothesis 1: Program-Level Survey Search ---
  {
    id: 'H1-PROG-CCHS',
    category: '1. Program-Level Hierarchy',
    hypothesis: 'Searching with survey="CCHS" aggregates across all CCHS cycles without 0-hit semantic starvation',
    query: 'smoking',
    filters: { survey: 'CCHS', hideProcess: true, hideHarmonized: true },
    expectedCriteria: {
      maxLatencyMs: 2500,
      minTotal: 50,
      expectedSurveyPrefix: 'CCHS',
      expectSemanticHits: true,
    },
  },
  {
    id: 'H1-PROG-GSS',
    category: '1. Program-Level Hierarchy',
    hypothesis: 'Searching with survey="GSS" aggregates General Social Survey variables across all cycles',
    query: 'life satisfaction',
    filters: { survey: 'GSS', hideProcess: true, hideHarmonized: true },
    expectedCriteria: {
      maxLatencyMs: 2500,
      minTotal: 10,
      expectedSurveyPrefix: 'GSS',
      expectSemanticHits: true,
    },
  },
  {
    id: 'H1-PROG-CIS',
    category: '1. Program-Level Hierarchy',
    hypothesis: 'Searching with survey="CIS" isolates Canadian Income Survey variables',
    query: 'household income',
    filters: { survey: 'CIS', hideProcess: true, hideHarmonized: true },
    expectedCriteria: {
      maxLatencyMs: 2500,
      minTotal: 10,
      expectedSurveyPrefix: 'CIS',
    },
  },

  // --- Hypothesis 2: Administrative Linkage Discovery & Zero Timeouts ---
  {
    id: 'H2-ADM-TAX-NTINC',
    category: '2. Administrative Linkage Discovery',
    hypothesis: 'Filtering by role="administrative" returns T1FF/CRA tax linkages without statement timeout',
    query: 'tax',
    filters: { role: 'administrative', hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 4000,
      minTotal: 5,
      expectedVariables: ['NTINC', 'ALIMO', 'SSHIP', 'INCTAX'],
    },
  },
  {
    id: 'H2-ADM-PROVTERR',
    category: '2. Administrative Linkage Discovery',
    hypothesis: 'Administrative geographic / NHS linkage variables are retrieved under administrative role',
    query: 'province of residence',
    filters: { role: 'administrative', hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 4000,
      minTotal: 5,
      expectedVariables: ['PROVTERR', 'NPRCODE', 'PR1', 'PR5'],
    },
  },

  // --- Hypothesis 3: Harmonized Demographics De-Cluttering ---
  {
    id: 'H3-HARM-FOOD-INSEC',
    category: '3. Harmonized Content De-Cluttering',
    hypothesis: 'Topical health search suppresses generic age/DOB/province boilerplate when hideHarmonized=true',
    query: 'food security',
    filters: { hideHarmonized: true, hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 2000,
      minTotal: 5,
      expectedVariables: ['DFSUS10', 'DFSECCAN', 'DFSCANHH', 'FS_'],
      forbiddenVariables: ['AGE', 'DOB', 'SEX', 'PRV', 'GEO_PRV'],
    },
  },
  {
    id: 'H3-HARM-CHRONIC-PAIN',
    category: '3. Harmonized Content De-Cluttering',
    hypothesis: 'Chronic pain search returns substantive pain scale items, not demographics',
    query: 'chronic pain',
    filters: { hideHarmonized: true, hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 2000,
      minTotal: 3,
      forbiddenVariables: ['AGE', 'DOB', 'SEX', 'MARSTAT'],
    },
  },
  {
    id: 'H3-HARM-EXPLICIT-DOB',
    category: '3. Harmonized Content De-Cluttering',
    hypothesis: 'Explicit demographic query "date of birth" overrides suppression and retrieves DOB/AGE',
    query: 'date of birth',
    filters: { hideHarmonized: true, hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 2000,
      minTotal: 1,
      expectedVariables: ['DOB', 'AGE_01A', 'DHHGAGE'],
      demographicOverrideAllowed: true,
    },
  },

  // --- Hypothesis 4: Paradata & Weights Isolation ---
  {
    id: 'H4-PROC-BOOTSTRAP-WEIGHTS',
    category: '4. Paradata & Weights Isolation',
    hypothesis: 'Selecting role="process" allows intentional retrieval of replicate bootstrap weights',
    query: 'bootstrap',
    filters: { role: 'process', hideProcess: false },
    expectedCriteria: {
      maxLatencyMs: 2500,
      minTotal: 5,
      expectedVariables: ['BSW', 'WTPM', 'WTBS', 'BOOT'],
    },
  },
  {
    id: 'H4-PROC-SUPPRESSION-CHECK',
    category: '4. Paradata & Weights Isolation',
    hypothesis: 'Default hideProcess=true completely suppresses replicate weights from substantive searches',
    query: 'sample weight',
    filters: { hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 2000,
      minTotal: 1,
      forbiddenVariables: ['BSW1', 'BSW2', 'FWT', 'WTPM1'],
    },
  },

  // --- Hypothesis 5: Dual-Search Semantic Parity ---
  {
    id: 'H5-SEMANTIC-DISTRESS',
    category: '5. Dual-Search Sidecar Parity',
    hypothesis: 'Semantic search retrieves relevant psychological distress items when role="collected"',
    query: 'psychological distress',
    filters: { role: 'collected', hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 3000,
      minTotal: 5,
      expectSemanticHits: true,
    },
  },
  {
    id: 'H5-SEMANTIC-TELEWORK',
    category: '5. Dual-Search Sidecar Parity',
    hypothesis: 'Semantic search discovers telework / work-from-home constructs',
    query: 'working from home',
    filters: { role: 'collected', hideProcess: true },
    expectedCriteria: {
      maxLatencyMs: 3000,
      minTotal: 3,
      expectSemanticHits: true,
    },
  },
];

async function callRpc<T>(fn: string, args: unknown): Promise<T> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey!,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`RPC ${fn} failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

let programSurveyGroups = new Map<string, string[]>();

async function initSurveyGroups(): Promise<void> {
  if (programSurveyGroups.size > 0) return;
  try {
    const list = await callRpc<Array<{ survey_group: string; survey_acronym: string | null }>>('corpus_surveys', {});
    for (const item of list) {
      const acronym = item.survey_acronym || item.survey_group.split('_')[0]!;
      const current = programSurveyGroups.get(acronym) ?? [];
      current.push(item.survey_group);
      programSurveyGroups.set(acronym, current);
    }
  } catch {
    // Fallback if RPC fails
  }
}

async function callQdrant(query: string, filters: TestCase['filters'], limit = 5): Promise<any[]> {
  if (!qdrantUrl || !qdrantKey) return [];
  await initSurveyGroups();
  const must: any[] = [];
  const mustNot: any[] = [];

  if (filters.role && filters.role !== 'all') {
    must.push({ key: 'role', match: { value: filters.role } });
  }
  if (filters.hideProcess) {
    mustNot.push({ key: 'role', match: { value: 'process' } });
  }
  if (filters.survey && filters.survey !== 'all') {
    const groups = programSurveyGroups.get(filters.survey) ?? [filters.survey];
    if (groups.length === 1) {
      must.push({ key: 'survey_group', match: { value: groups[0] } });
    } else if (groups.length > 1) {
      must.push({ key: 'survey_group', match: { any: groups } });
    }
  }

  const filterClause: any = {};
  if (must.length > 0) filterClause.must = must;
  if (mustNot.length > 0) filterClause.must_not = mustNot;

  try {
    const res = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/points/query`, {
      method: 'POST',
      headers: {
        'api-key': qdrantKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: { text: query, model: 'sentence-transformers/all-minilm-l6-v2' },
        limit,
        score_threshold: 0.55,
        ...(Object.keys(filterClause).length > 0 ? { filter: filterClause } : {}),
        with_payload: true,
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.result?.points ?? [];
  } catch {
    return [];
  }
}

export async function runTestBattery(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const test of TEST_BATTERY) {
    const t0 = performance.now();
    const failures: string[] = [];
    let lexicalRows: any[] = [];
    let semanticPoints: any[] = [];

    try {
      lexicalRows = await callRpc<any[]>('corpus_search_sorted', {
        q: test.query,
        lang_filter: test.filters.lang === 'all' ? null : (test.filters.lang ?? null),
        survey_filter: test.filters.survey ?? null,
        role_filter: test.filters.role === 'all' ? null : (test.filters.role ?? null),
        hide_process: test.filters.hideProcess ?? false,
        sort_mode: test.filters.sort ?? 'relevance',
        max_rows: 25,
        row_offset: 0,
      });
    } catch (err: any) {
      failures.push(`Lexical RPC error: ${err.message}`);
    }

    try {
      semanticPoints = await callQdrant(test.query, test.filters);
    } catch (err: any) {
      failures.push(`Qdrant vector query error: ${err.message}`);
    }

    const latencyMs = Math.round(performance.now() - t0);
    const lexicalTotal = lexicalRows[0]?.total_count ?? lexicalRows.length;

    // Evaluate Criteria
    if (latencyMs > test.expectedCriteria.maxLatencyMs) {
      failures.push(`Latency ${latencyMs}ms exceeded max ${test.expectedCriteria.maxLatencyMs}ms`);
    }

    if (lexicalTotal < test.expectedCriteria.minTotal) {
      failures.push(`Total hits ${lexicalTotal} fell below required minimum ${test.expectedCriteria.minTotal}`);
    }

    if (test.expectedCriteria.maxTotal !== undefined && lexicalTotal > test.expectedCriteria.maxTotal) {
      failures.push(`Total hits ${lexicalTotal} exceeded maximum ${test.expectedCriteria.maxTotal}`);
    }

    if (test.expectedCriteria.expectedSurveyPrefix) {
      const topSurvey = lexicalRows[0]?.survey_acronym || lexicalRows[0]?.survey_group || '';
      if (!topSurvey.startsWith(test.expectedCriteria.expectedSurveyPrefix)) {
        failures.push(`Expected survey prefix "${test.expectedCriteria.expectedSurveyPrefix}", got "${topSurvey}"`);
      }
    }

    if (test.expectedCriteria.expectedVariables) {
      const returnedNames = new Set(lexicalRows.map((r) => r.name.toUpperCase()));
      const foundOne = test.expectedCriteria.expectedVariables.some((v) =>
        Array.from(returnedNames).some((name) => name.includes(v.toUpperCase()))
      );
      if (!foundOne) {
        failures.push(`None of expected variables [${test.expectedCriteria.expectedVariables.join(', ')}] appeared in top hits (saw: ${Array.from(returnedNames).slice(0, 5).join(', ')})`);
      }
    }

    if (test.expectedCriteria.forbiddenVariables) {
      const returnedNames = lexicalRows.map((r) => r.name.toUpperCase());
      for (const forbidden of test.expectedCriteria.forbiddenVariables) {
        if (returnedNames.some((name) => name === forbidden || name.startsWith(forbidden + '_'))) {
          failures.push(`Forbidden variable "${forbidden}" appeared in top hits`);
        }
      }
    }

    if (test.expectedCriteria.expectSemanticHits && semanticPoints.length === 0) {
      // Note failure if semantic was expected
      failures.push('Expected semantic hits > 0, but received 0 semantic discoveries');
    }

    results.push({
      testId: test.id,
      category: test.category,
      query: test.query,
      passed: failures.length === 0,
      latencyMs,
      lexicalTotal,
      lexicalTopHit: lexicalRows[0] ? {
        name: lexicalRows[0].name,
        concept: lexicalRows[0].concept,
        role: lexicalRows[0].role ?? 'n/a',
        survey: lexicalRows[0].survey_acronym || lexicalRows[0].survey_group,
      } : undefined,
      semanticCount: semanticPoints.length,
      semanticTopHit: semanticPoints[0] ? {
        name: semanticPoints[0].payload?.name ?? semanticPoints[0].id,
        concept: semanticPoints[0].payload?.concept ?? '',
        score: semanticPoints[0].score,
      } : undefined,
      failures,
    });
  }

  return results;
}

if (process.argv[1]?.endsWith('filter-modernization-suite.ts')) {
  console.log('Running Filter Modernization Benchmark Suite...\n');
  runTestBattery().then((results) => {
    let passedCount = 0;
    console.log('| ID | Category | Query | Status | Latency | Hits | Semantic | Failures |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of results) {
      if (r.passed) passedCount++;
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      const failMsg = r.failures.length > 0 ? r.failures.join('; ') : 'None';
      console.log(`| ${r.testId} | ${r.category} | "${r.query}" | ${status} | ${r.latencyMs}ms | ${r.lexicalTotal} | ${r.semanticCount} | ${failMsg} |`);
    }
    console.log(`\nResults: ${passedCount}/${results.length} passed.`);
    const reportPath = resolve(import.meta.dirname, '../../out/filter-modernization-baseline.json');
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`Report saved to ${reportPath}`);
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
