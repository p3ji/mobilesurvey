import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from '@xenova/transformers';
import type { BenchmarkQuery, BenchmarkEvaluationReport, QueryMethodResult } from './types.js';

// 1. Environment discovery
const candidatePaths = [
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env'),
  resolve(import.meta.dirname, '../../../../../.env'),
];

for (const envPath of candidatePaths) {
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const qdrantUrl = (process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT || process.env.CLUSTER_URL)?.replace(/\/+$/, '');
const qdrantApiKey = process.env.QDRANT_API_KEY;
const collectionName = process.env.QDRANT_COLLECTION ?? 'modularsurvey';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: Supabase credentials not found in environment.');
  process.exit(1);
}

// 2. Load Queries
const queriesPath = resolve(import.meta.dirname, 'queries.json');
const queries: BenchmarkQuery[] = JSON.parse(readFileSync(queriesPath, 'utf8'));

interface SearchRpcRow {
  record_id: string;
  name: string;
  concept: string | null;
  question_text: string | null;
  rank: number;
  total_count: number;
}

async function runSearch(query: string, hideProcess: boolean = false): Promise<{ latencyMs: number; hits: SearchRpcRow[] }> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/corpus_search`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey!,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        lang_filter: null,
        survey_filter: null,
        year_min: null,
        year_max: null,
        require_codes: null,
        subject_filter: null,
        role_filter: null,
        hide_process: hideProcess,
        max_rows: 5,
        row_offset: 0,
      }),
    });

    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      console.warn(`Query "${query}" failed with status ${res.status}: ${await res.text()}`);
      return { latencyMs, hits: [] };
    }

    const hits = (await res.json()) as SearchRpcRow[];
    return { latencyMs, hits };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    console.warn(`Query "${query}" threw error: ${err}`);
    return { latencyMs, hits: [] };
  }
}

// Qdrant Vector Search + Supabase Hydration
async function runQdrantSearch(
  query: string,
  extractor: any,
  hideProcess: boolean = false
): Promise<{ latencyMs: number; hits: SearchRpcRow[] }> {
  const t0 = performance.now();
  try {
    const out = await extractor(query, { pooling: 'mean', normalize: true });
    const vector = Array.from(out.data as Float32Array);

    const filterClause: any = { must: [] };
    if (hideProcess) {
      filterClause.must_not = [{ key: 'role', match: { value: 'process' } }];
    }

    const qdrantRes = await fetch(`${qdrantUrl}/collections/${collectionName}/points/search`, {
      method: 'POST',
      headers: {
        'api-key': qdrantApiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vector,
        limit: 5,
        with_payload: false,
        ...(filterClause.must.length > 0 || filterClause.must_not ? { filter: filterClause } : {}),
      }),
    });

    if (!qdrantRes.ok) {
      return { latencyMs: Math.round(performance.now() - t0), hits: [] };
    }

    const qdrantData = (await qdrantRes.json()) as { result?: Array<{ id: string; score: number }> };
    const ids = (qdrantData.result ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return { latencyMs: Math.round(performance.now() - t0), hits: [] };
    }

    // Hydrate from Supabase
    const hydrateRes = await fetch(
      `${supabaseUrl}/rest/v1/corpus_variable?select=record_id,name,concept,question_text&record_id=in.(${ids.join(',')})`,
      {
        headers: {
          apikey: supabaseAnonKey!,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      }
    );

    const latencyMs = Math.round(performance.now() - t0);
    if (!hydrateRes.ok) {
      return { latencyMs, hits: [] };
    }

    const rawRows = (await hydrateRes.json()) as Array<{
      record_id: string;
      name: string;
      concept: string | null;
      question_text: string | null;
    }>;

    // Preserve Qdrant ranking order
    const rowMap = new Map(rawRows.map((r) => [r.record_id, r]));
    const orderedHits: SearchRpcRow[] = ids
      .map((id, idx) => {
        const row = rowMap.get(id);
        if (!row) return null;
        return {
          record_id: row.record_id,
          name: row.name,
          concept: row.concept,
          question_text: row.question_text,
          rank: qdrantData.result?.[idx]?.score ?? 0,
          total_count: ids.length,
        };
      })
      .filter((h): h is SearchRpcRow => h !== null);

    return { latencyMs, hits: orderedHits };
  } catch {
    return { latencyMs: Math.round(performance.now() - t0), hits: [] };
  }
}

// AI Phrase Expansion with rate limit protection
async function runAiSearch(query: string): Promise<{ latencyMs: number; phrases: string[]; hits: SearchRpcRow[] }> {
  const t0 = performance.now();
  try {
    const expandRes = await fetch(`${supabaseUrl}/functions/v1/corpus-ai-expand`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey!,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!expandRes.ok) {
      return { latencyMs: Math.round(performance.now() - t0), phrases: [], hits: [] };
    }

    const expandData = (await expandRes.json()) as { queries?: string[] };
    const phrases = Array.isArray(expandData.queries) ? expandData.queries : [];
    if (phrases.length === 0) {
      return { latencyMs: Math.round(performance.now() - t0), phrases: [], hits: [] };
    }

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/corpus_search_ai`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey!,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search_terms: phrases,
        sort_mode: 'relevance',
        lang_filter: null,
        survey_filter: null,
        year_min: null,
        year_max: null,
        require_codes: null,
        subject_filter: null,
        role_filter: null,
        hide_process: false,
        max_rows: 5,
        row_offset: 0,
      }),
    });

    const latencyMs = Math.round(performance.now() - t0);
    if (!rpcRes.ok) {
      return { latencyMs, phrases, hits: [] };
    }
    const hits = (await rpcRes.json()) as SearchRpcRow[];
    return { latencyMs, phrases, hits };
  } catch {
    return { latencyMs: Math.round(performance.now() - t0), phrases: [], hits: [] };
  }
}

