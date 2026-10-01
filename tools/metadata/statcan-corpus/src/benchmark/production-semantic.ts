import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchmarkQuery } from './types.js';

// Exercise the exact public semantic endpoint and 0.55 cutoff used by Searcher.
for (const path of [
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
]) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '');
  }
}

const baseUrl = (process.env.VITE_CORPUS_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const key = process.env.VITE_CORPUS_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!baseUrl || !key) throw new Error('Corpus Supabase URL and publishable key are required.');

interface Candidate {
  recordId: string;
  score: number;
  name: string;
  concept: string | null;
  questionText: string | null;
  surveyGroup: string;
  year: number | null;
}

interface Result {
  id: string;
  query: string;
  lexicalTotal: number;
  rawSemanticCount: number;
  semanticError: string | null;
  latencyMs: number;
  candidates: Candidate[];
}

async function rpc<T>(name: string, args: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${name} returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json() as Promise<T>;
}

async function evaluate(query: BenchmarkQuery): Promise<Result> {
  const lexical = await rpc<Array<{ record_id: string; total_count: number }>>('corpus_search', {
    q: query.query, max_rows: 25, row_offset: 0, hide_process: true,
  });
  const lexicalIds = new Set(lexical.map((row) => row.record_id));
  const t0 = performance.now();
  let points: Array<{ record_id: string; score: number }> = [];
  let semanticError: string | null = null;
  try {
    const response = await fetch(`${baseUrl}/functions/v1/corpus-semantic-search`, {
      method: 'POST',
      headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.query, limit: 5, score_threshold: 0.55, filters: { hide_process: true } }),
      signal: AbortSignal.timeout(2500),
    });
    const body = await response.json() as { points?: Array<{ record_id: string; score: number }>; error?: string };
    if (!response.ok || body.error) semanticError = body.error ?? `HTTP ${response.status}`;
    else points = body.points ?? [];
  } catch (error) {
    semanticError = error instanceof Error ? error.message : String(error);
  }
  const latencyMs = Math.round(performance.now() - t0);
  const rawSemanticCount = points.length;
  points = points.filter((point) => !lexicalIds.has(point.record_id));
  let candidates: Candidate[] = [];
  if (points.length > 0) {
    const records = await rpc<Array<{
      record_id: string; name: string; concept: string | null; question_text: string | null;
      survey_group: string; year: number | null;
    }>>('corpus_get_variables', { p_record_ids: points.map((point) => point.record_id) });
    const byId = new Map(records.map((record) => [record.record_id, record]));
    candidates = points.flatMap((point) => {
      const record = byId.get(point.record_id);
      return record ? [{
        recordId: point.record_id,
        score: point.score,
        name: record.name,
        concept: record.concept,
        questionText: record.question_text,
        surveyGroup: record.survey_group,
        year: record.year,
      }] : [];
    });
  }
  return { id: query.id, query: query.query, lexicalTotal: lexical[0]?.total_count ?? 0, rawSemanticCount, semanticError, latencyMs, candidates };
}

async function main(): Promise<void> {
  const out = resolve(import.meta.dirname, '../../out/search-production-semantic.json');
  const all = JSON.parse(readFileSync(resolve(import.meta.dirname, 'queries.json'), 'utf8')) as BenchmarkQuery[];
  const ids = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
  const selected = process.argv.includes('--all') ? all : all.filter((query) => ids.has(query.id));
  const fromFile = process.argv.includes('--from-file');
  if (!fromFile && selected.length === 0) throw new Error('Pass query IDs (e.g. lab-02 fra-01), --all, or --from-file.');
  let results: Result[];
  let timestamp: string;
  if (fromFile) {
    const saved = JSON.parse(readFileSync(out, 'utf8')) as { timestamp: string; results: Result[] };
    results = saved.results;
    timestamp = saved.timestamp;
  } else {
    results = [];
    for (const [index, query] of selected.entries()) {
      const result = await evaluate(query);
      results.push(result);
      console.log(`${index + 1}/${selected.length} ${result.id}: lexical=${result.lexicalTotal} semantic=${result.rawSemanticCount} panel=${result.candidates.length}${result.semanticError ? ` error=${result.semanticError}` : ''}`);
    }
    timestamp = new Date().toISOString();
    mkdirSync(resolve(import.meta.dirname, '../../out'), { recursive: true });
    writeFileSync(out, JSON.stringify({ timestamp, threshold: 0.55, results }, null, 2));
  }
  const judgments = JSON.parse(readFileSync(resolve(import.meta.dirname, 'provisional-judgments.json'), 'utf8')) as {
    reviewer: string; scale: string; grades: Record<string, Record<string, number>>;
  };
  const reportPath = resolve(import.meta.dirname, '../../../../../docs/search-production-evaluation.md');
  let report = '# Production semantic search check\n\n';
  report += `**Run:** ${timestamp} · **Endpoint:** \`corpus-semantic-search\` · **Score threshold:** 0.55 · **Hide process:** on · **Queries:** ${results.length}\n\n`;
  report += `Grades are **${judgments.reviewer}**. ${judgments.scale}. A returned point is not automatically a relevant result. This sample is too small and lacks human sign-off, so it cannot support a claim that semantic search improves overall ranking.\n\n`;
  report += 'The panel column removes any semantic record already on the first 25-row lexical page, matching the Searcher display.\n\n';
  report += '| Query | Strict lexical total | Raw semantic | Panel after duplicates | Best panel score | Provisional direct grades | Verdict |\n';
  report += '| --- | ---: | ---: | ---: | ---: | ---: | --- |\n';
  for (const result of results) {
    const grades = judgments.grades[result.id] ?? {};
    const complete = result.candidates.length > 0 && result.candidates.every((candidate) => grades[candidate.recordId] !== undefined);
    const direct = complete ? result.candidates.filter((candidate) => grades[candidate.recordId] === 2).length : null;
    const verdict = result.semanticError
      ? `Endpoint error: ${result.semanticError}`
      : result.candidates.length === 0
        ? result.rawSemanticCount > 0 ? 'Semantic hits already on lexical page' : 'No semantic hit at the production threshold'
        : complete
          ? `${direct}/${result.candidates.length} directly relevant in provisional review`
          : 'Candidates need relevance grading';
    report += `| \`${result.query.replaceAll('|', '\\|')}\` | ${result.lexicalTotal} | ${result.rawSemanticCount} | ${result.candidates.length} | ${result.candidates[0]?.score.toFixed(3) ?? '—'} | ${direct === null ? '—' : `${direct}/${result.candidates.length}`} | ${verdict.replaceAll('|', '\\|')} |\n`;
  }
  report += '\n## Candidate details\n\n';
  for (const result of results) {
    if (result.candidates.length === 0) continue;
    report += `### ${result.id}: ${result.query}\n\n`;
    report += '| Rank | Variable | Concept | Similarity | Provisional grade |\n| ---: | --- | --- | ---: | ---: |\n';
    for (const [index, candidate] of result.candidates.entries()) {
      const grade = judgments.grades[result.id]?.[candidate.recordId];
      report += `| ${index + 1} | \`${candidate.name}\` | ${(candidate.concept ?? '').replaceAll('|', '\\|')} | ${candidate.score.toFixed(3)} | ${grade ?? '—'} |\n`;
    }
    report += '\n';
  }
  writeFileSync(reportPath, report.trimEnd() + '\n');
  console.log(`Saved ${out}`);
  console.log(`Saved ${reportPath}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