function evaluateHits(q: BenchmarkQuery, hits: SearchRpcRow[]): {
  exactHitAtRank1?: boolean;
  precisionAt5?: number;
  noisePolluted?: boolean;
} {
  const result: { exactHitAtRank1?: boolean; precisionAt5?: number; noisePolluted?: boolean } = {};

  if (q.category === 'exact_mnemonic' && q.expectedExactName) {
    result.exactHitAtRank1 = hits[0]?.name.toUpperCase() === q.expectedExactName.toUpperCase();
  }

  if (q.expectedTopTerms && q.expectedTopTerms.length > 0) {
    if (hits.length === 0) {
      result.precisionAt5 = 0;
    } else {
      let matchedCount = 0;
      for (const h of hits) {
        const text = `${h.name} ${h.concept ?? ''} ${h.question_text ?? ''}`.toLowerCase();
        const hasTerm = q.expectedTopTerms.some((t) => text.includes(t.toLowerCase()));
        if (hasTerm) matchedCount++;
      }
      result.precisionAt5 = Math.round((matchedCount / hits.length) * 100);
    }
  }

  if (q.noiseTermsToAvoid && q.noiseTermsToAvoid.length > 0) {
    let noiseCount = 0;
    for (const h of hits) {
      const text = `${h.name} ${h.concept ?? ''} ${h.question_text ?? ''}`.toLowerCase();
      if (q.noiseTermsToAvoid.some((n) => text.includes(n.toLowerCase()))) {
        noiseCount++;
      }
    }
    result.noisePolluted = noiseCount >= 3;
  }

  return result;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const includeAi = process.argv.includes('--ai');
  const hasQdrant = Boolean(qdrantUrl && qdrantApiKey);
  const MAX_AI_TESTS = 30; // Strictly cap at 30 queries to avoid hitting Groq/Supabase daily limits

  console.log(`\n======================================================`);
  console.log(`  StatCan Metadata Search Benchmark Suite`);
  console.log(`  Total Queries: ${queries.length}`);
  console.log(`  Qdrant Sidecar Active: ${hasQdrant ? 'Yes' : 'No'}`);
  console.log(`  AI Expansion Testing: ${includeAi ? `Active (Strictly capped at max ${MAX_AI_TESTS} queries)` : 'Disabled (use --ai to test)'}`);
  console.log(`======================================================\n`);

  let extractor: any = null;
  if (hasQdrant) {
    console.log('Initializing local extractor for Qdrant queries...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  const activeMethods = [
    'Lexical (Standard)',
    'Lexical (Hide Process)',
    ...(hasQdrant ? ['Qdrant Vector'] : []),
    ...(includeAi ? ['AI Phrase Expansion'] : []),
  ];

  const report: BenchmarkEvaluationReport = {
    timestamp: new Date().toISOString(),
    totalQueries: queries.length,
    methods: activeMethods,
    summary: {},
    queryDetails: [],
  };

  const latenciesStandard: number[] = [];
  const latenciesVector: number[] = [];
  let mnemonicCorrectStandard = 0;
  let mnemonicCorrectVector = 0;
  let totalMnemonics = 0;
  let zeroResultsStandard = 0;
  let zeroResultsVector = 0;
  let controlFalsePositivesStandard = 0;
  let controlFalsePositivesVector = 0;
  const precisionsStandard: number[] = [];
  const precisionsVector: number[] = [];

  let aiCallsExecuted = 0;
  let aiZeroToHeroRecoveries = 0;
  const aiPhrasesLogged: Record<string, { phrases: string[]; totalHits: number }> = {};

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    process.stdout.write(`[${i + 1}/${queries.length}] (${q.category}) "${q.query}"... `);

    // 1. Standard lexical search
    const std = await runSearch(q.query, false);
    latenciesStandard.push(std.latencyMs);
    const evalStd = evaluateHits(q, std.hits);

    // 2. Hide process search
    const noProc = await runSearch(q.query, true);
    const evalNoProc = evaluateHits(q, noProc.hits);

    const stdTotal = std.hits[0]?.total_count ?? 0;
    const noProcTotal = noProc.hits[0]?.total_count ?? 0;

    // 3. Qdrant vector search
    let vecResult: QueryMethodResult | undefined;
    if (hasQdrant && extractor) {
      const vec = await runQdrantSearch(q.query, extractor, false);
      latenciesVector.push(vec.latencyMs);
      const evalVec = evaluateHits(q, vec.hits);

      if (q.category === 'exact_mnemonic' && evalVec.exactHitAtRank1) {
        mnemonicCorrectVector++;
      }
      if (q.category === 'control' && vec.hits.length > 0) {
        controlFalsePositivesVector++;
      }
      if (vec.hits.length === 0 && q.category !== 'control') {
        zeroResultsVector++;
      }
      if (evalVec.precisionAt5 !== undefined) {
        precisionsVector.push(evalVec.precisionAt5);
      }

      vecResult = {
        methodName: 'Qdrant Vector',
        latencyMs: vec.latencyMs,
        totalHits: vec.hits.length,
        topHits: vec.hits.map((h) => ({
          name: h.name,
          concept: h.concept,
          questionText: h.question_text,
          score: h.rank,
        })),
        ...evalVec,
      };
    }

    let aiResult: QueryMethodResult | undefined;

    // 4. Optional AI phrase expansion (quota-protected: only on eligible queries, max 30)
    const isAiEligible =
      includeAi &&
      aiCallsExecuted < MAX_AI_TESTS &&
      (stdTotal === 0 || q.category === 'colloquial' || q.category === 'cross_lingual') &&
      q.category !== 'exact_mnemonic' &&
      q.category !== 'control';

    if (isAiEligible) {
      aiCallsExecuted++;
      await sleep(400); // Friendly throttle for RPM limits
      const ai = await runAiSearch(q.query);
      const aiTotal = ai.hits[0]?.total_count ?? 0;
      const evalAi = evaluateHits(q, ai.hits);

      if (stdTotal === 0 && aiTotal > 0) {
        aiZeroToHeroRecoveries++;
      }

      aiPhrasesLogged[q.id] = { phrases: ai.phrases, totalHits: aiTotal };

      aiResult = {
        methodName: 'AI Phrase Expansion',
        latencyMs: ai.latencyMs,
        totalHits: aiTotal,
        topHits: ai.hits.map((h) => ({
          name: h.name,
          concept: h.concept,
          questionText: h.question_text,
          score: h.rank,
        })),
        ...evalAi,
      };

      console.log(`Lex: ${stdTotal} | Vec: ${vecResult?.topHits[0]?.name ?? 'None'} | AI [${ai.phrases.join(', ')}]: ${aiTotal} hits`);
    } else {
      console.log(`Lex: ${stdTotal} (${std.latencyMs}ms) | Vec Top: ${vecResult?.topHits[0]?.name ?? 'None'} (${vecResult?.latencyMs ?? 0}ms)`);
    }

    if (q.category === 'exact_mnemonic') {
      totalMnemonics++;
      if (evalStd.exactHitAtRank1) mnemonicCorrectStandard++;
    }

    if (q.category === 'control' && std.hits.length > 0) {
      controlFalsePositivesStandard++;
    }

    if (std.hits.length === 0 && q.category !== 'control' && q.category !== 'cross_lingual') {
      zeroResultsStandard++;
    }

    if (evalStd.precisionAt5 !== undefined) {
      precisionsStandard.push(evalStd.precisionAt5);
    }

    const standardResult: QueryMethodResult = {
      methodName: 'Lexical (Standard)',
      latencyMs: std.latencyMs,
      totalHits: stdTotal,
      topHits: std.hits.map((h) => ({
        name: h.name,
        concept: h.concept,
        questionText: h.question_text,
        score: h.rank,
      })),
      ...evalStd,
    };

    const noProcResult: QueryMethodResult = {
      methodName: 'Lexical (Hide Process/Weights)',
      latencyMs: noProc.latencyMs,
      totalHits: noProcTotal,
      topHits: noProc.hits.map((h) => ({
        name: h.name,
        concept: h.concept,
        questionText: h.question_text,
        score: h.rank,
      })),
      ...evalNoProc,
    };

    report.queryDetails.push({
      queryId: q.id,
      query: q.query,
      category: q.category,
      theme: q.theme,
      resultsByMethod: {
        'Lexical (Standard)': standardResult,
        'Lexical (Hide Process)': noProcResult,
        ...(vecResult ? { 'Qdrant Vector': vecResult } : {}),
        ...(aiResult ? { 'AI Phrase Expansion': aiResult } : {}),
      },
    });
  }

  latenciesStandard.sort((a, b) => a - b);
  const avgLat = Math.round(latenciesStandard.reduce((a, b) => a + b, 0) / latenciesStandard.length);
  const p95Lat = latenciesStandard[Math.floor(latenciesStandard.length * 0.95)] ?? 0;
  const avgPrec =
    precisionsStandard.length > 0
      ? Math.round(precisionsStandard.reduce((a, b) => a + b, 0) / precisionsStandard.length)
      : 0;

  report.summary['Lexical (Standard)'] = {
    avgLatencyMs: avgLat,
    p95LatencyMs: p95Lat,
    exactMnemonicAccuracy: totalMnemonics > 0 ? Math.round((mnemonicCorrectStandard / totalMnemonics) * 100) : 0,
    zeroResultCount: zeroResultsStandard,
    controlFalsePositiveCount: controlFalsePositivesStandard,
    avgPrecisionAt5: avgPrec,
  };

  if (hasQdrant && latenciesVector.length > 0) {
    latenciesVector.sort((a, b) => a - b);
    const avgVecLat = Math.round(latenciesVector.reduce((a, b) => a + b, 0) / latenciesVector.length);
    const p95VecLat = latenciesVector[Math.floor(latenciesVector.length * 0.95)] ?? 0;
    const avgVecPrec =
      precisionsVector.length > 0
        ? Math.round(precisionsVector.reduce((a, b) => a + b, 0) / precisionsVector.length)
        : 0;

    report.summary['Qdrant Vector'] = {
      avgLatencyMs: avgVecLat,
      p95LatencyMs: p95VecLat,
      exactMnemonicAccuracy: totalMnemonics > 0 ? Math.round((mnemonicCorrectVector / totalMnemonics) * 100) : 0,
      zeroResultCount: zeroResultsVector,
      controlFalsePositiveCount: controlFalsePositivesVector,
      avgPrecisionAt5: avgVecPrec,
    };
  }

  // Generate markdown report
  const reportMd = generateMarkdownReport(report, aiCallsExecuted, aiZeroToHeroRecoveries, aiPhrasesLogged);
  const outMdPath = resolve(import.meta.dirname, '../../../../../docs/search-benchmark-report.md');
  const outJsonPath = resolve(import.meta.dirname, '../../out/search-benchmark-results.json');

  import('node:fs').then(({ mkdirSync }) => {
    mkdirSync(resolve(import.meta.dirname, '../../out'), { recursive: true });
    writeFileSync(outMdPath, reportMd, 'utf8');
    writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');
  });

  console.log(`\n======================================================`);
  console.log(`  Benchmark Finished Successfully!`);
  console.log(`  Lexical Latency: ${avgLat} ms (p95: ${p95Lat} ms)`);
  if (hasQdrant && report.summary['Qdrant Vector']) {
    console.log(`  Vector Latency: ${report.summary['Qdrant Vector'].avgLatencyMs} ms (p95: ${report.summary['Qdrant Vector'].p95LatencyMs} ms)`);
    console.log(`  Vector term-overlap proxy @ 5: ${report.summary['Qdrant Vector'].avgPrecisionAt5}% (ungraded)`);
  }
  console.log(`  Report saved to: docs/search-benchmark-report.md`);
  console.log(`======================================================\n`);
}

function generateMarkdownReport(
  rep: BenchmarkEvaluationReport,
  aiCalls: number,
  aiRecoveries: number,
  _aiPhrases: Record<string, { phrases: string[]; totalHits: number }>
): string {
  const std = rep.summary['Lexical (Standard)'];
  const vec = rep.summary['Qdrant Vector'];
  let md = `# Historical ungraded search retrieval diagnostic\n\n`;
  md += `**Date:** ${new Date().toLocaleDateString('en-CA')} · **Queries Tested:** ${rep.totalQueries}\n\n`;
  md += `**Historical diagnostic only.** The vector path below queried Qdrant directly without Searcher's 0.55 score threshold. Its term-overlap proxy is not a human relevance grade; a nonempty vector response is not a successful bridge. Use the production-endpoint evaluation before drawing relevance conclusions.\n\n`;
  md += `## 1. Retrieval diagnostics: Lexical vs. direct Qdrant vs. AI Expansion\n\n`;
  md += `| Metric | Lexical (Standard) | Qdrant Vector (Pilot) | Target Threshold |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  md += `| **Exact Mnemonic Accuracy** | **${std?.exactMnemonicAccuracy}%** | **${vec?.exactMnemonicAccuracy ?? '-'}%** | 100% (Lexical preserves this) |\n`;
  md += `| **Unreviewed term overlap @ Top 5** | **${std?.avgPrecisionAt5}%** | **${vec?.avgPrecisionAt5 ?? '-'}%** | Human grading required |\n`;
  md += `| **Average Latency** | **${std?.avgLatencyMs} ms** | **${vec?.avgLatencyMs ?? '-'} ms** | < 400 ms |\n`;
  md += `| **p95 Latency** | **${std?.p95LatencyMs} ms** | **${vec?.p95LatencyMs ?? '-'} ms** | < 1200 ms |\n`;
  md += `| **Zero-Result Rate (non-controls)** | **${std?.zeroResultCount} / 100** | **${vec?.zeroResultCount ?? '-'} / 100** | Minimized |\n\n`;

  if (aiCalls > 0) {
    md += `### AI Phrase Expansion (Quota-Capped Pilot)\n`;
    md += `- **Capped AI API Calls:** ${aiCalls} / 30 max quota\n`;
    md += `- **Zero-Result Recoveries:** ${aiRecoveries} previously dead queries revived by AI phrase retrieval\n\n`;
  }

  md += `## 2. Head-to-Head Retrieval by Query\n\n`;
  md += `| ID | Category | Theme | Query | Lexical Hits | Vector Top Hit | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :---: | :--- | :--- |\n`;

  for (const d of rep.queryDetails) {
    const s = d.resultsByMethod['Lexical (Standard)'];
    const v = d.resultsByMethod['Qdrant Vector'];

    let status = '✅ OK';
    if (d.category === 'exact_mnemonic') {
      status = s?.exactHitAtRank1 ? '✅ Rank 1 (Lex)' : '❌ Missed Rank 1';
    } else if (d.category === 'control') {
      status = (s?.totalHits ?? 0) === 0 ? '✅ Clean' : '⚠️ False Positive';
    } else if ((s?.totalHits ?? 0) === 0 && (v?.totalHits ?? 0) > 0) {
      status = `Vector candidate (ungraded: ${v?.topHits[0]?.name})`;
    } else if ((s?.totalHits ?? 0) === 0) {
      status = '⚠️ 0 Hits';
    }

    const vecHit = v?.topHits[0] ? `\`${v.topHits[0].name}\` (${(v.topHits[0].concept ?? '').slice(0, 35)}...)` : 'None';
    md += `| \`${d.queryId}\` | ${d.category} | ${d.theme ?? '-'} | \`${d.query}\` | ${s?.totalHits.toLocaleString() ?? 0} | ${vecHit} | ${status} |\n`;
  }

  return md;
}

main().catch(console.error);
